// Coordinate cooperating CLI and direct-sync writers using the same journal.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { assertNoNestedGit } from './git-environment.mjs';
import { planUntrack } from './gitignore.mjs';
import { prepareRecoveryBackup, verifyRecoveryBackup } from './recovery-backup.mjs';
import { assertPrivateRecoveryPaths, createPrivateRecoveryDirectory } from './recovery-privacy.mjs';
import { beginRecovery, finishRecovery, inspectRecoveryJournal, reserveRecovery, resolveRecovery } from './recovery-store.mjs';

function failure(code, details = {}) {
  return Object.assign(new Error('Project recovery could not safely continue.'), { code, ...details });
}

function infoAt(path) {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function directory(path, info, privateDir = false) {
  if (!info?.isDirectory() || info.isSymbolicLink()) throw failure('E_RECOVERY_STORE', { path });
  if (privateDir && process.platform !== 'win32' && (info.mode & 0o7777n) !== 0o700n) {
    throw failure('E_RECOVERY_STORE', { path });
  }
  if (privateDir && typeof process.geteuid === 'function' && info.uid !== BigInt(process.geteuid())) {
    throw failure('E_RECOVERY_STORE', { path });
  }
}

function targetLayout(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\0')) throw failure('E_RECOVERY_INPUT');
  const target = resolve(input), root = parse(target).root;
  const ancestors = [root];
  let anchor = root, anchorInfo = infoAt(root);
  directory(root, anchorInfo);
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    const path = join(anchor, part), info = infoAt(path);
    if (!info) break;
    directory(path, info);
    ancestors.push(path);
    anchor = path;
    anchorInfo = info;
  }
  const missing = anchor === target ? [] : relative(anchor, target).split(sep);
  return { target, anchor, missing, ancestors, anchorInfo };
}

function pathKey(path) {
  // Windows and typical macOS volumes fold case. Keep distinct spellings
  // detectable through the origin record on case-sensitive volumes.
  return ['win32', 'darwin'].includes(process.platform) ? path.normalize('NFD').toLowerCase() : path;
}

function externalName(target) {
  return '.agentdevkit-recovery-' + createHash('sha256').update(pathKey(target)).digest('hex');
}

