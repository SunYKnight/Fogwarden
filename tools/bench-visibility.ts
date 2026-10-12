import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BitSet, bytesToBase64 } from '../src/core/binary';
import { parseCreatureFile } from '../src/core/import/creatureFile';
import { mapSchema } from '../src/core/model';
import { HeightField } from '../src/core/terrain/heightfield';
import { exploreBySource, fogSize, viewFog, type FogSources } from '../src/core/vision/fog';
import { computeVisibility, type VisionState } from '../src/core/vision/visibility';
import { filterEncounterForPlayers } from '../src/sync/playerFilter';
import { createSampleEncounter, SAMPLE_GOBLIN, SAMPLE_MAP } from '../src/ui/home/sampleContent';
import { CONTENT_ROOT } from './cli';

/**
 * Player view cost of the sample encounter (2 PCs) per fog resolution, median of repeated runs: the
 * visibility computation (worker), the party's fog (always), and what each connected character view adds.
 * Usage: pnpm tsx tools/bench-visibility.ts
 */
const RUNS = 200;

const map = mapSchema.parse(JSON.parse(readFileSync(join(CONTENT_ROOT, 'maps', SAMPLE_MAP.id, 'map.json'), 'utf8')));
const goblin = parseCreatureFile(
  readFileSync(join(CONTENT_ROOT, 'creatures', `${SAMPLE_GOBLIN.id}.txt`), 'utf8'),
  SAMPLE_GOBLIN.id,
);
const encounter = createSampleEncounter(map, goblin);
const terrain = HeightField.fromMap(map);
const pcs = encounter.combatants.filter((c) => c.side === 'player').map((c) => c.id);

function median(run: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[RUNS >> 1]!;
}

for (const cellsPerSquare of [2, 4, 8]) {
  const state: VisionState = {
    openingStates: encounter.openingStates,
    combatants: encounter.combatants,
    cellsPerSquare,
  };
  const size = fogSize(map.grid, cellsPerSquare);
  const count = size.cellsX * size.cellsY;
  const visible = computeVisibility(map, terrain, state);
  const sources: FogSources = {
    size,
    visible,
    explored: new Map(),
    revealed: new BitSet(count),
    hidden: new BitSet(count),
  };
  const worker = median(() => computeVisibility(map, terrain, state));
  const party = median(() => {
    exploreBySource(sources.explored as Map<string, BitSet>, visible, sources.hidden);
    viewFog(sources, pcs);
  });
  const character = median(() => {
    const fog = viewFog(sources, [pcs[0]!]);
    filterEncounterForPlayers(encounter, map, fog);
    bytesToBase64(fog.cells);
  });
  console.log(
    `${cellsPerSquare} cells/square (${count} cells): visibility ${worker.toFixed(2)} ms, ` +
      `party fog ${party.toFixed(2)} ms, each connected character view +${character.toFixed(2)} ms`,
  );
}
