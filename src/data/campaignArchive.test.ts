import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newJournalEntry } from '@/core/campaign/journal';
import { formatCreatureFile } from '@/core/import/creatureFile';
import {
  createCampaign,
  createCreature,
  createEncounter,
  createMap,
  createMarkerTemplate,
  type AssetRef,
  type Encounter,
} from '@/core/model';
import { readZip, writeZip } from '@/core/zip';
import { spawnCombatant } from '@/state/encounterActions';
import { AURORA_PACK } from './auroraImport';
import { CampaignExistsError, exportCampaign, importCampaign, readCampaignZip } from './campaignArchive';
import { CampaignFiles, JOURNAL } from './campaignFiles';
import { MemoryStorage } from './memoryStorage';
import { packSource } from './packs';
import { libraryDocPath, mapAssetRef, Repository } from './repository';

const SRD = packSource('content', 'srd');
const NOW = new Date('2026-10-14T12:00:00Z');
const SPAWN = { hpMode: 'average', side: 'enemy', takenNames: [] } as const;
const PORTRAIT: AssetRef = { area: 'data', path: 'library/portraits/elf.png' };

function setup() {
  const storage = new MemoryStorage();
  return { storage, repository: new Repository(storage) };
}

function addSrd(storage: MemoryStorage) {
  storage.files.content.set('packs/srd/pack.json', JSON.stringify({ id: 'srd', name: 'SRD 5.1' }));
}

/**
 * Campaign "red-hand" with a journal entry, the encounter "ambush" and a party: on the My content map
 * "cellar" with a picture, a My content creature with a token, an SRD goblin with a My content portrait as
 * token and an area from a My content template; in the party a My content character and an Aurora one.
 */
async function sampleCampaign(): Promise<Uint8Array> {
  const { storage, repository } = setup();
  addSrd(storage);
  const goblin = createCreature('Goblin');
  storage.files.content.set(libraryDocPath('creature', SRD, goblin.id), formatCreatureFile(goblin));
  storage.files.data.set(PORTRAIT.path, new Uint8Array([7]));
  const picture = mapAssetRef('cellar', 'cellar.png');
  storage.files.data.set(picture.path, new Uint8Array([1, 2, 3]));
  const map = await repository.save('map', {
    ...createMap({ name: 'Cellar', image: null, squaresX: 4, squaresY: 3, pxPerSquare: 50 }),
    id: 'cellar',
    image: { asset: picture, widthPx: 200, heightPx: 150 },
  });
  const boss = await repository.save('creature', { ...createCreature('Cult leader'), id: 'cult-leader' });
  await repository.importCreaturePicture(boss.id, 'token', 'leader.png', new Uint8Array([4, 5]));
  const template = await repository.save('marker', { ...createMarkerTemplate('Fireball'), id: 'fireball' });
  const thorin = await repository.save('creature', { ...createCreature('Thorin'), id: 'thorin', kind: 'player' });
  await repository.ensurePack(AURORA_PACK);
  const elara = await repository.save('creature', { ...createCreature('Elara'), id: 'elara' }, AURORA_PACK.id);
  const party = [
    { id: 'p1', creature: { area: 'data', id: thorin.id }, player: 'Anna' },
    { id: 'p2', creature: { area: 'data', id: elara.id }, player: 'Ben' },
  ] as const;
  const campaign = await repository.saveCampaign({
    ...createCampaign('Red Hand'),
    id: 'red-hand',
    notes: 'Notes',
    party: [...party],
  });
  const leaderRef = { area: 'data', id: boss.id } as const;
  const leader = spawnCombatant(await repository.load('creature', leaderRef), leaderRef, SPAWN);
  const minion = { ...spawnCombatant(goblin, { area: 'content', id: goblin.id }, SPAWN), token: PORTRAIT };
  const encounter: Encounter = {
    ...createEncounter('Ambush', campaign.id, { area: 'data', id: map.id }),
    id: 'ambush',
    combatants: [leader, minion],
    markers: [
      {
        id: 'm1',
        templateId: template.id,
        label: 'Fireball',
        shape: 'sphere',
        sizeFt: 20,
        widthFt: 5,
        heightFt: 20,
        origin: { x: 5, y: 5, elevationFt: 0 },
        directionDeg: 0,
        color: '#ff6600',
        opacity: 0.35,
        visibleToPlayers: true,
      },
    ],
  };
  await repository.saveEncounter(encounter);
  const files = new CampaignFiles(storage, campaign.id);
  await files.save(JOURNAL, { ...newJournalEntry([], NOW), title: 'Session 1', encounters: [encounter.id] });
  return exportCampaign(repository, campaign.id, NOW);
}

