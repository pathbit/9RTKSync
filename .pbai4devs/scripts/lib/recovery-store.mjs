// The caller must provide a trusted, already prepared private directory.
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fchmodSync, fsyncSync, fstatSync, linkSync, lstatSync, openSync, opendirSync, readSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { inspectRecoveryRecords } from './recovery-records.mjs';
import { assertPrivateRecoveryPaths } from './recovery-privacy.mjs';

const maxRecords = 4000, maxRecordBytes = 4096, maxTotalBytes = 1024 * 1024;
const fileName = /^\d{12}\.(claim|begin|done|resolved)\.json$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nameOf = (generation, kind) => `${String(generation).padStart(12, '0')}.${kind}.json`;
const bytesOf = value => Buffer.from(`${JSON.stringify(value)}\n`);
const error = code => Object.assign(new Error('Recovery journal cannot safely continue.'), { code });
const invalid = reason => ({ status: 'invalid', reason });

function directory(path) {
  const item = lstatSync(path);
  // POSIX mode and ownership alone do not prove that an ACL grants no access.
  if (!item.isDirectory() || item.isSymbolicLink()
    || process.platform !== 'win32' && (typeof process.geteuid !== 'function'
      || !Number.isSafeInteger(item.uid) || item.uid !== process.geteuid() || (item.mode & 0o7077))) {
    throw error('E_RECOVERY_STORE');
  }
}

function layout(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw error('E_RECOVERY_STORE');
  directory(root);
  const entries = []; const dir = opendirSync(root);
  try { for (let item; (item = dir.readSync()) !== null;) { entries.push(item.name); if (entries.length > 2) throw error('E_RECOVERY_STORE'); } }
  finally { dir.closeSync(); }
  if (entries.length !== 2 || !entries.includes('records') || !entries.includes('staging')) throw error('E_RECOVERY_STORE');
  const records = join(root, 'records'), staging = join(root, 'staging');
  directory(records); directory(staging);
  return { records, staging };
}

function readRecord(path, synchronize = false) {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxRecordBytes)) throw error('E_RECOVERY_STORE');
  // A hardlink in staging is expected; mode and ownership do not describe ACLs.
  if (process.platform !== 'win32' && (typeof process.geteuid !== 'function'
    || before.uid !== BigInt(process.geteuid()) || (before.mode & 0o7777n) !== 0o400n)) throw error('E_RECOVERY_STORE');
  // These snapshots detect observed changes; path operations are not atomic.
  const stableIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink
    && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  // Windows FlushFileBuffers requires a writable handle.
  const access = synchronize && process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY;
  const flags = access | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  const fd = openSync(path, flags);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !stableIdentity(before, opened) || opened.size !== before.size) throw error('E_RECOVERY_STORE');
    const bytes = Buffer.alloc(Number(opened.size) + 1); let count = 0, n;
    while (count < bytes.length && (n = readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += n;
    const after = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
    if (BigInt(count) !== opened.size || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs
      || after.ctimeNs !== opened.ctimeNs || !stableIdentity(opened, after) || named.isSymbolicLink()
      || !stableIdentity(opened, named)) throw error('E_RECOVERY_STORE');
    if (synchronize) fsyncSync(fd);
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}

function readJournal(root) {
  try {
    const paths = layout(root), names = [], entries = [], data = new Map(); let total = 0;
    const dir = opendirSync(paths.records);
    try {
      for (let item; (item = dir.readSync()) !== null;) {
        if (!fileName.test(item.name)) return { result: invalid('invalid-store') };
        if (names.length >= maxRecords) return { result: invalid('limit-exceeded') };
        names.push(item.name);
      }
    } finally { dir.closeSync(); }
    if (process.platform === 'win32' || process.platform === 'darwin') {
      assertPrivateRecoveryPaths([root, paths.records, paths.staging, ...names.map(name => join(paths.records, name))]);
    }
    for (const name of names) {
      const bytes = readRecord(join(paths.records, name));
      total += bytes.length;
      if (total > maxTotalBytes) return { result: invalid('limit-exceeded') };
      entries.push({ name, bytes }); data.set(name, bytes);
    }
    return { result: inspectRecoveryRecords(entries), data, total, count: entries.length, paths };
  } catch (cause) {
    return { result: invalid(['EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ESTALE', 'EBUSY', 'ENOMEM', 'ETIMEDOUT', 'E_RECOVERY_ACL_UNAVAILABLE'].includes(cause?.code) ? 'unreadable' : 'invalid-store') };
  }
}

export function inspectRecoveryJournal(root, { includeManifest = false } = {}) {
  const journal = readJournal(root), state = journal.result;
  if (!includeManifest || state.status !== 'pending' || state.phase !== 'begin') return state;
  const receipt = journal.data.get(nameOf(state.generation, 'begin'));
  return { ...state, manifest: JSON.parse(receipt.toString('utf8')).manifest };
}

function syncDirectory(path) {
  // Node cannot fsync the directory entry on Windows. A power failure may
  // lose the name even after the file contents have been flushed.
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function syncObserved(journal, name) {
  try {
    const bytes = readRecord(join(journal.paths.records, name), true);
    if (!bytes.equals(journal.data.get(name))) throw error('E_RECOVERY_STORE');
    syncDirectory(journal.paths.records);
  } catch (cause) { throw error(['E_RECOVERY_STORE', 'ENOENT', 'ELOOP'].includes(cause?.code) ? 'E_RECOVERY_STORE' : 'E_RECOVERY_IO'); }
}

function publish(paths, generation, id, kind, bytes) {
  let fd, linking = false, published = false;
  try {
    const temporary = join(paths.staging, `${randomUUID()}.record`);
    fd = openSync(temporary, 'wx', 0o600);
    if (process.platform === 'darwin') assertPrivateRecoveryPaths([temporary], 'file');
    writeFileSync(fd, bytes);
    if (process.platform !== 'win32') fchmodSync(fd, 0o400);
    fsyncSync(fd);
    const completedFd = fd; fd = undefined; closeSync(completedFd);
    linking = true; linkSync(temporary, join(paths.records, nameOf(generation, kind))); linking = false; published = true;
    syncDirectory(paths.records);
  } catch (cause) {
    const code = linking && cause?.code === 'EEXIST' ? 'E_RECOVERY_BUSY' : linking || published ? 'E_RECOVERY_UNCERTAIN' : 'E_RECOVERY_IO';
    const failure = error(code);
    if (code === 'E_RECOVERY_UNCERTAIN') failure.operation = { generation, id, kind, publication: 'possible' };
    throw failure;
  } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* Keep the failure. */ } }
}

