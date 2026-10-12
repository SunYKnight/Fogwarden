import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { slugId } from '../src/core/import/ids';
import { parseStatBlock } from '../src/core/import/statblock';
import { MY_CONTENT, packManifestSchema, writableSource } from '../src/data/packs';
import { libraryDir } from '../src/data/repository';
import { errorMessage, openRepository } from './cli';

const USAGE = 'Usage: import-statblocks <folder> [--data-root <path>] [--source <name>] [--pack <id>]';

/**
 * Usage: pnpm tsx tools/import-statblocks.ts <folder> [--data-root <path>] [--source <name>] [--pack <id>]
 * `--pack` writes into the content pack `packs/<id>/` (created with the source as its name when missing)
 * instead of My content, so a book can be switched off as a whole.
 */
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'data-root': { type: 'string' }, source: { type: 'string' }, pack: { type: 'string' } },
});
const folder = positionals[0];
if (!folder) {
  throw new Error(USAGE);
}
const { repository, dataRoot } = openRepository(values['data-root']);
const pack = values.pack ?? MY_CONTENT;
if (values.pack) {
  await repository.ensurePack(packManifestSchema.parse({ id: values.pack, name: values.source ?? values.pack }));
}
const files = readdirSync(folder)
  .filter((name) => name.toLowerCase().endsWith('.txt'))
  .sort();
const imported = new Map<string, string>();
const failures: string[] = [];
for (const file of files) {
  try {
    const parsed = parseStatBlock(readFileSync(join(folder, file), 'utf8'), { source: values.source });
    const source = parsed.source === '' ? basename(resolve(folder)) : parsed.source;
    // "Monster Manual (SRD)" and "(BR+)" are one book: one id per book+name.
    const id = slugId(source.replace(/\s*\([^)]*\)$/, ''), parsed.name);
    const clash = imported.get(id);
    if (clash) {
      throw new Error(`Same id "${id}" as ${clash}`);
    }
    await repository.save('creature', { ...parsed, id, source }, pack);
    imported.set(id, file);
  } catch (error) {
    failures.push(`${file}: ${errorMessage(error)}`);
  }
}
const target = join(dataRoot, libraryDir('creature', writableSource(pack)));
console.log(`Imported ${imported.size} of ${files.length} stat blocks into ${target}`);
if (failures.length > 0) {
  console.log(`Failed (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
