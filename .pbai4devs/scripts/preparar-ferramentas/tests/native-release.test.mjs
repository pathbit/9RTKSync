import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeHash, nativeRelease, validateNativeDownload, validateNativeRelease, downloadNative, extractNative, installNative, checkNative, assertNativeVersion } from '../../lib/native-release.mjs';
import { ToolManager, platformKey, toolEnvironment } from '../SCRIPT.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
function fixture(t) { const dir = join(project, '.agent-tests'); mkdirSync(dir, { recursive: true }); const root = mkdtempSync(join(dir, 'native tools ')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function config(bytes = Buffer.from('#!/bin/sh\necho 1.2.3\n'), version = '1.2.3') {
  return { name: 'native-test', description: 'Native fixture.', group: 'security', source: 'https://github.com/owner/repo',
    platforms: [platformKey()], scripts: { entry: 'SCRIPT.mjs' }, probe: ['--version'],
    download: { provider: 'github-release', repository: 'owner/repo', channel: 'reviewed', version, tag: `v${version}`,
      assets: { [platformKey()]: { file: 'tool.bin', format: 'raw', binary: 'tool', sha256: nativeHash(bytes) } } } };
}
function tar(entries) {
  const chunks = [];
  for (const { name, bytes = Buffer.from('binary'), type = '0' } of entries) {
    const header = Buffer.alloc(512); header.write(name, 0, 100); header.write('0000755\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
    header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function zip(entries) {
  const locals = [], centrals = []; let cursor = 0;
  for (const { name, bytes = Buffer.from('binary'), mode = 0o100755, method = 8 } of entries) {
    const filename = Buffer.from(name), compressed = method === 8 ? deflateRawSync(bytes) : bytes, crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(3 << 8 | 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(cursor, 42);
    locals.push(local, filename, compressed); centrals.push(central, filename); cursor += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(cursor, 16);
  return Buffer.concat([...locals, central, end]);
}
const asset = (bytes, format, binary = 'tool') => ({ format, binary, sha256: nativeHash(bytes) });

test('native release requires reviewed pins and exact platform assets', () => {
  const entry = config(); assert.equal(validateNativeDownload(entry.download, entry.platforms), entry.download);
  const release = nativeRelease(entry, platformKey()); assert.equal(validateNativeRelease(entry, release, platformKey()), release);
  for (const change of [{ channel: 'latest' }, { tag: 'master' }, { version: '1.2.3-rc.1' }, { repository: '../evil' }, { assets: {} }]) assert.throws(() => validateNativeDownload({ ...entry.download, ...change }, entry.platforms));
  assert.throws(() => validateNativeRelease(entry, { ...release, url: 'https://evil.example/tool' }, platformKey()));
  const invalid = config(); invalid.download.assets[platformKey()].binary = '../escape'; assert.throws(() => validateNativeDownload(invalid.download, invalid.platforms));
  assert.throws(() => assertNativeVersion('version 1.2.30', '1.2.3')); assert.throws(() => assertNativeVersion('version 1.2.3-rc.1', '1.2.3')); assertNativeVersion('Tool v1.2.3\n', '1.2.3');
});

test('native download follows only anonymous official asset hosts with limits', async () => {
  const seen = [];
  const fetcher = async (url, options) => { seen.push({ url, options }); return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/file?signature=x' } }) : new Response('data'); };
  assert.equal((await downloadNative('https://github.com/owner/repo/releases/download/v1/tool', { fetcher })).toString(), 'data');
  assert.ok(seen.every(({ options }) => !Object.keys(options.headers).some(key => /authorization|token/i.test(key))));
  await assert.rejects(downloadNative('http://github.com/file', { fetcher }), /Host/);
  await assert.rejects(downloadNative('https://evil.example/file', { fetcher }), /GitHub/);
  await assert.rejects(downloadNative('https://github.com/file', { fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/file' } }) }), /Host/);
  await assert.rejects(downloadNative('https://github.com/file', { maxBytes: 2, fetcher: async () => new Response('four') }), /limite/);
  await assert.rejects(downloadNative('https://github.com/file', { fetcher: async () => new Response('missing', { status: 404 }) }), /404/);
});

test('native extraction accepts exact raw/tar/zip executable and rejects traversal and links', () => {
  const raw = Buffer.from('raw binary'); assert.deepEqual(extractNative(raw, asset(raw, 'raw')), raw);
  for (const format of ['tar.gz', 'zip']) {
    const pack = format === 'tar.gz' ? tar : zip;
    const archive = pack([{ name: 'LICENSE', bytes: Buffer.from('license') }, { name: 'tool', bytes: raw }]);
    assert.deepEqual(extractNative(archive, asset(archive, format)), raw);
    for (const name of ['../escape', '/absolute', 'C:/drive', 'folder\\escape']) {
      const bad = pack([{ name }, { name: 'tool' }]); assert.throws(() => extractNative(bad, asset(bad, format)), /Caminho/);
    }
    const duplicate = pack([{ name: 'tool' }, { name: 'TOOL' }]); assert.throws(() => extractNative(duplicate, asset(duplicate, format)), /duplicada/);
    const link = pack([{ name: 'link', type: '2', mode: 0o120777 }, { name: 'tool' }]); assert.throws(() => extractNative(link, asset(link, format)), /Links|Link/);
    assert.throws(() => extractNative(archive, { ...asset(archive, format), sha256: '0'.repeat(64) }), /SHA-256/);
    assert.throws(() => extractNative(archive, asset(archive, format, 'absent')), /ausente/);
  }
});

test('native receipts reject tampering and symbolic files without following them', async t => {
  const root = fixture(t), bytes = Buffer.from('binary'), entry = config(bytes); const prefix = join(root, 'stage'); mkdirSync(prefix);
  const receipt = await installNative(prefix, entry, platformKey(), { download: async () => bytes }); assert.equal(checkNative(prefix, entry, platformKey()).binarySha256, receipt.binarySha256);
  const executable = join(prefix, receipt.executable); writeFileSync(executable, 'tampered'); assert.throws(() => checkNative(prefix, entry, platformKey()), /alterado/);
  writeFileSync(executable, bytes); const outside = join(root, 'outside'); writeFileSync(outside, 'preserve'); rmSync(executable);
  try { symlinkSync(outside, executable); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return; throw error; }
  assert.throws(() => checkNative(prefix, entry, platformKey()), /simbolico/); assert.equal(readFileSync(outside, 'utf8'), 'preserve');
});

test('native manager installs, reuses without network, updates reviewed pins and rolls back', { skip: process.platform === 'win32' && 'O pacote sintético fornece um executável POSIX com shebang.' }, async t => {
  const root = fixture(t); let bytes = Buffer.from('#!/bin/sh\nif [ "$1" = "exit" ]; then exit 37; fi\necho 1.2.3\n'), installs = 0, fail = false;
  let entry = config(bytes); const manager = new ToolManager({ root, catalog: { 'native-test': entry }, install: async prefix => { installs++; if (fail) throw Error('download failed'); await installNative(prefix, entry, platformKey(), { download: async () => bytes }); } });
  const installed = await manager.install(entry.name); assert.equal(installed.version, '1.2.3'); assert.equal(manager.check(entry.name).version, '1.2.3'); assert.equal(manager.run(entry.name, ['exit']), 37);
  manager.fetchRelease = async () => { throw Error('unexpected network'); }; assert.equal((await manager.install(entry.name)).changed, false); assert.equal(installs, 1);
  const old = readFileSync(join(manager.local(entry.name), 'CURRENT.json'));
  bytes = Buffer.from('#!/bin/sh\necho 2.0.0\n'); entry = config(bytes, '2.0.0'); manager.catalog[entry.name] = entry; manager.fetchRelease = async () => nativeRelease(entry, platformKey()); fail = true;
  await assert.rejects(manager.update(entry.name), /download failed/); assert.deepEqual(readFileSync(join(manager.local(entry.name), 'CURRENT.json')), old);
  fail = false; assert.equal((await manager.update(entry.name)).version, '2.0.0'); assert.equal(manager.check(entry.name).version, '2.0.0');
  assert.ok(!existsSync(join(manager.local(entry.name), '.update-lock')));
});

test('native environment removes unrelated credentials while preserving host settings', () => {
  const saved = process.env.NATIVE_TEST_TOKEN; process.env.NATIVE_TEST_TOKEN = 'secret';
  try { assert.equal(toolEnvironment(config(), '/tmp/local').NATIVE_TEST_TOKEN, undefined); } finally { if (saved === undefined) delete process.env.NATIVE_TEST_TOKEN; else process.env.NATIVE_TEST_TOKEN = saved; }
});
