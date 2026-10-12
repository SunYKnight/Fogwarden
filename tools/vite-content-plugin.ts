import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { Plugin } from 'vite';

const LIST_PREFIX = '/__content/list';
const FILE_PREFIX = '/__content/file/';

function resolveInside(root: string, relative: string): string {
  const target = normalize(join(root, relative));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Path escapes content root: ${relative}`);
  }
  return target;
}

// Browser dev has no Tauri backend; serves shipped content to dev only.
export function contentDevServer(contentRoot: string): Plugin {
  const root = normalize(contentRoot);
  return {
    name: 'dm-tool-content-dev-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === LIST_PREFIX) {
          const dir = resolveInside(root, url.searchParams.get('dir') ?? '');
          const entries = existsSync(dir)
            ? readdirSync(dir).map((name) => ({ name, isDir: statSync(join(dir, name)).isDirectory() }))
            : [];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(entries));
        } else if (url.pathname.startsWith(FILE_PREFIX)) {
          const file = resolveInside(root, decodeURIComponent(url.pathname.slice(FILE_PREFIX.length)));
          if (existsSync(file) && statSync(file).isFile()) {
            createReadStream(file).pipe(res);
          } else {
            res.statusCode = 404;
            res.end();
          }
        } else {
          next();
        }
      });
    },
  };
}