describe('campaign archives', () => {
  it('round-trips a campaign with its encounter, journal and referenced library documents', async () => {
    const archive = await readCampaignZip(await sampleCampaign());
    expect(archive.manifest.campaign).toEqual({ id: 'red-hand', name: 'Red Hand' });
    expect(archive.manifest.library.map((d) => `${d.kind}:${d.id}`).sort()).toEqual([
      'creature:cult-leader',
      'creature:thorin',
      'map:cellar',
      'marker:fireball',
    ]);
    expect(archive.manifest.assets).toEqual([PORTRAIT.path]);
    expect(archive.manifest.packs).toEqual([
      { id: AURORA_PACK.id, name: AURORA_PACK.name },
      { id: 'srd', name: 'SRD 5.1' },
    ]);

    const { storage, repository } = setup();
    const result = await importCampaign(repository, archive, 'fail');
    expect(result).toEqual({
      id: 'red-hand',
      name: 'Red Hand',
      missingPacks: [
        { id: AURORA_PACK.id, name: AURORA_PACK.name },
        { id: 'srd', name: 'SRD 5.1' },
      ],
    });

    const { campaigns } = await repository.listCampaigns();
    expect(campaigns.map((c) => [c.id, c.name, c.notes, c.party.map((m) => m.player)])).toEqual([
      ['red-hand', 'Red Hand', 'Notes', ['Anna', 'Ben']],
    ]);
    expect((await repository.load('creature', campaigns[0]!.party[0]!.creature)).name).toBe('Thorin');
    const { encounters, problems } = await repository.listEncounters('red-hand');
    expect(problems).toEqual([]);
    expect(encounters.map((e) => e.name)).toEqual(['Ambush']);
    const [encounter] = encounters;
    const map = await repository.load('map', encounter!.map!);
    expect(map.name).toBe('Cellar');
    expect(storage.files.data.get(map.image!.asset.path)).toEqual(new Uint8Array([1, 2, 3]));
    const leader = await repository.load('creature', encounter!.combatants[0]!.creature!);
    expect(leader.token).toEqual({ area: 'data', path: 'library/creatures/cult-leader.token.png' });
    expect(storage.files.data.get(PORTRAIT.path)).toEqual(new Uint8Array([7]));
    expect((await repository.load('marker', { area: 'data', id: 'fireball' })).name).toBe('Fireball');
    const journal = await new CampaignFiles(storage, 'red-hand').list(JOURNAL);
    expect(journal.docs.map((d) => [d.title, d.encounters])).toEqual([['Session 1', ['ambush']]]);
  });

  it('imports again as a copy with new ids for the campaign, changed documents and files', async () => {
    const bytes = await sampleCampaign();
    const { storage, repository } = setup();
    await importCampaign(repository, await readCampaignZip(bytes), 'fail');
    await expect(importCampaign(repository, await readCampaignZip(bytes), 'fail')).rejects.toBeInstanceOf(
      CampaignExistsError,
    );
    const cellar = await repository.load('map', { area: 'data', id: 'cellar' });
    await repository.save('map', { ...cellar, name: 'Cellar, flooded' });
    const thorin = await repository.load('creature', { area: 'data', id: 'thorin' });
    await repository.save('creature', { ...thorin, name: 'Thorin, retired' });
    storage.files.data.set(PORTRAIT.path, new Uint8Array([8]));

    const copy = await importCampaign(repository, await readCampaignZip(bytes), 'copy');
    expect(copy.id).not.toBe('red-hand');
    expect(copy.name).toBe('Red Hand (2)');
    const [encounter] = (await repository.listEncounters(copy.id)).encounters;
    expect(encounter!.campaignId).toBe(copy.id);
    const mapRef = encounter!.map!;
    expect(mapRef.id).not.toBe('cellar');
    const map = await repository.load('map', mapRef);
    expect([map.id, map.name]).toEqual([mapRef.id, 'Cellar']);
    expect(map.image!.asset.path).toBe(`library/maps/${mapRef.id}/assets/cellar.png`);
    expect(storage.files.data.get(map.image!.asset.path)).toEqual(new Uint8Array([1, 2, 3]));
    const token = encounter!.combatants[1]!.token!;
    expect(token.path).toBe(`campaigns/${copy.id}/imported-assets/${PORTRAIT.path}`);
    expect(storage.files.data.get(token.path)).toEqual(new Uint8Array([7]));
    // Documents that did not change are shared with the first import.
    expect(encounter!.combatants[0]!.creature!.id).toBe('cult-leader');
    expect((await repository.load('map', { area: 'data', id: 'cellar' })).name).toBe('Cellar, flooded');
    expect((await repository.listCampaigns()).campaigns.map((c) => c.name)).toEqual(['Red Hand', 'Red Hand (2)']);
    const placed = (await repository.listCampaigns()).campaigns.find((c) => c.id === copy.id)!;
    const [character, aurora] = placed.party.map((m) => m.creature);
    expect(character!.id).not.toBe('thorin');
    expect((await repository.load('creature', character!)).name).toBe('Thorin');
    expect(aurora).toEqual({ area: 'data', id: 'elara' });

    const replaced = await importCampaign(repository, await readCampaignZip(bytes), 'replace');
    expect(replaced.id).toBe('red-hand');
    expect((await repository.listCampaigns()).campaigns).toHaveLength(2);
    expect(await storage.list('data', 'campaigns.importing')).toEqual([]);
  });

  it('reports no missing pack when the required packs are installed', async () => {
    const archive = await readCampaignZip(await sampleCampaign());
    const { storage, repository } = setup();
    addSrd(storage);
    await repository.ensurePack(AURORA_PACK);
    expect((await importCampaign(repository, archive, 'fail')).missingPacks).toEqual([]);
  });

  it('rejects archives that are no campaign archive', async () => {
    const zip = await writeZip([{ path: 'pack.json', bytes: new TextEncoder().encode('{}') }]);
    await expect(readCampaignZip(zip)).rejects.toThrow('no Fogwarden campaign archive');
  });

  it.each(['Con', 'red-hand.', 'red-hand ', 'red:hand'])('rejects the campaign id "%s"', async (id) => {
    const manifestSchema = z.looseObject({ campaign: z.looseObject({}) });
    const files = await readZip(await sampleCampaign());
    const edited = files.map(({ path, bytes }) => {
      let changed = bytes;
      if (path === 'fogwarden-campaign.json') {
        const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
        changed = new TextEncoder().encode(JSON.stringify({ ...manifest, campaign: { ...manifest.campaign, id } }));
      }
      return { path, bytes: changed };
    });
    await expect(readCampaignZip(await writeZip(edited))).rejects.toThrow('is not valid');
  });
});
