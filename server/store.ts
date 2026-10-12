import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { RELAY_MAX_UPLOAD_BYTES } from '@/sync/relayApi';

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
   * Streams the request body to `file` through a temporary file, so readers never see a partial upload, and
   * checks size and hash on the way.
   */
  async receive(request: IncomingMessage, file: string, expectedSha256: string): Promise<void> {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > RELAY_MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `file larger than ${RELAY_MAX_UPLOAD_BYTES} bytes`);
    }
    const temp = this.file('tmp', randomBytes(8).toString('hex'));
    await mkdir(dirname(temp), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(size > RELAY_MAX_UPLOAD_BYTES ? new HttpError(413, 'upload too large') : null, chunk);
      },
    });
    try {
      await pipeline(request, meter, createWriteStream(temp));
      const sha256 = hash.digest('hex');
      if (sha256 !== expectedSha256) {
        throw new HttpError(400, `${file}: body hash ${sha256} does not match ${expectedSha256}`);
      }
      await mkdir(dirname(file), { recursive: true });
      await rename(temp, file);
      const info = await stat(file);
      this.hashes.set(file, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
    } finally {
      await rm(temp, { force: true });
    }
  }

  /** Reads a small text file, creating it with `create()` on first use. */
  async readOrCreate(name: string, create: () => string): Promise<string> {
    const file = this.file(name);
    const existing = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => missingAsNull(error));
    const text = existing ?? create();
    if (existing === null) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text, { mode: 0o600 });
    }
    return text;
  }
}

function missingAsNull(error: NodeJS.ErrnoException): null {
  if (error.code !== 'ENOENT') {
    throw error;
  }
  return null;
}
