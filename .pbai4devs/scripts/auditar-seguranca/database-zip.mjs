import { crc32, inflateRawSync } from 'node:zlib';

const fail = message => { throw new Error(message); };
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_ENTRY = 16 * 1024 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 1000000;

function within(data, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > data.length) fail('Estrutura ZIP fora dos limites.');
}
function number64(data, offset) {
  within(data, offset, 8); const value = data.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('Inteiro ZIP64 excede o limite seguro.');
  return Number(value);
}
function extras(data, offset, size) {
  within(data, offset, size); const end = offset + size; let zip64;
  while (offset < end) {
    if (offset + 4 > end) fail('Campo extra ZIP truncado.');
    const id = data.readUInt16LE(offset), length = data.readUInt16LE(offset + 2); offset += 4;
    if (offset + length > end) fail('Campo extra ZIP fora dos limites.');
    if (id === 1) { if (zip64) fail('Campo ZIP64 duplicado.'); zip64 = data.subarray(offset, offset + length); }
    offset += length;
  }
  return zip64;
}
function sizes(extra, rawSize, rawCompressed, rawOffset, rawDisk = 0) {
  let position = 0;
  const read = (raw, sentinel, width) => {
    if (raw !== sentinel) return raw;
    if (!extra || position + width > extra.length) fail('Campo ZIP64 obrigatorio ausente.');
    const result = width === 8 ? number64(extra, position) : extra.readUInt32LE(position); position += width;
    return result;
  };
  return { size: read(rawSize, 0xffffffff, 8), compressed: read(rawCompressed, 0xffffffff, 8),
    offset: rawOffset === undefined ? undefined : read(rawOffset, 0xffffffff, 8), disk: read(rawDisk, 0xffff, 4) };
}
function directory(data) {
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50 && offset + 22 + data.readUInt16LE(offset + 20) === data.length) { end = offset; break; }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) fail('Fim ZIP invalido ou multipartes.');
  let count = data.readUInt16LE(end + 10), diskCount = data.readUInt16LE(end + 8), size = data.readUInt32LE(end + 12), offset = data.readUInt32LE(end + 16), stop = end;
  const hasLocator = end >= 20 && data.readUInt32LE(end - 20) === 0x07064b50;
  if ([count, diskCount].includes(0xffff) || [size, offset].includes(0xffffffff) || hasLocator) {
    if (!hasLocator || data.readUInt32LE(end - 16) !== 0 || data.readUInt32LE(end - 4) !== 1) fail('Localizador ZIP64 invalido.');
    stop = number64(data, end - 12); within(data, stop, 56);
    if (data.readUInt32LE(stop) !== 0x06064b50) fail('Fim ZIP64 ausente.');
    const recordLength = number64(data, stop + 4);
    if (recordLength < 44 || stop + 12 + recordLength !== end - 20 || data.readUInt32LE(stop + 16) || data.readUInt32LE(stop + 20)) fail('Fim ZIP64 invalido ou multipartes.');
    const actualDiskCount = number64(data, stop + 24), actualCount = number64(data, stop + 32), actualSize = number64(data, stop + 40), actualOffset = number64(data, stop + 48);
    if (actualDiskCount !== actualCount || count !== 0xffff && count !== actualCount || diskCount !== 0xffff && diskCount !== actualDiskCount
      || size !== 0xffffffff && size !== actualSize || offset !== 0xffffffff && offset !== actualOffset) fail('Metadados ZIP e ZIP64 divergem.');
    count = actualCount; diskCount = actualDiskCount; size = actualSize; offset = actualOffset;
  }
  if (!count || count > MAX_ENTRIES || diskCount !== count || offset + size !== stop) fail('Diretorio ZIP invalido.');
  within(data, offset, size); return { count, offset, stop };
}
function entryName(bytes, isDirectory) {
  let name; try { name = decoder.decode(bytes); } catch { fail('Nome ZIP nao e UTF-8 valido.'); }
  const path = isDirectory ? name.slice(0, -1) : name;
  if (!path || name.length > 1024 || /[\\\x00-\x1f:]/.test(name) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('Nome de entrada ZIP inseguro.');
  return name;
}
function record(data, name) {
  let value; try { value = JSON.parse(decoder.decode(data)); } catch { fail('Registro da base nao e JSON UTF-8 valido.'); }
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string' || !value.id || value.id.length > 512
    || !timestamp(value.modified) || name.split('/').at(-1) !== `${value.id}.json`) fail('Registro JSON nao corresponde ao formato OSV.');
  if (value.affected !== undefined && (!Array.isArray(value.affected) || value.affected.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) fail('Affected OSV invalido.');
  if (value.withdrawn !== undefined && !timestamp(value.withdrawn)) fail('Withdrawn OSV invalido.');
}
function descriptorEnd(data, start, crc, size, compressed, central) {
  const candidates = [];
  for (const signature of [false, true]) for (const wide of [false, true]) {
    const length = (signature ? 4 : 0) + 4 + (wide ? 16 : 8);
    if (start + length > central) continue;
    let offset = start;
    if (signature) { if (data.readUInt32LE(offset) !== 0x08074b50) continue; offset += 4; }
    if (data.readUInt32LE(offset) !== crc) continue; offset += 4;
    const c = wide ? data.readBigUInt64LE(offset) : data.readUInt32LE(offset); offset += wide ? 8 : 4;
    const s = wide ? data.readBigUInt64LE(offset) : data.readUInt32LE(offset);
    if (c === (wide ? BigInt(compressed) : compressed) && s === (wide ? BigInt(size) : size)) candidates.push(start + length);
  }
  if (candidates.length !== 1) fail('Data descriptor ZIP invalido ou ambiguo.');
  return candidates[0];
}

// Parse without extracting. Every JSON record, payload CRC and range is checked.
// ZIP64 is required by the official npm dataset (> 65,535 records).
export function validateOsvDatabase(data, { maxEntryBytes = MAX_ENTRY, maxTotalBytes = MAX_TOTAL, maxEntries = MAX_ENTRIES } = {}) {
  if (!Buffer.isBuffer(data) || data.length < 22 || data.length > 512 * 1024 * 1024) fail('Tamanho ZIP OSV invalido.');
  for (const value of [maxEntryBytes, maxTotalBytes, maxEntries]) if (!Number.isSafeInteger(value) || value < 1) fail('Limite ZIP invalido.');
  const central = directory(data); if (central.count > maxEntries) fail('Numero de entradas ZIP excede o limite.');
  const names = new Set(), intervals = []; let offset = central.offset, records = 0, total = 0;
  for (let index = 0; index < central.count; index++) {
    within(data, offset, 46);
    if (offset + 46 > central.stop || data.readUInt32LE(offset) !== 0x02014b50) fail('Entrada central ZIP invalida.');
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), crc = data.readUInt32LE(offset + 16);
    const rawCompressed = data.readUInt32LE(offset + 20), rawSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28), extraLength = data.readUInt16LE(offset + 30), commentLength = data.readUInt16LE(offset + 32);
    const rawDisk = data.readUInt16LE(offset + 34), attributes = data.readUInt32LE(offset + 38), rawLocal = data.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > central.stop || flags & ~0x080e || ![0, 8].includes(method)) fail('Flags ou metodo ZIP nao suportados.');
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLength), isDirectory = nameBytes.at(-1) === 47;
    const name = entryName(nameBytes, isDirectory), type = (attributes >>> 16) & 0o170000;
    if (![0, 0o100000, 0o040000].includes(type) || (type === 0o040000 || attributes & 0x10) && !isDirectory) fail('Link ou arquivo especial em ZIP OSV.');
    if (names.has(name.toLowerCase())) fail('Nome ZIP duplicado.'); names.add(name.toLowerCase());
    const extra = extras(data, offset + 46 + nameLength, extraLength);
    const item = sizes(extra, rawSize, rawCompressed, rawLocal, rawDisk);
    if (item.disk || item.size > maxEntryBytes || item.compressed > data.length || (total += item.size) > maxTotalBytes) fail('Entradas ZIP excedem limites ou discos.');
    within(data, item.offset, 30);
    if (item.offset + 30 > central.offset || data.readUInt32LE(item.offset) !== 0x04034b50 || data.readUInt16LE(item.offset + 6) !== flags || data.readUInt16LE(item.offset + 8) !== method) fail('Cabecalho local ZIP diverge do central.');
    const localNameLength = data.readUInt16LE(item.offset + 26), localExtraLength = data.readUInt16LE(item.offset + 28);
    const start = item.offset + 30 + localNameLength + localExtraLength, payloadEnd = start + item.compressed;
    if (payloadEnd > central.offset || !data.subarray(item.offset + 30, item.offset + 30 + localNameLength).equals(nameBytes)) fail('Payload ou nome local ZIP invalido.');
    const localExtra = extras(data, item.offset + 30 + localNameLength, localExtraLength);
    const localCrc = data.readUInt32LE(item.offset + 14), localCompressed = data.readUInt32LE(item.offset + 18), localSize = data.readUInt32LE(item.offset + 22);
    let end = payloadEnd;
    if (!(flags & 8)) {
      const local = sizes(localExtra, localSize, localCompressed);
      if (localCrc !== crc || local.size !== item.size || local.compressed !== item.compressed) fail('Tamanhos ou CRC locais ZIP divergem.');
    } else {
      if (localCrc !== 0 && localCrc !== crc) fail('CRC local ZIP invalido.');
      end = descriptorEnd(data, payloadEnd, crc, item.size, item.compressed, central.offset);
    }
    intervals.push({ start: item.offset, end });
    let bytes;
    try { bytes = method === 0 ? data.subarray(start, payloadEnd) : inflateRawSync(data.subarray(start, payloadEnd), { maxOutputLength: maxEntryBytes }); }
    catch { fail('Payload ZIP nao pode ser descompactado com os limites definidos.'); }
    if (bytes.length !== item.size || crc32(bytes) !== crc) fail('Integridade CRC/tamanho do payload ZIP invalida.');
    if (isDirectory) { if (bytes.length) fail('Diretorio ZIP com conteudo.'); }
    else { if (!name.endsWith('.json')) fail('Base OSV contem arquivo que nao e JSON.'); record(bytes, name); records++; }
    offset = next;
  }
  if (offset !== central.stop || !records) fail('Diretorio ZIP incompleto ou sem registros OSV.');
  intervals.sort((a, b) => a.start - b.start); let previous = 0;
  for (const interval of intervals) { if (interval.start !== previous || interval.end <= interval.start) fail('Payloads ZIP sobrepostos, ocultos ou com lacunas.'); previous = interval.end; }
  if (previous !== central.offset) fail('Payload ZIP nao cobre o diretorio declarado.');
  return { format: 'osv-zip-v1', entries: central.count, records, compressedBytes: data.length, uncompressedBytes: total };
}
