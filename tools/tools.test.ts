import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { calendarSchema } from '../src/core/campaign/calendar';
import { imageSize } from '../src/core/imageSize';
import { campaignSchema, defaultSettings, encounterSchema } from '../src/core/model';
import { HeightField } from '../src/core/terrain/heightfield';
import { CampaignFiles, CAST, JOURNAL, QUESTS } from '../src/data/campaignFiles';
import { campaignPath, Repository } from '../src/data/repository';
import { StorageError } from '../src/data/storage';
import { ensureSampleCampaign } from '../src/ui/home/sampleCampaign';
import {
  createSampleEncounter,
  SAMPLE_CAMPAIGN_ID,
  SAMPLE_ENCOUNTER_ID,
  SAMPLE_GOBLIN,
  SAMPLE_MAP,
  SAMPLE_NIGHT_ID,
  SAMPLE_PREPARED_ID,
} from '../src/ui/home/sampleContent';
import { CONTENT_ROOT, PROJECT_ROOT } from './cli';
import { NodeStorage } from './nodeStorage';

const scratchParent = join(PROJECT_ROOT, 'data-local');
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, 'tools-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('shipped SRD content', () => {
  const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));

  it('loads every creature and marker without problems', async () => {
    const creatures = await repository.list('creature');
    const markers = await repository.list('marker');
    expect(creatures.problems).toEqual([]);
    expect(markers.problems).toEqual([]);
    expect(creatures.entries.length).toBeGreaterThanOrEqual(300);
    expect(creatures.entries.every((e) => e.doc.license === 'CC-BY-4.0' && e.pack === 'srd')).toBe(true);
    expect(markers.entries.map((e) => [e.doc.name, e.doc.shape, e.doc.sizeFt])).toEqual([
      ['Burning Hands', 'cone', 15],
      ['Fireball', 'sphere', 20],
      ['Lightning Bolt', 'line', 100],
      ['Moonbeam', 'cylinder', 5],
      ['Thunderwave', 'cube', 15],
    ]);
  });

  it('ships every pack with a manifest and its license', async () => {
    const { packs, problems } = await repository.listPacks();
    expect(problems).toEqual([]);
    const shipped = packs.filter((p) => p.origin === 'shipped');
    expect(shipped.map((p) => [p.manifest.id, p.manifest.name])).toEqual([
      ['cc0-models', 'CC0 models'],
      ['sample-map', 'Sample map'],
      ['srd', 'SRD 5.1'],
    ]);
    expect(shipped.map((p) => p.counts)).toEqual([
      { creature: 0, marker: 0, map: 0, table: 0, item: 0, spell: 0, model: 11, portrait: 0 },
      { creature: 0, marker: 0, map: 1, table: 0, item: 0, spell: 0, model: 0, portrait: 0 },
      { creature: 334, marker: 5, map: 0, table: 0, item: 0, spell: 0, model: 0, portrait: 0 },
    ]);
    expect(shipped.every((p) => existsSync(join(CONTENT_ROOT, p.source.root, 'LICENSE.md')))).toBe(true);
  });
});

describe('shipped sample map', () => {
  const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));

  it('loads with its image and the 3D features the sample is meant to show', async () => {
    const { entries, problems } = await repository.list('map');
    expect(problems).toEqual([]);
    const map = entries.find((e) => e.ref.id === SAMPLE_MAP.id)!.doc;
    const png = readFileSync(join(CONTENT_ROOT, map.image!.asset.path));
    expect(imageSize(png)).toEqual({ widthPx: map.image!.widthPx, heightPx: map.image!.heightPx });
    expect(map.grid.squaresX * map.grid.pxPerSquare).toBe(map.image!.widthPx);
    expect(map.openings.map((o) => o.kind)).toContain('door');
    expect(map.rooms).toHaveLength(1);
    expect(map.regions.some((r) => r.kind === 'light' && r.light === 'darkness')).toBe(true);
    expect(map.lights.length).toBeGreaterThan(0);
  });

  it('builds the sample encounter with four goblins and two PCs on the map', async () => {
    const map = await repository.load('map', SAMPLE_MAP);
    const goblin = await repository.load('creature', SAMPLE_GOBLIN);
    const encounter = encounterSchema.parse(createSampleEncounter(map, goblin));
    const terrain = HeightField.fromMap(map);
    expect(encounter.map).toEqual(SAMPLE_MAP);
    const goblins = encounter.combatants.filter((c) => c.side === 'enemy').map((c) => c.name);
    expect(goblins).toHaveLength(4);
    expect(new Set(goblins).size).toBe(4);
    expect(goblins.every((name) => /^Goblin \d\d$/.test(name))).toBe(true);
    expect(encounter.combatants.filter((c) => c.side === 'player')).toHaveLength(2);
    for (const { position } of encounter.combatants) {
      expect(position!.x).toBeGreaterThan(0);
      expect(position!.x).toBeLessThan(map.grid.squaresX * map.grid.feetPerSquare);
      expect(position!.y).toBeLessThan(map.grid.squaresY * map.grid.feetPerSquare);
      expect(position!.elevationFt).toBeCloseTo(terrain.sample(position!.x, position!.y), 6);
    }
  });
});

