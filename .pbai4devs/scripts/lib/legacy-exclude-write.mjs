import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertNoNestedGit, canonicalGitPath, safeGitEnvironment } from './git-environment.mjs';
import { checkWindowsFileChanges, copyFileWithNativeMetadata, nativeMetadataCopySupported, publishFileReplacement, stageReplacementWithNativeMetadata } from './native-metadata.mjs';
import { assertPrivateRecoveryPaths, createPrivateRecoveryDirectory } from './recovery-privacy.mjs';
import { withUncertainPath } from './error-reporting.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const changed = () => Object.assign(new Error('Git info/exclude changed during migration.'), { code: 'E_CHANGED' });
const identity = path => lstatSync(path, { bigint: true });
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && b.isFile() && b.nlink === 1n;

function removeOwnedFile(path, original, missingAllowed = false) {
  let current;
  try { current = identity(path); }
  catch (error) { if (missingAllowed && error.code === 'ENOENT') return; throw error; }
  if (!sameFile(original, current)) throw changed();
  unlinkSync(path);
}

function flush(path) {
  const fd = openSync(path, process.platform === 'win32' ? 'r+' : 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function backupLocation(root) {
  const relative = '.agent-tests/agentdevkit/ignore-migrations/' + randomUUID();
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', relative + '/exclude'], {
    env: safeGitEnvironment(), windowsHide: true, timeout: 10000,
  });
  if (ignored.error || ignored.status !== 0) {
    throw Object.assign(new Error('Legacy exclude backup requires an ignored local directory.'), { code: 'E_BACKUP' });
  }
  const indexed = spawnSync('git', ['--literal-pathspecs', '-C', root, 'ls-files', '-z', '--', relative], {
    env: safeGitEnvironment(), windowsHide: true, timeout: 10000,
  });
  if (indexed.error || indexed.status !== 0 || indexed.stdout.length) {
    throw Object.assign(new Error('Legacy exclude backup path is not proved outside the index.'), { code: 'E_BACKUP' });
  }
  assertNoNestedGit(root, [relative]);
  let current = root;
  for (const component of relative.split('/')) {
    current = join(current, component);
    try { createPrivateRecoveryDirectory(current); }
    catch (error) {
      if (error.code !== 'EEXIST' || current === join(root, relative)) throw error;
    }
    const info = identity(current);
    if (!info.isDirectory() || (process.getuid && info.uid !== BigInt(process.getuid()))) throw changed();
  }
  return relative;
}

export function applyLegacyExcludeMigration(plan, revalidate) {
  const edit = plan.legacyMigration;
  if (!edit) return null;
  const root = canonicalGitPath(plan.root);
  const destination = join(root, '.git', 'info', 'exclude');
  if (edit.path !== destination || canonicalGitPath(destination) !== destination) throw changed();
  revalidate(plan);
  const original = identity(destination);
  if (!sameFile(original, original) || original.mode & 0o7000n
    || (process.getuid && original.uid !== BigInt(process.getuid()))) throw changed();

  const lock = destination + '.lock';
  const fd = openSync(lock, 'wx', 0o600);
  let locked, backup, staged, stagedIdentity, published, result, failure;
  try {
    locked = fstatSync(fd, { bigint: true });
    checkWindowsFileChanges([{ path: destination, displayPath: '.git/info/exclude', update: true }]);
    backup = backupLocation(root);
    const privateDirectory = join(root, backup);
    const previous = join(root, backup, 'exclude');
    staged = join(privateDirectory, 'replacement');
    assertPrivateRecoveryPaths([privateDirectory], 'directory');
    writeFileSync(previous, nativeMetadataCopySupported ? Buffer.alloc(0) : edit.before, { flag: 'wx', mode: 0o600 });
    writeFileSync(staged, nativeMetadataCopySupported ? Buffer.alloc(0) : edit.after, { flag: 'wx', mode: 0o600 });
    stagedIdentity = identity(staged);
    if (nativeMetadataCopySupported) {
      copyFileWithNativeMetadata(destination, previous, { destinationIdentity: identity(previous), expectedBytes: edit.before });
      stageReplacementWithNativeMetadata(destination, staged, edit.after, undefined, '.git/info/exclude');
    } else assertPrivateRecoveryPaths([previous, staged], 'file');
    if (!readFileSync(previous).equals(edit.before) || !readFileSync(staged).equals(edit.after)) throw changed();
    flush(previous);
    flush(staged);
    if (process.platform !== 'win32') flush(privateDirectory);
    revalidate(plan);
    const current = identity(destination);
    if (!sameFile(original, current) || current.ctimeNs !== original.ctimeNs
      || !sameFile(locked, identity(lock)) || !sameFile(stagedIdentity, identity(staged))) throw changed();
    publishFileReplacement(staged, destination, '.git/info/exclude', { before: hash(edit.before), after: hash(edit.after) });
    published = true;
    if (process.platform !== 'win32') flush(dirname(destination));
    if (!readFileSync(destination).equals(edit.after)) throw changed();
    result = { backup, removedDuplicates: edit.removedDuplicates, removedMarkers: edit.removedMarkers };
  } catch (error) {
    failure = error;
  }
  const errors = failure ? [failure] : [];
  for (const cleanup of [
    () => closeSync(fd),
    () => { if (locked) removeOwnedFile(lock, locked); },
    () => { if (stagedIdentity) removeOwnedFile(staged, stagedIdentity, published); },
  ]) {
    try { cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length) {
    const error = errors.length === 1 ? errors[0] : Object.assign(new AggregateError(errors, errors[0].message, { cause: errors[0] }), { code: errors[0].code });
    throw backup ? withUncertainPath(error, backup) : error;
  }
  return result;
}
