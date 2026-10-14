import { createCalendar, type Calendar } from '@/core/campaign/calendar';
import type { JournalEntry } from '@/core/campaign/journal';
import type { CastEntry } from '@/core/campaign/people';
import type { Quest } from '@/core/campaign/quests';
import { createCampaign, type Campaign } from '@/core/model';
import { CampaignFiles, CAST, JOURNAL, QUESTS } from '@/data/campaignFiles';
import { importApiMonsters } from '@/data/dnd5eApiImport';
import { campaignPath, encounterPath, type Repository } from '@/data/repository';
import {
  loadSampleLibrary,
  SAMPLE_CAMPAIGN_ID,
  SAMPLE_ENCOUNTER_ID,
  SAMPLE_ENCOUNTERS,
  SAMPLE_MAP,
  SAMPLE_MONSTER_INDEXES,
  SAMPLE_NIGHT_ID,
  SAMPLE_PREPARED_ID,
} from './sampleContent';

/** A tour of the campaign tabs: two played sessions, quests in every state, people, places and a calendar. */

const NOTES = `# The chapel in the woods

A short sample campaign for three level 3 characters. Change or delete anything you like; "Open the sample
encounter" on the Home page only brings back the goblin ambush.

## Premise

Pilgrims from Oakhollow vanish on the road to the ruined chapel of Saint Ilmara. Grisk's goblins prey on the
road, but the real threat is Brother Aldric, the chapel's former priest, who wakes the dead for a midnight rite.

## Where to look

- **Journal**: two played sessions; Play adds a timeline to the next one.
- **People & places**: Sister Wren, Brother Aldric, Grisk, Oakhollow and the ruined chapel, linked to the
  encounters they appear in.
- **Quests**: open, done and failed.
- **Calendar**: Harptos, the night of the vigil, with the coming rite as an event.
- **Encounters**: the goblin ambush by day; the night vigil with darkvision, a torch, a shadow hidden from the
  players, a Moonbeam area and timed effects; the midnight rite, prepared but not yet placed on the map.
`;

export function createSampleCampaign(): Campaign {
  return { ...createCampaign('The chapel in the woods (sample)'), id: SAMPLE_CAMPAIGN_ID, notes: NOTES };
}

const JOURNAL_ENTRIES: JournalEntry[] = [
  {
    id: '2026-09-26-session-1',
    session: 1,
    title: 'Session 1: The chapel road',
    date: '2026-09-26',
    encounters: [SAMPLE_ENCOUNTER_ID],
    createdAt: '2026-09-26T17:30:00.000Z',
    updatedAt: null,
    body: `Sister Wren met Thorin and Elara in Oakhollow and asked them to find the pilgrim Tomas, missing on the
road to the ruined chapel.

- Grisk's goblins ambushed the party at the chapel; Grisk fled into the woods.
- Tomas lay dead behind the altar. His prayer book names Brother Aldric.
- Back in Oakhollow, Sister Wren paid 50 gp and asked for a vigil in the chapel.

## Timeline

- 19:42 Goblin ambush at the chapel: Combat started
- 19:58 Goblin ambush at the chapel: Goblin 03 is defeated
- 20:05 Goblin ambush at the chapel: Goblin 01 is defeated
- 20:11 Goblin ambush at the chapel: Combat ended after 4 rounds`,
  },
  {
    id: '2026-10-03-session-2',
    session: 2,
    title: 'Session 2: Vigil at midnight',
    date: '2026-10-03',
    encounters: [SAMPLE_NIGHT_ID],
    createdAt: '2026-10-03T17:30:00.000Z',
    updatedAt: null,
    body: `Mirren, a druid from the woods around Oakhollow, joined the party. They returned to the ruined chapel at
dusk to keep the vigil.

- At half past eleven skeletons rose in the nave. Elara turned one, Mirren called down Moonbeam on a ghoul.
- Something cold waits in the dark corner; the players have not seen it yet.
- The session ended mid-fight. Next time: finish the vigil, then Brother Aldric's midnight rite.`,
  },
];

const QUEST_LIST: Quest[] = [
  {
    id: 'find-tomas',
    name: 'Find the pilgrim Tomas',
    status: 'failed',
    createdAt: '2026-09-26T17:40:00.000Z',
    updatedAt: null,
    notes: "Sister Wren's request. Tomas was dead when the party reached the ruined chapel.",
  },
  {
    id: 'clear-the-chapel-road',
    name: 'Clear the chapel road',
    status: 'done',
    createdAt: '2026-09-26T17:45:00.000Z',
    updatedAt: null,
    notes: "Grisk's goblins no longer hold the road. Grisk escaped into the woods and may return.",
  },
  {
    id: 'keep-the-vigil',
    name: 'Keep the vigil until midnight',
    status: 'open',
    createdAt: '2026-09-26T20:30:00.000Z',
    updatedAt: null,
    notes: 'Sister Wren pays another 50 gp if the chapel is quiet at dawn.',
  },
  {
    id: 'stop-brother-aldric',
    name: 'Stop Brother Aldric',
    status: 'open',
    createdAt: '2026-10-03T20:00:00.000Z',
    updatedAt: null,
    notes: `He plans a rite at midnight on Eleint 21 (see the calendar).

- Reward: the relic of Saint Ilmara, promised by Sister Wren.
- If he escapes, the dead of Oakhollow's graveyard rise next.`,
  },
];