export function reserveRecovery(root) {
  const journal = readJournal(root), current = journal.result;
  if (current.status !== 'ready') throw error(current.status === 'pending' ? 'E_RECOVERY_PENDING' : current.reason === 'unreadable' ? 'E_RECOVERY_IO' : 'E_RECOVERY_STORE');
  const generation = current.generation + 1, id = randomUUID();
  const claim = bytesOf({ version: 1, generation, id, kind: 'claim', previous: current.head });
  const begin = bytesOf({ version: 1, generation, id, kind: 'begin', claim: hash(claim), manifest: 'a'.repeat(64) });
  // A resolved receipt includes both links and is larger than a normal done.
  const terminal = resolutionReceipt(generation, id, claim, begin);
  if (journal.count + 3 > maxRecords || journal.total + claim.length + begin.length + terminal.length > maxTotalBytes) throw error('E_RECOVERY_LIMIT');
  if (current.generation) syncObserved(journal, nameOf(current.generation, current.terminal));
  publish(journal.paths, generation, id, 'claim', claim);
  return { generation, id, phase: 'claim' };
}

function pending(root, id, phase) {
  if (typeof id !== 'string' || !uuid.test(id)) throw error('E_RECOVERY_INPUT');
  const journal = readJournal(root), current = journal.result;
  if (current.status === 'invalid') throw error(current.reason === 'unreadable' ? 'E_RECOVERY_IO' : 'E_RECOVERY_STORE');
  if (current.status !== 'pending' || current.id !== id || (phase && current.phase !== phase)) throw error('E_RECOVERY_STATE');
  return { ...journal, current };
}

export function beginRecovery(root, id, manifest) {
  if (typeof manifest !== 'string' || !sha.test(manifest)) throw error('E_RECOVERY_INPUT');
  const journal = pending(root, id, 'claim'), generation = journal.current.generation;
  const claim = journal.data.get(nameOf(generation, 'claim'));
  const bytes = bytesOf({ version: 1, generation, id, kind: 'begin', claim: hash(claim), manifest });
  const terminal = resolutionReceipt(generation, id, claim, bytes);
  if (journal.count + 2 > maxRecords || journal.total + bytes.length + terminal.length > maxTotalBytes) throw error('E_RECOVERY_LIMIT');
  syncObserved(journal, nameOf(generation, 'claim'));
  publish(journal.paths, generation, id, 'begin', bytes);
  return { generation, id, phase: 'begin' };
}

export function finishRecovery(root, id) {
  const journal = pending(root, id, 'begin'), generation = journal.current.generation;
  const begin = journal.data.get(nameOf(generation, 'begin'));
  const bytes = bytesOf({ version: 1, generation, id, kind: 'done', begin: hash(begin) });
  if (journal.count + 1 > maxRecords || journal.total + bytes.length > maxTotalBytes) throw error('E_RECOVERY_LIMIT');
  syncObserved(journal, nameOf(generation, 'begin'));
  publish(journal.paths, generation, id, 'done', bytes);
  return { generation, id, phase: 'done' };
}

function resolutionReceipt(generation, id, claim, begin) {
  return bytesOf({ version: 1, generation, id, kind: 'resolved', claim: hash(claim), begin: begin ? hash(begin) : null });
}

// Stop cooperating writers and review the project before manual resolution.
// This receipt only acknowledges the review.
export function resolveRecovery(root, generation, id) {
  if (!Number.isSafeInteger(generation) || generation < 1) throw error('E_RECOVERY_INPUT');
  const journal = pending(root, id);
  if (generation !== journal.current.generation) throw error('E_RECOVERY_STATE');
  const claim = journal.data.get(nameOf(generation, 'claim'));
  const begin = journal.data.get(nameOf(generation, 'begin'));
  const bytes = resolutionReceipt(generation, id, claim, begin);
  if (journal.count + 1 > maxRecords || journal.total + bytes.length > maxTotalBytes) throw error('E_RECOVERY_LIMIT');
  syncObserved(journal, nameOf(generation, journal.current.phase));
  publish(journal.paths, generation, id, 'resolved', bytes);
  const observed = readJournal(root);
  if (observed.result.status === 'invalid' || !observed.data?.get(nameOf(generation, 'resolved'))?.equals(bytes)) {
    const failure = error('E_RECOVERY_UNCERTAIN');
    failure.operation = { generation, id, kind: 'resolved', publication: 'possible' };
    throw failure;
  }
  return { generation, id, phase: 'resolved' };
}
