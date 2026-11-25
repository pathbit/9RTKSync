// Isolated snapshot backup. The caller supplies completeness and a trusted root.
import { createHash } from 'node:crypto';
import { constants, closeSync, fchmodSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { types } from 'node:util';
import { assertPrivateRecoveryPaths } from './recovery-privacy.mjs';

const maxEntries = 4096, maxFile = 32 * 1024 * 1024, maxTotal = 128 * 1024 * 1024, maxManifest = 4 * 1024 * 1024;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const lengthOf = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const offsetOf = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset').get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error('Recovery backup cannot safely continue.'), { code }); };
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`);
const nameOf = index => `${String(index).padStart(8, '0')}.bin`;
const sha = /^[0-9a-f]{64}$/;
// Conservative approximation, not the target filesystem's complete folding.
const aliasKey = value => value.normalize('NFD').toLowerCase().toUpperCase().normalize('NFD');
const reservedDevice = part => /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(aliasKey(part.split('.')[0].replace(/ +$/, '')));

function properties(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) fail('E_RECOVERY_BACKUP_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))) fail('E_RECOVERY_BACKUP_INPUT');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function validatePath(path) {
  if (typeof path !== 'string' || !path || path.length > 512 || path !== path.normalize('NFC')
    || path !== Buffer.from(path, 'utf8').toString('utf8')
    || isAbsolute(path) || /[\\:<>"|?*\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || Buffer.byteLength(part, 'utf8') > 255 || reservedDevice(part)
      || ['.GIT', '.AGENT-TESTS'].includes(aliasKey(part)))) fail('E_RECOVERY_BACKUP_INPUT');
}

function metadata(path, action, type, mode) {
  validatePath(path);
  if (!['create', 'update', 'remove', 'retain'].includes(action) || !['file', 'directory', 'absent'].includes(type)) fail('E_RECOVERY_BACKUP_INPUT');
  if (type === 'absent' ? mode !== null || action !== 'create' : !Number.isInteger(mode) || mode < 0 || mode > 0o777 || action === 'create') fail('E_RECOVERY_BACKUP_INPUT');
  return { path, action, type, mode };
}

function validateRelationships(entries) {
  const exact = new Map(), aliases = new Set(), prefixes = new Map();
  for (const entry of entries) {
    const alias = aliasKey(entry.path);
    if (aliases.has(alias)) fail('E_RECOVERY_BACKUP_INPUT');
    aliases.add(alias); exact.set(alias, entry);
    const segments = entry.path.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join('/'), key = aliasKey(prefix);
      if (prefixes.has(key) && prefixes.get(key) !== prefix) fail('E_RECOVERY_BACKUP_INPUT');
      prefixes.set(key, prefix);
    }
  }
  for (const entry of entries) {
    const segments = entry.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const ancestor = exact.get(aliasKey(segments.slice(0, i).join('/')));
      if (ancestor?.type === 'file' && !(ancestor.action === 'remove' && entry.type === 'absent' && entry.action === 'create')
        || ancestor?.type === 'absent' && entry.type !== 'absent') fail('E_RECOVERY_BACKUP_INPUT');
    }
  }
}

function inputSnapshot(entries) {
  if (types.isProxy(entries) || !Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype || Object.hasOwn(entries, Symbol.iterator) || entries.length > maxEntries) fail('E_RECOVERY_BACKUP_INPUT');
  const snapshots = []; let total = 0;
  for (let index = 0; index < entries.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!slot || !Object.hasOwn(slot, 'value')) fail('E_RECOVERY_BACKUP_INPUT');
    const value = slot.value;
    if (!value || typeof value !== 'object' || types.isProxy(value)) fail('E_RECOVERY_BACKUP_INPUT');
    const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!typeDescriptor || !Object.hasOwn(typeDescriptor, 'value')) fail('E_RECOVERY_BACKUP_INPUT');
    const fields = properties(value, typeDescriptor.value === 'file' ? ['path', 'action', 'type', 'mode', 'data'] : ['path', 'action', 'type', 'mode']);
    const item = metadata(fields.path, fields.action, fields.type, fields.mode);
    if (item.type === 'file') {
      const bytes = fields.data;
      if (types.isProxy(bytes) || !types.isUint8Array(bytes)) fail('E_RECOVERY_BACKUP_INPUT');
      const length = lengthOf.call(bytes), offset = offsetOf.call(bytes), backing = bufferOf.call(bytes);
      if (!types.isArrayBuffer(backing) || length > maxFile || (total += length) > maxTotal) fail('E_RECOVERY_BACKUP_INPUT');
      item.data = Buffer.from(new Uint8Array(backing, offset, length));
    }
    snapshots.push(item);
  }
  snapshots.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  validateRelationships(snapshots);
  return snapshots;
}

function directory(path, exactMode) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && ((info.mode & 0o7077)
    || exactMode !== undefined && (info.mode & 0o777) !== exactMode
    || typeof process.geteuid !== 'function' || info.uid !== process.geteuid())) fail('E_RECOVERY_BACKUP_STORE');
  return info;
}

function list(path, limit) {
  const names = [], dir = opendirSync(path);
  try { for (let entry; (entry = dir.readSync()) !== null;) { names.push(entry.name); if (names.length > limit) fail('E_RECOVERY_BACKUP_STORE'); } }
  finally { dir.closeSync(); }
  return names.sort();
}

function rootDirectory(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) fail('E_RECOVERY_BACKUP_STORE');
  return directory(root);
}

function sameDirectory(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode
    && before.uid === after.uid && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

function syncDirectory(path) {
  // File contents are flushed on Windows. Node provides no corresponding
  // guarantee for the directory entries across a power failure.
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeExclusive(path, bytes) {
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
    if (process.platform === 'darwin') assertPrivateRecoveryPaths([path], 'file');
    writeFileSync(fd, bytes);
    if (process.platform !== 'win32') fchmodSync(fd, 0o600);
    fsyncSync(fd);
    const completedFd = fd; fd = undefined; closeSync(completedFd);
  } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* Preserve the original error. */ } }
}

function sameFile(before, after) {
  return after.isFile() && !after.isSymbolicLink() && after.dev === before.dev && after.ino === before.ino
    && after.size === before.size && after.mode === before.mode && after.uid === before.uid && after.nlink === 1n
    && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs;
}

function readChecked(path, maximum, digestOnly = false) {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximum) || process.platform !== 'win32' && ((before.mode & 0o7077n)
    || (before.mode & 0o777n) !== 0o600n
    || typeof process.geteuid !== 'function' || before.uid !== BigInt(process.geteuid()))) fail('E_RECOVERY_BACKUP_INVALID');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mode !== before.mode || opened.uid !== before.uid || opened.nlink !== 1n) fail('E_RECOVERY_BACKUP_INVALID');
    const digest = createHash('sha256'), chunks = []; let size = 0, count;
    const buffer = Buffer.alloc(Math.min(65536, maximum + 1));
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      size += count; if (size > maximum) fail('E_RECOVERY_BACKUP_INVALID');
      digest.update(buffer.subarray(0, count)); if (!digestOnly) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
    if (BigInt(size) !== opened.size || !sameFile(opened, after) || !sameFile(opened, named)) fail('E_RECOVERY_BACKUP_INVALID');
    return { size, hash: digest.digest('hex'), identity: opened, ...(digestOnly ? {} : { bytes: Buffer.concat(chunks) }) };
  } finally { closeSync(fd); }
}

function manifestEntries(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > maxEntries) fail('E_RECOVERY_BACKUP_INVALID');
  const entries = []; let files = 0, total = 0, previous = '';
  for (const entry of value.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('E_RECOVERY_BACKUP_INVALID');
    const fields = properties(entry, entry.type === 'file' ? ['path', 'action', 'type', 'mode', 'size', 'sha256', 'blob'] : ['path', 'action', 'type', 'mode']);
    const item = metadata(fields.path, fields.action, fields.type, fields.mode);
    if (previous && previous >= item.path) fail('E_RECOVERY_BACKUP_INVALID');
    previous = item.path;
    if (item.type === 'file') {
      if (!Number.isSafeInteger(fields.size) || fields.size < 0 || fields.size > maxFile || (total += fields.size) > maxTotal
        || typeof fields.sha256 !== 'string' || !sha.test(fields.sha256) || fields.blob !== nameOf(++files)) fail('E_RECOVERY_BACKUP_INVALID');
      Object.assign(item, { size: fields.size, sha256: fields.sha256, blob: fields.blob });
    }
    entries.push(item);
  }
  validateRelationships(entries);
  return entries;
}

export function prepareRecoveryBackup(root, entries) {
  try {
    let snapshots;
    try { snapshots = inputSnapshot(entries); } catch { fail('E_RECOVERY_BACKUP_INPUT'); }
    const items = []; let files = 0;
    for (const snapshot of snapshots) {
      const { data, ...item } = snapshot;
      items.push(data === undefined ? item : { ...item, size: data.length, sha256: hash(data), blob: nameOf(++files) });
    }
    const manifest = canonical({ version: 1, entries: items });
    if (manifest.length > maxManifest) fail('E_RECOVERY_BACKUP_INPUT');
    rootDirectory(root);
    assertPrivateRecoveryPaths([root], 'directory');
    if (list(root, 1).length) fail('E_RECOVERY_BACKUP_STORE');
    const blobs = join(root, 'blobs'); mkdirSync(blobs, { mode: 0o700 }); directory(blobs, 0o700);
    assertPrivateRecoveryPaths([blobs], 'directory'); syncDirectory(root);
    let index = 0;
    for (const snapshot of snapshots) if (snapshot.data !== undefined) writeExclusive(join(blobs, nameOf(++index)), snapshot.data);
    syncDirectory(blobs); writeExclusive(join(root, 'manifest.json'), manifest); syncDirectory(root);
    return { manifest: hash(manifest), entries: items.length, files };
  } catch (cause) {
    if (cause?.code === 'E_RECOVERY_ACL_UNSAFE') fail('E_RECOVERY_BACKUP_STORE');
    if (['E_RECOVERY_BACKUP_INPUT', 'E_RECOVERY_BACKUP_STORE'].includes(cause?.code)) throw cause;
    fail('E_RECOVERY_BACKUP_IO');
  }
}

export function verifyRecoveryBackup(root, expected) {
  if (typeof expected !== 'string' || !sha.test(expected)) fail('E_RECOVERY_BACKUP_INPUT');
  try {
    const rootBefore = rootDirectory(root);
    if (list(root, 2).join(',') !== 'blobs,manifest.json') fail('E_RECOVERY_BACKUP_INVALID');
    const blobs = join(root, 'blobs'), blobsBefore = directory(blobs, 0o700);
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const names = list(blobs, maxEntries);
      if (names.some(name => !/^\d{8}\.bin$/.test(name))) fail('E_RECOVERY_BACKUP_INVALID');
      const files = [join(root, 'manifest.json'), ...names.map(name => join(blobs, name))];
      if (files.some(path => !lstatSync(path).isFile())) fail('E_RECOVERY_BACKUP_INVALID');
      assertPrivateRecoveryPaths([root, blobs, ...files]);
    }
    const manifest = readChecked(join(root, 'manifest.json'), maxManifest);
    if (manifest.hash !== expected) fail('E_RECOVERY_BACKUP_INVALID');
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(manifest.bytes)); }
    catch { fail('E_RECOVERY_BACKUP_INVALID'); }
    const entries = manifestEntries(value), normalized = canonical({ version: 1, entries });
    if (!manifest.bytes.equals(normalized)) fail('E_RECOVERY_BACKUP_INVALID');
    const files = entries.filter(entry => entry.type === 'file');
    if (JSON.stringify(list(blobs, maxEntries)) !== JSON.stringify(files.map(entry => entry.blob))) fail('E_RECOVERY_BACKUP_INVALID');
    const verified = [{ path: join(root, 'manifest.json'), identity: manifest.identity }];
    for (const entry of files) {
      const file = join(blobs, entry.blob), actual = readChecked(file, entry.size, true);
      if (actual.size !== entry.size || actual.hash !== entry.sha256) fail('E_RECOVERY_BACKUP_INVALID');
      verified.push({ path: file, identity: actual.identity });
    }
    if (list(root, 2).join(',') !== 'blobs,manifest.json'
      || JSON.stringify(list(blobs, maxEntries)) !== JSON.stringify(files.map(entry => entry.blob))
      || !sameDirectory(rootBefore, rootDirectory(root)) || !sameDirectory(blobsBefore, directory(blobs, 0o700))) fail('E_RECOVERY_BACKUP_INVALID');
    for (const item of verified) if (!sameFile(item.identity, lstatSync(item.path, { bigint: true }))) fail('E_RECOVERY_BACKUP_INVALID');
    return { manifest: expected, entries: entries.length, files: files.length };
  } catch (cause) {
    if (['E_RECOVERY_BACKUP_INVALID', 'E_RECOVERY_BACKUP_INPUT', 'E_RECOVERY_BACKUP_STORE', 'E_RECOVERY_ACL_UNSAFE', 'ENOENT', 'ENOTDIR', 'ELOOP'].includes(cause?.code)) fail('E_RECOVERY_BACKUP_INVALID');
    fail('E_RECOVERY_BACKUP_IO');
  }
}
