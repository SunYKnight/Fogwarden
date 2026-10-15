import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mergeManifests, updateManifestSchema } from './updateManifest.ts';

// Each platform's `pnpm package` writes its own latest-<platform>.json; the
// release needs one latest.json with every platform for the updater.
const artifacts = resolve(import.meta.dirname, '..', 'artifacts');
const files = readdirSync(artifacts).filter((name) => /^latest-.+\.json$/.test(name));
const manifest = mergeManifests(
  files.map((name) => updateManifestSchema.parse(JSON.parse(readFileSync(join(artifacts, name), 'utf8')))),
);
writeFileSync(join(artifacts, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `latest.json for v${manifest.version} in ${artifacts} from ${files.join(', ')}: ` +
    Object.keys(manifest.platforms).join(', '),
);
