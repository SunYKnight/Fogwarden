/**
 * Minimal ZIP archive codec for content packs (dependency-free, like `png.ts`): stored and deflated entries,
 * no encryption, no ZIP64 (archives and entries below 4 GiB, fewer than 65536 entries). Deflate runs through
 * the platform's `CompressionStream`/`DecompressionStream` ('deflate-raw'), present in browsers and Node.
 */

export interface ZipFile {
  /** '/'-separated path inside the archive, never starting with '/' and without '..' parts. */
  path: string;
  bytes: Uint8Array;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const STORED = 0;
const DEFLATED = 8;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_MARK = 0xffffffff;
const VERSION = 20;
// 1980-01-01 00:00 in DOS date/time: fixed so equal packs zip to equal bytes.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Rejects names that would leave the folder they are unpacked into. */
function safePath(name: string): string {
  const path = name.replace(/\\/g, '/');
  const parts = path.split('/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || parts.some((p) => p === '..' || p === '.')) {
    throw new ZipError(`Unsafe file name in the archive: ${name}`);
  }
  return path;
}

function findEndRecord(view: DataView): number {
  const last = view.byteLength - END_RECORD_SIZE;
  let at = -1;
  for (let i = last; i >= Math.max(0, last - MAX_COMMENT) && at === -1; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      at = i;
    }
  }
  if (at === -1) {
    throw new ZipError('Not a ZIP archive');
  }
  return at;
}

async function readEntry(bytes: Uint8Array, view: DataView, at: number): Promise<ZipFile | null> {
  if (view.getUint32(at, true) !== CENTRAL_HEADER) {
    throw new ZipError('Damaged ZIP archive: bad central directory');
  }
  const flags = view.getUint16(at + 8, true);
  const method = view.getUint16(at + 10, true);
  const crc = view.getUint32(at + 16, true);
  const compressedSize = view.getUint32(at + 20, true);
  const size = view.getUint32(at + 24, true);
  const nameLength = view.getUint16(at + 28, true);
  const offset = view.getUint32(at + 42, true);
  const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
  if (compressedSize === ZIP64_MARK || size === ZIP64_MARK || offset === ZIP64_MARK) {
    throw new ZipError(`${name}: ZIP64 archives are not supported`);
  }
  if (flags & FLAG_ENCRYPTED) {
    throw new ZipError(`${name}: encrypted archives are not supported`);
  }
  if (method !== STORED && method !== DEFLATED) {
    throw new ZipError(`${name}: compression method ${method} is not supported (use deflate)`);
  }
  let file: ZipFile | null = null;
  if (!name.endsWith('/')) {
    if (view.getUint32(offset, true) !== LOCAL_HEADER) {
      throw new ZipError(`${name}: damaged ZIP archive (bad local header)`);
    }
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    const data = method === STORED ? raw.slice() : await transform(raw, new DecompressionStream('deflate-raw'));
    if (data.length !== size || crc32(data) !== crc) {
      throw new ZipError(`${name}: damaged ZIP archive (checksum mismatch)`);
    }
    file = { path: safePath(name), bytes: data };
  }
  return file;
}

/** Files of a ZIP archive in central directory order; folder entries are left out. */
export async function readZip(bytes: Uint8Array): Promise<ZipFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    const file = await readEntry(bytes, view, at);
    if (file) {
      files.push(file);
    }
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

interface Packed {
  name: Uint8Array;
  method: number;
  crc: number;
  size: number;
  data: Uint8Array;
  offset: number;
}

function header(signature: number, length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}

/** Fields local and central headers share, written at `at`. */
function writeCommon(view: DataView, at: number, entry: Packed): void {
  view.setUint16(at, VERSION, true);
  view.setUint16(at + 2, FLAG_UTF8, true);
  view.setUint16(at + 4, entry.method, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, DOS_DATE, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.data.length, true);
  view.setUint32(at + 18, entry.size, true);
  view.setUint16(at + 22, entry.name.length, true);
}

/** A ZIP archive of `files`; deflated where that is smaller, stored otherwise. */
export async function writeZip(files: ZipFile[]): Promise<Uint8Array> {
  if (files.length > 0xffff) {
    throw new ZipError('Too many files for a ZIP archive');
  }
  const parts: Uint8Array[] = [];
  const entries: Packed[] = [];
  let offset = 0;
  for (const file of files) {
    const deflated = await transform(file.bytes, new CompressionStream('deflate-raw'));
    const smaller = deflated.length < file.bytes.length;
    const entry: Packed = {
      name: new TextEncoder().encode(safePath(file.path)),
      method: smaller ? DEFLATED : STORED,
      crc: crc32(file.bytes),
      size: file.bytes.length,
      data: smaller ? deflated : file.bytes,
      offset,
    };
    if (offset + entry.data.length > ZIP64_MARK - 1) {
      throw new ZipError('Pack too large for a ZIP archive (4 GiB)');
    }
    const local = header(LOCAL_HEADER, 30 + entry.name.length);
    writeCommon(local.view, 4, entry);
    local.bytes.set(entry.name, 30);
    parts.push(local.bytes, entry.data);
    entries.push(entry);
    offset += local.bytes.length + entry.data.length;
  }
  const centralStart = offset;
  for (const entry of entries) {
    const central = header(CENTRAL_HEADER, 46 + entry.name.length);
    central.view.setUint16(4, VERSION, true);
    writeCommon(central.view, 6, entry);
    central.view.setUint32(42, entry.offset, true);
    central.bytes.set(entry.name, 46);
    parts.push(central.bytes);
    offset += central.bytes.length;
  }
  const end = header(END_OF_CENTRAL, END_RECORD_SIZE);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, offset - centralStart, true);
  end.view.setUint32(16, centralStart, true);
  parts.push(end.bytes);
  const archive = new Uint8Array(offset + END_RECORD_SIZE);
  let at = 0;
  for (const part of parts) {
    archive.set(part, at);
    at += part.length;
  }
  return archive;
}
