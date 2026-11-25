import { deflateRawSync } from 'node:zlib';

const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// Minimal deterministic ZIP builder for synthetic OSV database fixtures.
export function zipFixture(entries, { zip64 = false, descriptor = false, stored = false } = {}) {
  const files = [], index = []; let offset = 0;
  const rows = Array.isArray(entries) ? entries : Object.entries(entries);
  for (const [name, text] of rows) {
    const filename = Buffer.from(name), bytes = Buffer.from(text), zipped = stored ? bytes : deflateRawSync(bytes), crc = crc32(bytes);
    const localExtra = Buffer.alloc(zip64 ? 20 : 0), centralExtra = Buffer.alloc(zip64 ? 28 : 0);
    if (zip64) {
      localExtra.writeUInt16LE(1); localExtra.writeUInt16LE(16, 2); localExtra.writeBigUInt64LE(BigInt(bytes.length), 4); localExtra.writeBigUInt64LE(BigInt(zipped.length), 12);
      centralExtra.writeUInt16LE(1); centralExtra.writeUInt16LE(24, 2); centralExtra.writeBigUInt64LE(BigInt(bytes.length), 4); centralExtra.writeBigUInt64LE(BigInt(zipped.length), 12); centralExtra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const trailer = Buffer.alloc(descriptor ? zip64 ? 24 : 16 : 0);
    if (descriptor) {
      trailer.writeUInt32LE(0x08074b50); trailer.writeUInt32LE(crc, 4);
      if (zip64) { trailer.writeBigUInt64LE(BigInt(zipped.length), 8); trailer.writeBigUInt64LE(BigInt(bytes.length), 16); }
      else { trailer.writeUInt32LE(zipped.length, 8); trailer.writeUInt32LE(bytes.length, 12); }
    }
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(zip64 ? 45 : 20, 4); local.writeUInt16LE(descriptor ? 8 : 0, 6); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(descriptor ? 0 : crc, 14); local.writeUInt32LE(zip64 ? 0xffffffff : descriptor ? 0 : zipped.length, 18); local.writeUInt32LE(zip64 ? 0xffffffff : descriptor ? 0 : bytes.length, 22); local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(localExtra.length, 28);
    files.push(local, filename, localExtra, zipped, trailer);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(zip64 ? 45 : 20, 4); central.writeUInt16LE(zip64 ? 45 : 20, 6); central.writeUInt16LE(descriptor ? 8 : 0, 8); central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(zip64 ? 0xffffffff : zipped.length, 20); central.writeUInt32LE(zip64 ? 0xffffffff : bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(centralExtra.length, 30); central.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    index.push(central, filename, centralExtra); offset += local.length + filename.length + localExtra.length + zipped.length + trailer.length;
  }
  const table = Buffer.concat(index), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(zip64 ? 0xffff : rows.length, 8); end.writeUInt16LE(zip64 ? 0xffff : rows.length, 10); end.writeUInt32LE(zip64 ? 0xffffffff : table.length, 12); end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  const tail = [];
  if (zip64) {
    const wide = Buffer.alloc(56), locator = Buffer.alloc(20); wide.writeUInt32LE(0x06064b50); wide.writeBigUInt64LE(44n, 4); wide.writeUInt16LE(45, 12); wide.writeUInt16LE(45, 14);
    wide.writeBigUInt64LE(BigInt(rows.length), 24); wide.writeBigUInt64LE(BigInt(rows.length), 32); wide.writeBigUInt64LE(BigInt(table.length), 40); wide.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + table.length), 8); locator.writeUInt32LE(1, 16); tail.push(wide, locator);
  }
  return Buffer.concat([...files, table, ...tail, end]);
}