function internalStore(layout, create) {
  if (layout.missing.length) return null;
  let path = layout.target;
  for (const part of ['.agent-tests', 'agentdevkit']) {
    path = join(path, part);
    let info = infoAt(path);
    if (!info && create) {
      try { mkdirSync(path, { mode: 0o700 }); syncDirectory(dirname(path)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = infoAt(path);
    }
    if (!info) return null;
    directory(path, info);
  }
  return join(path, 'recovery');
}

function locate(input) {
  const layout = targetLayout(input), name = externalName(layout.target);
  const candidates = layout.ancestors.filter(path => path !== layout.target).map(path => join(path, name));
  const internal = internalStore(layout, false);
  if (internal) candidates.push(internal);
  const stores = candidates.filter(path => {
    const info = infoAt(path);
    if (info) directory(path, info, true);
    return info !== null;
  });
  if (stores.length > 1) throw failure('E_RECOVERY_STORE', { stores });
  return { layout, store: stores[0] };
}

const jsonBytes = value => Buffer.from(JSON.stringify(value) + '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rootRecord = layout => ({ version: 1, target: layout.target, anchor: layout.anchor, missing: layout.missing });
const commitment = (originalRoot, backupManifest) => digest(jsonBytes({ version: 1, originalRoot, backupManifest }));

function readPrivateBytes(file, maximum) {
  const info = infoAt(file);
  if (!info?.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size > BigInt(maximum) ||
      process.platform !== 'win32' && (info.uid !== BigInt(process.geteuid()) || (info.mode & 0o7777n) !== 0o600n)) {
    throw failure('E_RECOVERY_STORE', { path: file });
  }
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (info.dev !== opened.dev || info.ino !== opened.ino || opened.size !== info.size) throw failure('E_RECOVERY_STORE');
    const buffer = Buffer.alloc(Number(info.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true }), named = infoAt(file);
    if (BigInt(length) !== opened.size || !named?.isFile() || named.ino !== opened.ino || named.dev !== opened.dev ||
        named.ctimeNs !== opened.ctimeNs || after.ctimeNs !== opened.ctimeNs || after.size !== opened.size) throw failure('E_RECOVERY_STORE');
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}

function readOrigin(file) {
  const bytes = readPrivateBytes(file, 32768), value = JSON.parse(bytes.toString('utf8'));
  if (!value || value.version !== 1 || typeof value.target !== 'string' || !isAbsolute(value.target) ||
      typeof value.anchor !== 'string' || !isAbsolute(value.anchor) || !Array.isArray(value.missing) ||
      value.missing.some(part => typeof part !== 'string' || !part || part === '.' || part === '..' || part.includes(sep) || part.includes('\0')) ||
      value.target !== join(value.anchor, ...value.missing) || !bytes.equals(jsonBytes(rootRecord(value)))) {
    throw failure('E_RECOVERY_STORE', { path: file });
  }
  return value;
}

function writeOrigin(file, layout) {
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, jsonBytes(rootRecord(layout))); fsyncSync(fd); } finally { closeSync(fd); }
}

function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function initialize(layout) {
  const store = layout.missing.length ? join(layout.anchor, externalName(layout.target)) : internalStore(layout, true);
  try { createPrivateRecoveryDirectory(store); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  try {
    const journal = join(store, 'journal');
    const dirs = [store, journal, join(journal, 'records'), join(journal, 'staging'), join(store, 'backups')];
    for (const path of dirs.slice(1)) mkdirSync(path, { mode: 0o700 });
    for (const path of dirs) directory(path, infoAt(path), true);
    assertPrivateRecoveryPaths(dirs);
    writeOrigin(join(store, 'origin.json'), layout);
    for (const path of [journal, store, dirname(store)]) syncDirectory(path);
  } catch (cause) { throw failure('E_RECOVERY_STORE', { cause, store }); }
}

function inspectLocated(layout, store) {
  const journal = join(store, 'journal'), file = join(store, 'origin.json'), backups = join(store, 'backups');
  if (readdirSync(store).sort().join('/') !== 'backups/journal/origin.json') throw failure('E_RECOVERY_STORE', { store });
  for (const path of [store, journal, backups]) directory(path, infoAt(path), true);
  assertPrivateRecoveryPaths([store, journal, backups, file]);
  const originalRoot = readOrigin(file);
  const expected = originalRoot.missing.length ? join(originalRoot.anchor, externalName(originalRoot.target))
    : join(originalRoot.target, '.agent-tests', 'agentdevkit', 'recovery');
  const originalInfo = originalRoot.target === layout.target ? null : infoAt(originalRoot.target);
  const currentInfo = originalInfo ? infoAt(layout.target) : null;
  const sameTarget = originalRoot.target === layout.target || (originalInfo?.isDirectory() && currentInfo?.isDirectory()
    && originalInfo.ino !== 0n && currentInfo.ino === originalInfo.ino && currentInfo.dev === originalInfo.dev);
  if (!sameTarget || pathKey(expected) !== pathKey(store)) {
    throw failure('E_RECOVERY_STORE', { store });
  }
  const state = inspectRecoveryJournal(journal, { includeManifest: true });
  const location = { target: layout.target, store, journal, storeOrigin: originalRoot };
  if (state.status !== 'pending') return { ...state, ...location };
  const paths = operationPaths(store, state.id), operationInfo = infoAt(paths.operation);
  let operationRoot = null;
  if (operationInfo) {
    directory(paths.operation, operationInfo, true);
    const opOrigin = join(paths.operation, 'root.json');
    if (infoAt(opOrigin)) {
      assertPrivateRecoveryPaths([paths.operation, opOrigin]);
      operationRoot = readOrigin(opOrigin);
      if (pathKey(operationRoot.target) !== pathKey(layout.target)) throw failure('E_RECOVERY_STORE', { store });
    }
  }
  let backupManifest;
  if (state.phase === 'begin') {
    directory(paths.backup, infoAt(paths.backup), true);
    directory(paths.stage, infoAt(paths.stage), true);
    const manifestFile = join(paths.backup, 'manifest.json');
    assertPrivateRecoveryPaths([paths.backup, paths.stage, manifestFile]);
    backupManifest = digest(readPrivateBytes(manifestFile, 4 * 1024 * 1024));
    if (!operationRoot || commitment(operationRoot, backupManifest) !== state.manifest) throw failure('E_RECOVERY_STORE', { store });
  }
  return { ...state, ...location, ...paths, originalRoot: operationRoot, ...(backupManifest ? { backupManifest } : {}) };
}

function operationPaths(store, id) {
  const operation = join(store, 'backups', id);
  return { operation, backup: join(operation, 'snapshot'), stage: join(operation, 'stage') };
}

const internalStorePath = '.agent-tests/agentdevkit/recovery';

function assertRecoveryGitBoundary(target, store) {
  const internal = store === join(target, ...internalStorePath.split('/'));
  const root = internal ? target : dirname(store);
  const path = relative(root, store).split(sep).join('/');
  const directories = ['backups', 'journal/records', 'journal/staging'].map(name => path + '/' + name);
  assertNoNestedGit(root, directories);
  if (planUntrack(root, {}, { gitlinkBoundaries: [path] }).gitlinkConflicts?.length) {
    throw Object.assign(new Error('Recovery storage overlaps a Git submodule.'), { code: 'E_STAGED', path });
  }
}

export function inspectProjectRecovery(target) {
  let store;
  try {
    const located = locate(target);
    store = located.store;
    return store ? inspectLocated(located.layout, store) : { status: 'ready', generation: 0, head: null };
  } catch (cause) {
    return { status: 'invalid', reason: cause.code === 'EACCES' || cause.code === 'E_RECOVERY_ACL_UNAVAILABLE' ? 'unreadable' : 'invalid-store',
      ...(store || cause.store ? { store: store || cause.store } : {}), ...(cause.stores ? { stores: cause.stores } : {}) };
  }
}

function checkReady(state) {
  if (state.status === 'pending') throw failure('E_RECOVERY_PENDING', { recovery: state });
  if (state.status !== 'ready') throw failure('E_RECOVERY_STORE', { recovery: state });
}

export function startProjectRecovery(target, entries) {
  const located = locate(target);
  const { layout } = located;
  const store = located.store ?? (layout.missing.length ? join(layout.anchor, externalName(layout.target))
    : join(layout.target, ...internalStorePath.split('/')));
  assertRecoveryGitBoundary(layout.target, store);
  if (!located.store) initialize(located.layout);
  const state = inspectProjectRecovery(target);
  checkReady(state);
  if (!state.store) throw failure('E_RECOVERY_STORE');
  const { generation, id } = reserveRecovery(state.journal);
  const paths = operationPaths(state.store, id);
  const tx = { target: state.target, store: state.store, journal: state.journal, ...paths, generation, id,
    originalRoot: rootRecord(located.layout) };
  try {
    // A competing initialization at another anchor must also see this claim.
    const claimed = inspectProjectRecovery(target);
    if (claimed.status !== 'pending' || claimed.store !== tx.store || claimed.id !== id) throw failure('E_RECOVERY_STATE');
    createPrivateRecoveryDirectory(paths.operation);
    mkdirSync(paths.backup, { mode: 0o700 });
    mkdirSync(paths.stage, { mode: 0o700 });
    for (const path of Object.values(paths)) directory(path, infoAt(path), true);
    assertPrivateRecoveryPaths(Object.values(paths));
    writeOrigin(join(paths.operation, 'root.json'), located.layout);
    syncDirectory(paths.operation);
    syncDirectory(dirname(paths.operation));
    const snapshot = prepareRecoveryBackup(paths.backup, entries);
    verifyRecoveryBackup(paths.backup, snapshot.manifest);
    const current = targetLayout(target);
    if (current.anchor !== located.layout.anchor || current.anchorInfo.dev !== located.layout.anchorInfo.dev ||
        current.anchorInfo.ino !== located.layout.anchorInfo.ino) throw failure('E_RECOVERY_STATE');
    const manifest = commitment(tx.originalRoot, snapshot.manifest);
    beginRecovery(tx.journal, id, manifest);
    return { ...tx, manifest, backupManifest: snapshot.manifest };
  } catch (cause) { throw failure(cause.code || 'E_RECOVERY_IO', { cause, recovery: tx }); }
}

export function completeProjectRecovery(tx) {
  const state = inspectProjectRecovery(tx.target);
  if (state.status === 'invalid') throw failure('E_RECOVERY_STORE', { recovery: state });
  if (state.status !== 'pending' || state.phase !== 'begin' || state.generation !== tx.generation ||
      state.id !== tx.id || state.store !== tx.store || state.backup !== tx.backup || state.manifest !== tx.manifest) {
    throw failure('E_RECOVERY_STATE', { recovery: state });
  }
  try {
    assertRecoveryGitBoundary(state.target, state.store);
    verifyRecoveryBackup(state.backup, state.backupManifest);
    return finishRecovery(state.journal, state.id);
  } catch (cause) { throw failure(cause.code || 'E_RECOVERY_IO', { cause, recovery: tx }); }
}

export function assertRecoveryStageVolume(tx, file, path) {
  if (lstatSync(tx.stage).dev !== lstatSync(file).dev) {
    throw Object.assign(new Error('The private recovery stage is on another volume.'), { code: 'EXDEV', path });
  }
}

export function resolveProjectRecovery(target, generation, id) {
  const state = inspectProjectRecovery(target);
  if (state.status === 'invalid') throw failure('E_RECOVERY_STORE', { recovery: state });
  if (state.status !== 'pending' || state.generation !== generation || state.id !== id) {
    throw failure('E_RECOVERY_STATE', { recovery: state });
  }
  assertRecoveryGitBoundary(state.target, state.store);
  return resolveRecovery(state.journal, generation, id);
}
