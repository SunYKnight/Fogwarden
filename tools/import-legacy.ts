import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { planLegacyImport, runLegacyImport, type LegacyProblem, type LegacySource } from '../src/data/legacyImport';
import { openRepository } from './cli';

/** Usage: pnpm tsx tools/import-legacy.ts <legacy data folder> [--data-root <path>] */
const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'data-root': { type: 'string' } } });
if (!positionals[0]) {
  throw new Error('Usage: import-legacy <path to 240722_DnD_DMTool_Data> [--data-root <path>]');
}
const { repository, dataRoot } = openRepository(values['data-root']);
const source: LegacySource = {
  list: async (folder) =>
    (await readdir(folder, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory() })),
  readText: (file) => readFile(file, 'utf8'),
  readBytes: async (file) => new Uint8Array(await readFile(file)),
};

const plan = await planLegacyImport(source, resolve(positionals[0]));
const { imported, skipped, warnings } = await runLegacyImport(plan, source, repository);
const lines = (problems: LegacyProblem[]) => problems.map((p) => `\n  ${p.file}: ${p.message}`).join('');
console.log(`Data root: ${dataRoot}`);
console.log(
  `Imported: ${imported.creatures} creatures, ${imported.maps} maps, ${imported.areaTemplates} area templates`,
);
console.log(`Warnings (${warnings.length}):${lines(warnings)}`);
console.log(`Skipped (${skipped.length}):${lines(skipped)}`);
