import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const limit = 256 * 1024 * 1024;
const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
const fail = message => { throw new Error(message); };
export const nativeHash = bytes => createHash('sha256').update(bytes).digest('hex');

function safeName(value, directory = false) {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f:]/.test(value) || isAbsolute(value)) fail('Caminho invalido no arquivo nativo.');
  const normalized = directory ? value.replace(/\/$/, '') : value;
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) fail('Caminho invalido no arquivo nativo.');
  return normalized;
}

export function validateNativeDownload(download, platforms) {
  if (download?.provider !== 'github-release' || download.channel !== 'reviewed'
    || !/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(download.repository || '')
    || !/^\d+\.\d+\.\d+$/.test(download.version || '') || download.tag !== `v${download.version}`) fail('Release nativa deve usar origem e versao revisadas.');
  if (!download.assets || typeof download.assets !== 'object' || Array.isArray(download.assets)
    || Object.keys(download.assets).length !== platforms.length) fail('Assets nativos devem corresponder as plataformas.');
  for (const platform of platforms) {
    const asset = download.assets[platform];
    if (!Object.hasOwn(download.assets, platform) || !asset || typeof asset !== 'object' || !['raw', 'tar.gz', 'zip'].includes(asset.format)
      || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !/^\w[\w.-]*$/.test(asset.file || '')) fail(`Asset nativo invalido: ${platform}`);
    safeName(asset.binary);
  }
  return download;
}

export function nativeRelease(entry, platform) {
  validateNativeDownload(entry.download, entry.platforms);
  const asset = entry.download.assets[platform];
  if (!asset) fail(`Plataforma nativa nao suportada: ${platform}`);
  const { repository, version, tag } = entry.download;
  return { name: entry.name, version, repository, platform, asset: { ...asset },
    url: `https://github.com/${repository}/releases/download/${tag}/${asset.file}` };
}

export function validateNativeRelease(entry, release, platform) {
  const expected = nativeRelease(entry, platform);
  if (!release || JSON.stringify(release) !== JSON.stringify(expected)) fail('Release nativa diverge do pin revisado.');
  return release;
}

export async function downloadNative(url, { fetcher = fetch, maxBytes = limit, timeoutMs = 60000 } = {}) {
  let current = new URL(url);
  if (current.hostname !== 'github.com') fail('Download nativo deve iniciar no GitHub oficial.');
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (current.protocol !== 'https:' || current.username || current.password || !hosts.has(current.hostname)) fail('Host de download nativo nao permitido.');
    const response = await fetcher(current.href, { redirect: 'manual', headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(timeoutMs) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 5) fail('Redirecionamento nativo invalido.');
      current = new URL(location, current);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) fail(`Download nativo falhou: HTTP ${response.status}.`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) fail('Download nativo excede o limite.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) fail('Download nativo excede o limite.');
      chunks.push(Buffer.from(chunk));
    }
    if (!size) fail('Download nativo vazio.');
    return Buffer.concat(chunks, size);
  }
  fail('Redirecionamentos nativos excedidos.');
}