describe('sample campaign', () => {
  const repository = new Repository(new NodeStorage(mkdtempSync(join(scratch, 'sample-')), CONTENT_ROOT));
  const files = new CampaignFiles(repository.storage, SAMPLE_CAMPAIGN_ID);
  const encounterIds = [SAMPLE_ENCOUNTER_ID, SAMPLE_PREPARED_ID, SAMPLE_NIGHT_ID];

  it('creates every document so that it parses with its schema', async () => {
    await ensureSampleCampaign(repository);
    const { campaigns, problems } = await repository.listCampaigns();
    expect(problems).toEqual([]);
    expect(campaigns.map((c) => campaignSchema.parse(c).id)).toEqual([SAMPLE_CAMPAIGN_ID]);
    expect(campaigns[0]!.notes).toContain('## Premise');
    const [journal, quests, cast] = await Promise.all([files.list(JOURNAL), files.list(QUESTS), files.list(CAST)]);
    expect([...journal.problems, ...quests.problems, ...cast.problems]).toEqual([]);
    expect(journal.docs.map((d) => d.session).sort()).toEqual([1, 2]);
    expect(new Set(quests.docs.map((d) => d.status))).toEqual(new Set(['open', 'done', 'failed']));
    expect(new Set(cast.docs.map((d) => d.kind))).toEqual(new Set(['person', 'place']));
    const calendar = calendarSchema.parse(await files.loadCalendar());
    expect(calendar.events.length).toBeGreaterThan(0);
    const listed = await repository.listEncounters(SAMPLE_CAMPAIGN_ID);
    expect(listed.problems).toEqual([]);
    expect(listed.encounters.map((e) => encounterSchema.parse(e).id).sort()).toEqual(encounterIds.sort());
    expect(listed.encounters.every((e) => e.map?.id === SAMPLE_MAP.id)).toBe(true);
  });

  it('shows light, a hidden monster, an area and timed effects at night', async () => {
    const night = await repository.loadEncounter(SAMPLE_CAMPAIGN_ID, SAMPLE_NIGHT_ID);
    const players = night.combatants.filter((c) => c.side === 'player');
    expect(night.atmosphere.minute).toBeGreaterThanOrEqual(20 * 60);
    expect(players.filter((c) => c.light !== null)).toHaveLength(1);
    expect(players.filter((c) => (c.senses.darkvision ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    expect(night.combatants.filter((c) => c.hiddenFromPlayers).map((c) => c.side)).toEqual(['enemy']);
    expect(night.markers.map((m) => m.templateId)).toEqual(['srd-moonbeam']);
    const effects = night.combatants.flatMap((c) => c.effects);
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.every((e) => e.expires !== null)).toBe(true);
    expect(night.combatants.every((c) => c.position !== null)).toBe(true);
    const prepared = await repository.loadEncounter(SAMPLE_CAMPAIGN_ID, SAMPLE_PREPARED_ID);
    expect(prepared.combatants.length).toBeGreaterThan(0);
    expect(prepared.combatants.every((c) => c.position === null)).toBe(true);
  });

  it('later only brings back the goblin ambush and keeps what the DM changed or deleted', async () => {
    const quest = await files.load(QUESTS, 'find-tomas');
    await files.save(QUESTS, { ...quest, notes: 'Edited by the DM' });
    await repository.storage.remove('campaigns/sample-campaign/journal/2026-10-03-session-2.md');
    await repository.removeEncounter(SAMPLE_CAMPAIGN_ID, SAMPLE_NIGHT_ID);
    await repository.removeEncounter(SAMPLE_CAMPAIGN_ID, SAMPLE_ENCOUNTER_ID);
    const before = await repository.listFiles('data', 'campaigns');
    await ensureSampleCampaign(repository);
    const after = await repository.listFiles('data', 'campaigns');
    const added = after.filter((path) => !before.includes(path));
    expect(before.every((path) => after.includes(path))).toBe(true);
    expect(added).toContain(`campaigns/${SAMPLE_CAMPAIGN_ID}/encounters/${SAMPLE_ENCOUNTER_ID}/encounter.json`);
    expect(added.every((path) => path.includes(`/encounters/${SAMPLE_ENCOUNTER_ID}/`))).toBe(true);
    expect((await files.load(QUESTS, 'find-tomas')).notes).toBe('Edited by the DM');
    expect((await repository.listCampaigns()).campaigns).toHaveLength(1);
  });

  it('asks to enable the Sample map pack when it is hidden', async () => {
    const hidden = new Repository(new NodeStorage(mkdtempSync(join(scratch, 'hidden-')), CONTENT_ROOT));
    await hidden.saveSettings({ ...defaultSettings(), packs: { order: [], disabled: ['sample-map'] } });
    await expect(ensureSampleCampaign(hidden)).rejects.toThrow('"Sample map"; enable it under Settings > Content');
    expect(await hidden.storage.exists('data', campaignPath(SAMPLE_CAMPAIGN_ID))).toBe(false);
  });
});

describe('NodeStorage', () => {
  const storage = new NodeStorage(scratch, CONTENT_ROOT);

  it('writes atomically without leaving temp files and lists sorted entries', async () => {
    await storage.writeText('a/b.json', '1');
    await storage.writeText('a/b.json', '2');
    await storage.writeBytes('a/A.bin', new Uint8Array([1]));
    expect(await storage.readText('data', 'a/b.json')).toBe('2');
    expect(readdirSync(join(scratch, 'a'))).not.toContain('b.json.tmp');
    expect(await storage.list('data', 'a')).toEqual([
      { name: 'A.bin', isDir: false },
      { name: 'b.json', isDir: false },
    ]);
    expect(await storage.list('data', 'missing')).toEqual([]);
  });

  it('refuses paths that leave the storage root', async () => {
    await expect(storage.readText('data', '../outside.json')).rejects.toThrow(StorageError);
    await expect(storage.writeText('a/../../x', '')).rejects.toThrow(StorageError);
    await expect(storage.writeText('C:/x', '')).rejects.toThrow(StorageError);
    await expect(storage.remove('')).rejects.toThrow(StorageError);
  });
});
