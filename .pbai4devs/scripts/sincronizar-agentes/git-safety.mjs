import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { safeGitEnvironment } from '../lib/git-environment.mjs';
import { indexContentMatches } from '../lib/gitignore.mjs';
import { fail, stat } from './shared.mjs';

export function gitIndexStatIdentityMatches(indexedDev, indexedIno, info, platform = process.platform) {
  if (indexedDev === null || indexedIno === null || !info) return false;
  // Git index v2-v4 serializes dev and ino as unsigned 32-bit fields. Filesystems
  // may expose wider values, so compare in the index's representation; the caller
  // separately checks stable stat fields and the staged blob before accepting it.
  const indexField = value => BigInt.asUintN(32, value);
  return indexedDev === indexField(info.dev) && indexedIno === indexField(info.ino)
    || platform === 'win32' && indexedDev === 0n && indexedIno === 0n;
}

function indexStatMatchesFile(root, path, info) {
  const result = spawnSync('git', ['--literal-pathspecs', '-C', root, '-c', 'core.fsmonitor=false', 'ls-files', '--debug', '-z', '--', path], {
    encoding: null, env: { ...safeGitEnvironment(), LC_ALL: 'C', LANGUAGE: 'C' }, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.signal || !Buffer.isBuffer(result.stdout)) return false;
  const separator = result.stdout.indexOf(0);
  if (separator < 0 || result.stdout.indexOf(0, separator + 1) >= 0
    || !result.stdout.subarray(0, separator).equals(Buffer.from(path))) return false;
  const fields = result.stdout.subarray(separator + 1).toString('ascii');
  const value = name => fields.match(new RegExp(`(?:^|[\\t\\n])\\s*${name}:\\s+(\\d+)`))?.[1];
  const time = name => {
    const match = fields.match(new RegExp(`^\\s*${name}:\\s+(\\d+):(\\d+)`, 'm'));
    return match ? BigInt(match[1]) * 1_000_000_000n + BigInt(match[2].padStart(9, '0')) : null;
  };
  const dev = value('dev'), ino = value('ino'), uid = value('uid'), gid = value('gid'), size = value('size');
  const indexedDev = dev === undefined ? null : BigInt(dev), indexedIno = ino === undefined ? null : BigInt(ino);
  // Git for Windows may store no file identity, and reports ctime differently
  // from Node. The staged blob and stable stat fields are also checked before
  // treating a line-ending-only difference as equivalent.
  const identityMatches = gitIndexStatIdentityMatches(indexedDev, indexedIno, info);
  return dev !== undefined && ino !== undefined && uid !== undefined && gid !== undefined && size !== undefined
    && identityMatches && BigInt(uid) === info.uid && BigInt(gid) === info.gid
    && BigInt(size) === info.size && (process.platform === 'win32' || time('ctime') === info.ctimeNs)
    && time('mtime') === info.mtimeNs;
}

function indexBlobMatchesFile(root, path, bytes, info) {
  const env = { ...safeGitEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', LC_ALL: 'C', LANGUAGE: 'C' };
  const result = spawnSync('git', ['--literal-pathspecs', '-C', root, '-c', 'core.fsmonitor=false', 'ls-files', '--stage', '-z', '--', path], {
    encoding: null, env, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.signal || !Buffer.isBuffer(result.stdout)) return false;
  const end = result.stdout.indexOf(0), tab = result.stdout.indexOf(9);
  if (end < 0 || result.stdout.indexOf(0, end + 1) >= 0 || tab < 0 || tab >= end
    || !result.stdout.subarray(tab + 1, end).equals(Buffer.from(path))) return false;
  const entry = result.stdout.subarray(0, tab).toString('ascii').match(/^(100644|100755) ([0-9a-f]{40,64}) 0$/);
  const expectedMode = info.mode & 0o111n ? '100755' : '100644';
  if (!entry || entry[1] !== expectedMode) return false;
  const blob = spawnSync('git', ['--literal-pathspecs', '-C', root, '-c', 'core.fsmonitor=false', 'cat-file', 'blob', entry[2]], {
    encoding: null, env, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  return !blob.error && blob.status === 0 && !blob.signal && Buffer.isBuffer(blob.stdout)
    && blob.stdout.length <= 1024 * 1024 && indexContentMatches(root, path, bytes, blob.stdout);
}

export function assertGitReadableForChanges(root) {
  // A project may be nested in a worktree; .git can be a file or directory.
  // If that marker exists we must not treat an unavailable Git executable,
  // an invalid repository or an unreadable index as a Git-free project.
  let folder = root, found = false;
  while (true) {
    if (stat(join(folder, '.git'))) { found = true; break; }
    const parent = dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  if (!found) return false;
  const env = safeGitEnvironment();
  const probe = spawnSync('git', ['-C', root, '-c', 'core.fsmonitor=false', 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8', env, windowsHide: true, timeout: 20000,
  });
  if (probe.error || probe.status !== 0 || probe.stdout.trim() !== 'true') {
    fail('Nao foi possivel consultar o Git deste projeto; sincronizacao bloqueada para preservar arquivos e indice.');
  }
  return true;
}

export function indexAttributeFilesMatch(root, value, safe) {
  const parts = value.split('/'), candidates = ['.gitattributes'];
  for (let index = 0; index < parts.length - 1; index++) candidates.push(`${parts.slice(0, index + 1).join('/')}/.gitattributes`);
  for (const candidate of candidates) {
    const file = safe(candidate), info = stat(file);
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const identity = lstatSync(file, { bigint: true }), bytes = readFileSync(file);
    if (!indexFileMatches(root, candidate, bytes, identity)) return false;
  }
  return true;
}

export function indexFileMatches(root, path, bytes, identity) {
  return indexStatMatchesFile(root, path, identity) && indexBlobMatchesFile(root, path, bytes, identity);
}