function tarBytes(archive, binary) {
  const data = gunzipSync(archive, { maxOutputLength: limit });
  const names = new Set(); let selected, ended = false;
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      if (data.length - offset < 1024 || !data.subarray(offset).every(value => value === 0)) fail('Final tar invalido.');
      ended = true; break;
    }
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').split('\0')[0];
    const number = (start, length) => { const value = text(start, length).trim(); if (!/^[0-7]+$/.test(value)) fail('Cabecalho tar invalido.'); return parseInt(value, 8); };
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (number(148, 8) !== checksum) fail('Checksum do cabecalho tar invalido.');
    const type = String.fromCharCode(header[156]), directory = type === '5';
    if (!['0', '\0', '5'].includes(type)) fail('Links ou entradas especiais nao permitidos no tar.');
    const name = safeName([text(345, 155), text(0, 100)].filter(Boolean).join('/'), directory);
    const key = name.toLowerCase(); if (names.has(key)) fail('Entrada duplicada no tar.'); names.add(key);
    const size = number(124, 12); offset += 512;
    if (size > limit || offset + size > data.length || directory && size) fail('Tamanho tar invalido.');
    if (!directory && name === binary) selected = Buffer.from(data.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended) fail('Arquivo tar incompleto.');
  if (!selected?.length) fail('Executavel esperado ausente no tar.');
  return selected;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipBytes(data, binary) {
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50 && offset + 22 + data.readUInt16LE(offset + 20) === data.length) { end = offset; break; }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) fail('Arquivo ZIP invalido ou multipartes.');
  const count = data.readUInt16LE(end + 10), centralSize = data.readUInt32LE(end + 12), central = data.readUInt32LE(end + 16);
  if (count === 0xffff || count !== data.readUInt16LE(end + 8) || central + centralSize !== end) fail('Diretorio ZIP invalido ou ZIP64.');
  const names = new Set(); let selected, offset = central;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) fail('Entrada ZIP invalida.');
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), crc = data.readUInt32LE(offset + 16);
    const compressed = data.readUInt32LE(offset + 20), size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32);
    const disk = data.readUInt16LE(offset + 34), attributes = data.readUInt32LE(offset + 38), local = data.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extra + comment > end || flags & 1 || disk || ![0, 8].includes(method) || size > limit || compressed > limit) fail('Formato ZIP nao permitido.');
    const original = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const directory = original.endsWith('/'), name = safeName(original, directory), mode = attributes >>> 16, type = mode & 0o170000;
    if (![0, 0o100000, 0o040000].includes(type) || type === 0o040000 && !directory) fail('Link ou entrada especial no ZIP.');
    const key = name.toLowerCase(); if (names.has(key)) fail('Entrada duplicada no ZIP.'); names.add(key);
    if (local + 30 > central || data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method) fail('Cabecalho local ZIP divergente.');
    const localNameLength = data.readUInt16LE(local + 26), localExtra = data.readUInt16LE(local + 28), start = local + 30 + localNameLength + localExtra;
    if (start + compressed > central || data.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== original) fail('Caminho local ZIP divergente.');
    if (!directory && name === binary) {
      const packed = data.subarray(start, start + compressed);
      selected = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: limit });
      if (selected.length !== size || crc32(selected) !== crc) fail('Integridade do executavel ZIP invalida.');
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end || !selected?.length) fail('Executavel esperado ausente no ZIP.');
  return selected;
}

export function extractNative(archive, asset) {
  if (!Buffer.isBuffer(archive) || !archive.length || archive.length > limit) fail('Tamanho de arquivo nativo invalido.');
  safeName(asset.binary);
  if (nativeHash(archive) !== asset.sha256) fail('SHA-256 do download nativo diverge do pin revisado.');
  if (asset.format === 'raw') return archive;
  if (asset.format === 'tar.gz') return tarBytes(archive, asset.binary);
  if (asset.format === 'zip') return zipBytes(archive, asset.binary);
  fail('Formato nativo nao suportado.');
}

function checkedFile(prefix, relativePath) {
  safeName(relativePath);
  const base = resolve(prefix), file = resolve(base, relativePath), child = relative(base, file);
  if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) fail('Executavel fora da instalacao.');
  if (!lstatSync(base).isDirectory() || lstatSync(base).isSymbolicLink()) fail('Raiz nativa deve ser um diretorio regular.');
  let current = base;
  for (const segment of child.split(sep)) {
    current = join(current, segment);
    try { if (lstatSync(current).isSymbolicLink()) fail('Link simbolico na instalacao nativa.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return file;
}

export function nativeExecutable(entry, platform) { return `bin/${entry.name}${platform.startsWith('win32-') ? '.exe' : ''}`; }

export async function installNative(prefix, entry, platform, { download = downloadNative } = {}) {
  const release = nativeRelease(entry, platform), archive = await download(release.url), bytes = extractNative(archive, release.asset);
  const executable = nativeExecutable(entry, platform), target = checkedFile(prefix, executable);
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx', mode: 0o755 }); chmodSync(target, 0o755);
  const receipt = { name: entry.name, version: release.version, platform, executable, archiveSha256: release.asset.sha256, binarySha256: nativeHash(bytes) };
  writeFileSync(checkedFile(prefix, 'native.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

export function checkNative(prefix, entry, platform) {
  const file = checkedFile(prefix, 'native.json');
  if (!lstatSync(file).isFile()) fail('Recibo nativo invalido.');
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  const release = nativeRelease(entry, platform);
  if (receipt.name !== entry.name || receipt.version !== release.version || receipt.platform !== platform
    || receipt.executable !== nativeExecutable(entry, platform) || receipt.archiveSha256 !== release.asset.sha256
    || !/^[a-f0-9]{64}$/.test(receipt.binarySha256 || '')) fail('Recibo nativo diverge do catalogo revisado.');
  const executable = checkedFile(prefix, receipt.executable);
  if (!lstatSync(executable).isFile() || nativeHash(readFileSync(executable)) !== receipt.binarySha256) fail('Executavel nativo alterado.');
  return { ...receipt, file: executable };
}

export function assertNativeVersion(output, version) {
  if (!new RegExp(`(?:^|[^\\w.])v?${version.replaceAll('.', '\\.')}(?=$|[^\\w.+-])`).test(output)) fail('Probe nativo informou outra versao.');
}
