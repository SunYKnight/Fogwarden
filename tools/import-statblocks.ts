import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { slugId } from '../src/core/import/ids';
import { parseStatBlock } from '../src/core/import/statblock';
import { errorMessage, openRepository } from './cli';

/** Usage: pnpm tsx tools/import-statblocks.ts <folder> [--data-root <path>] [--source <name>] */
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'data-root': { type: 'string' }, source: { type: 'string' } },
});
const folder = positionals[0];
if (!folder) {
  throw new Error('Usage: import-statblocks <folder> [--data-root <path>] [--source <name>]');
}
const { repository, dataRoot } = openRepository(values['data-root']);
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
    await repository.save('creature', { ...parsed, id, source });
    imported.set(id, file);
  } catch (error) {
    failures.push(`${file}: ${errorMessage(error)}`);
  }
}
console.log(`Imported ${imported.size} of ${files.length} stat blocks into ${join(dataRoot, 'library', 'creatures')}`);
if (failures.length > 0) {
  console.log(`Failed (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
