import { deflateRawSync } from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deterministic standard ZIP archive. No paths can escape an extraction directory. */
export function createZip(entries) {
  const files = [];
  const central = [];
  const names = new Set();
  let offset = 0;
  for (const [entryName, input] of entries) {
    if (typeof entryName !== 'string' || !entryName || entryName.startsWith('/') || entryName.includes('\\') || entryName.split('/').some(part => !part || part === '.' || part === '..') || names.has(entryName)) throw new Error('ZIP 文件路径无效或重复。');
    names.add(entryName);
    const name = Buffer.from(entryName, 'utf8');
    const body = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    const compressed = deflateRawSync(body, { level: 9 });
    const crc = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01; reproducible builds.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    files.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  if (names.size > 65_535 || offset > 0xffffffff) throw new Error('ZIP 内容过大。');
  const directory = Buffer.concat(central);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(names.size, 8);
  footer.writeUInt16LE(names.size, 10);
  footer.writeUInt32LE(directory.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, footer]);
}