const CAST_LIST: CastEntry[] = [
  {
    id: 'sister-wren',
    name: 'Sister Wren',
    kind: 'person',
    picture: null,
    tags: ['ally', 'quest giver'],
    encounters: [],
    createdAt: '2026-09-26T17:35:00.000Z',
    updatedAt: null,
    notes: `Young acolyte who tends the shrine in Oakhollow. Brave, tired, short of coin.

Appears in the night vigil's notes, so that encounter shows up here without a link.`,
  },
  {
    id: 'brother-aldric',
    name: 'Brother Aldric',
    kind: 'person',
    picture: null,
    tags: ['villain', 'cult'],
    encounters: [],
    createdAt: '2026-09-26T19:00:00.000Z',
    updatedAt: null,
    notes: `Former priest of the chapel, now a cult fanatic. Believes the dead deserve a second dawn.

A combatant of the midnight rite carries his name, so that encounter shows up here without a link.`,
  },
  {
    id: 'grisk',
    name: 'Grisk',
    kind: 'person',
    picture: null,
    tags: ['goblin', 'escaped'],
    encounters: [],
    createdAt: '2026-09-26T18:10:00.000Z',
    updatedAt: null,
    notes: "Goblin boss with a scarred ear. Fled the ambush and holds a grudge against Thorin's shield.",
  },
  {
    id: 'oakhollow',
    name: 'Oakhollow',
    kind: 'place',
    picture: null,
    tags: ['village'],
    encounters: [],
    createdAt: '2026-09-26T17:30:00.000Z',
    updatedAt: null,
    notes: 'Forest village of woodcutters, half a day east of the chapel. Inn: The Split Log.',
  },
  {
    id: 'ruined-chapel',
    name: 'Ruined chapel',
    kind: 'place',
    picture: null,
    tags: ['ruin', 'holy site'],
    encounters: [SAMPLE_ENCOUNTER_ID, SAMPLE_NIGHT_ID, SAMPLE_PREPARED_ID],
    createdAt: '2026-09-26T17:30:00.000Z',
    updatedAt: null,
    notes: `Chapel of Saint Ilmara in a forest clearing. The roof still holds; the nave is unlit except for the
altar torch, and a breach in the east wall lets in the wind.`,
  },
];

/** Harptos calendar on the night of the vigil, between the past ambush and the coming rite. */
function createSampleCalendar(): Calendar {
  // Month 12 of Harptos is Eleint, 13 the festival of Highharvestide.
  const at = (month: number, day: number, hour: number) => ({ year: 1492, month, day, hour, minute: 0 });
  return {
    ...createCalendar('harptos'),
    now: { year: 1492, month: 12, day: 20, hour: 23, minute: 30 },
    events: [
      { id: 'sample-ambush', at: at(12, 18, 16), title: 'Goblin ambush at the chapel', notes: 'Session 1.' },
      { id: 'sample-vigil', at: at(12, 20, 21), title: 'Vigil begins', notes: 'Session 2.' },
      {
        id: 'sample-rite',
        at: at(12, 21, 0),
        title: "Brother Aldric's midnight rite",
        notes: 'The dead rise unless the party stops him.',
      },
      { id: 'sample-highharvestide', at: at(13, 1, 10), title: 'Highharvestide in Oakhollow', notes: '' },
    ],
  };
}

/**
 * Creates the whole sample campaign when it does not exist yet; afterwards only the goblin ambush, which
 * "Open the sample encounter" opens. What the DM deleted or changed stays that way. The app ships no monsters,
 * so the missing ones come from the D&D 5e API first.
 */
export async function ensureSampleCampaign(repository: Repository): Promise<void> {
  if ((await repository.sourceOf('map', SAMPLE_MAP.id)) === null) {
    throw new Error('The sample campaign uses the map of the pack "Sample map"; enable it under Settings > Content.');
  }
  const { storage } = repository;
  const fresh = !(await storage.exists('data', campaignPath(SAMPLE_CAMPAIGN_ID)));
  const ambushMissing = !(await storage.exists('data', encounterPath(SAMPLE_CAMPAIGN_ID, SAMPLE_ENCOUNTER_ID)));
  const encounters = fresh ? Object.keys(SAMPLE_ENCOUNTERS) : ambushMissing ? [SAMPLE_ENCOUNTER_ID] : [];
  if (encounters.length > 0) {
    try {
      await importApiMonsters(repository, SAMPLE_MONSTER_INDEXES);
    } catch (error) {
      throw new Error(
        'The sample campaign needs its monsters from the D&D 5e API (dnd5eapi.co); check the internet connection.',
        { cause: error },
      );
    }
    const library = await loadSampleLibrary(repository);
    await Promise.all(encounters.map((id) => repository.saveEncounter(SAMPLE_ENCOUNTERS[id]!(library))));
  }
  if (fresh) {
    const files = new CampaignFiles(storage, SAMPLE_CAMPAIGN_ID);
    await Promise.all([
      ...JOURNAL_ENTRIES.map((entry) => files.save(JOURNAL, entry)),
      ...QUEST_LIST.map((quest) => files.save(QUESTS, quest)),
      ...CAST_LIST.map((entry) => files.save(CAST, entry)),
      files.saveCalendar(createSampleCalendar()),
    ]);
    // Written last: after a failed first run the next one starts over.
    await repository.saveCampaign(createSampleCampaign());
  }
}
