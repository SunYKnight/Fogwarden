import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  PLAYER_UPLOAD_MAX_BYTES,
  PLAYER_UPLOAD_SNIFF_BYTES,
  RELAY_MAX_UPLOAD_BYTES,
  sniffPicture,
  type PlayerUploadType,
} from '@/sync/relayApi';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const SEGMENT = /^[^/\\\0:]+$/;

/**
 * Absolute file below `root` for a '/'-separated relative path. Rejects empty, `.` and `..` segments,
 * backslashes and drive colons, so no request names a file outside `root`.
 */
export function containedPath(root: string, path: string): string {
  const segments = path.split('/');
  const valid = segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');
  const file = resolve(root, ...segments);
  if (!valid || !file.startsWith(resolve(root) + sep)) {
    throw new HttpError(400, `invalid path: ${path}`);
  }
  return file;
}

interface Hashed {
  size: number;
  mtimeMs: number;
  sha256: string;
}

/** Uploaded files with a SHA-256 cache, so "is this file current" never rereads a large map image twice. */
export class FileStore {
  private readonly hashes = new Map<string, Hashed>();

  constructor(private readonly root: string) {}

  file(...parts: string[]): string {
    return join(this.root, ...parts);
  }

  async sha256(file: string): Promise<string | null> {
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => missingAsNull(error));
    const cached = info ? this.hashes.get(file) : undefined;
    const fresh = cached && info && cached.size === info.size && cached.mtimeMs === info.mtimeMs;
    const hash = info === null ? null : fresh ? cached.sha256 : await this.hashFile(file, info);
    return hash;
  }

  private async hashFile(file: string, info: Stats): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    const sha256 = hash.digest('hex');
    this.hashes.set(file, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
    return sha256;
  }

  /**
   * Streams the request body to `file` through a temporary file, so readers never see a partial upload.
   * `check` sees every chunk and may refuse the upload; `accept` checks the complete body and gives the result.
   */
  private async stream<T>(
    request: IncomingMessage,
    file: string,
    check: (chunk: Buffer) => HttpError | null,
    accept: () => T,
  ): Promise<T> {
    const temp = this.file('tmp', randomBytes(8).toString('hex'));
    await mkdir(dirname(temp), { recursive: true });
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        callback(check(chunk), chunk);
      },
    });
    let result: T;
    try {
      await pipeline(request, meter, createWriteStream(temp));
      result = accept();
      await mkdir(dirname(file), { recursive: true });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
    return result;
  }

  /** Receives an upload of the DM app and checks its size and hash on the way. */
  async receive(request: IncomingMessage, file: string, expectedSha256: string): Promise<void> {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > RELAY_MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `file larger than ${RELAY_MAX_UPLOAD_BYTES} bytes`);
    }
    const hash = createHash('sha256');
    let size = 0;
    const check = (chunk: Buffer) => {
      size += chunk.length;
      hash.update(chunk);
      return size > RELAY_MAX_UPLOAD_BYTES ? new HttpError(413, 'upload too large') : null;
    };
    const sha256 = await this.stream(request, file, check, () => {
      const actual = hash.digest('hex');
      if (actual !== expectedSha256) {
        throw new HttpError(400, `${file}: body hash ${actual} does not match ${expectedSha256}`);
      }
      return actual;
    });
    const info = await stat(file);
    this.hashes.set(file, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
  }

  /**
   * Receives a player's picture: at most `PLAYER_UPLOAD_MAX_BYTES`, and its first bytes must be PNG, JPEG or
   * WebP. Only those first bytes are looked at, so the relay stays a forwarder.
   */
  async receivePicture(request: IncomingMessage, file: string): Promise<{ type: PlayerUploadType; size: number }> {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > PLAYER_UPLOAD_MAX_BYTES) {
      throw new HttpError(413, `pictures may have at most ${PLAYER_UPLOAD_MAX_BYTES} bytes`);
    }
    let size = 0;
    let head = Buffer.alloc(0);
    const notPicture = () => new HttpError(415, 'only PNG, JPEG and WebP pictures');
    const check = (chunk: Buffer) => {
      const sniffing = head.length < PLAYER_UPLOAD_SNIFF_BYTES;
      size += chunk.length;
      head = sniffing ? Buffer.concat([head, chunk.subarray(0, PLAYER_UPLOAD_SNIFF_BYTES - head.length)]) : head;
      // Refused as soon as the first bytes are in, not after 10 MB.
      const wrong = sniffing && head.length >= PLAYER_UPLOAD_SNIFF_BYTES && sniffPicture(head) === null;
      const large = size > PLAYER_UPLOAD_MAX_BYTES;
      return wrong ? notPicture() : large ? new HttpError(413, 'picture too large') : null;
    };
    const type = await this.stream(request, file, check, () => {
      const sniffed = sniffPicture(head);
      if (sniffed === null) {
        throw notPicture();
      }
      return sniffed;
    });
    return { type, size };
  }

  /** Reads a small text file; null if it does not exist yet. */
  async readText(name: string): Promise<string | null> {
    return readFile(this.file(name), 'utf8').catch((error: NodeJS.ErrnoException) => missingAsNull(error));
  }

  /** Names in a folder; empty if it does not exist yet. */
  async list(dir: string): Promise<string[]> {
    return readdir(dir).catch((error: NodeJS.ErrnoException) => missingAsNull(error) ?? []);
  }

  /** Replaces a small private text file through a temporary file, so a crash never leaves it half written. */
  async writeText(name: string, text: string): Promise<void> {
    const temp = this.file('tmp', randomBytes(8).toString('hex'));
    await mkdir(dirname(temp), { recursive: true });
    try {
      await writeFile(temp, text, { mode: 0o600 });
      await mkdir(dirname(this.file(name)), { recursive: true });
      await rename(temp, this.file(name));
    } finally {
      await rm(temp, { force: true });
    }
  }
}

function missingAsNull(error: NodeJS.ErrnoException): null {
  if (error.code !== 'ENOENT') {
    throw error;
  }
  return null;
}
