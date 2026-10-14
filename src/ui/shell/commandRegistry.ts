import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { PHASE_MINUTE } from '@/core/atmosphere/timeOfDay';
import { WEATHERS, type Campaign, type Encounter, type Settings } from '@/core/model';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore, type Route, type SettingsSection } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useLanStore } from '@/state/lanStore';
import { exportCampaignToZip, pickCampaignZip } from '../campaign/campaignArchiveUi';
import { rollInitiativeFor, stepTurn } from '../encounter/combatantCommands';
import { chooseTool, useEncounterUi } from '../encounter/encounterUiStore';
import { openNewCampaign } from '../library/CampaignLibrary';
import { openNewEncounter } from '../library/compendiumUi';
import { openNewMapWizard } from '../library/NewMapWizard';
import { closePlayerWindow, openPlayerWindow } from '../playerWindow';
import { SETTINGS_SECTIONS } from '../settings/sections';
import { WEATHER_LABEL } from '../sound/SceneMenu';
import type { Searchable } from './commandMatch';
import { NAV_ITEMS } from './nav';

/** What commands look at to decide whether they apply, read while the palette is open. */
export interface CommandContext {
  route: Route;
  settings: Settings;
  encounter: Encounter | null;
  playerWindowOpen: boolean;
  lanRunning: boolean;
}

export interface Command extends Searchable {
  id: string;
  run: (context: CommandContext) => void | Promise<void>;
  /** Hidden while false, e.g. "Next turn" before combat started. */
  available?: (context: CommandContext) => boolean;
}

export interface CampaignEncounters {
  campaign: Campaign;
  encounters: Encounter[];
}

export const useCommandPaletteStore = create<{ open: boolean }>(() => ({ open: false }));

export function openCommandPalette(): void {
  useCommandPaletteStore.setState({ open: true });
}

const SETTINGS_KEYWORDS: Record<SettingsSection, string[]> = {
  data: ['folder', 'backup', 'history', 'version', 'restore', 'storage'],
  players: ['player view', 'monitor', 'window', 'lan', 'port', 'qr code'],
  graphics: ['quality', 'shadows', 'performance'],
  audio: ['sound', 'music', 'volume'],
  rules: ['diagonals', 'standees'],
  content: ['packs', 'import', 'export'],
  about: ['version', 'updates', 'licenses'],
};

const inEncounter = (c: CommandContext) => c.encounter !== null;
const inCombat = (c: CommandContext) => (c.encounter?.round ?? 0) > 0;

/** App-wide commands in the DM's order of work; the palette lists them before anything is typed. */
export const ACTION_COMMANDS: Command[] = [
  ...NAV_ITEMS.map((item) => ({
    id: `go:${item.id}`,
    label: item.label,
    group: 'Go to',
    keywords: [],
    run: () => useAppStore.getState().navigate(item.route),
  })),
  ...SETTINGS_SECTIONS.map((section) => ({
    id: `settings:${section.id}`,
    label: `Settings › ${section.label}`,
    group: 'Go to',
    keywords: SETTINGS_KEYWORDS[section.id],
    run: () => useAppStore.getState().navigate({ page: 'settings', section: section.id }),
  })),
  { id: 'create:campaign', label: 'New campaign', group: 'Create', keywords: [], run: openNewCampaign },
  {
    id: 'campaign:import',
    label: 'Import campaign…',
    group: 'Create',
    keywords: ['zip', 'archive', 'share', 'transfer'],
    run: pickCampaignZip,
  },
  {
    id: 'campaign:export',
    label: 'Export campaign…',
    group: 'Campaign',
    keywords: ['zip', 'archive', 'share', 'transfer', 'backup'],
    available: (c) => c.route.page === 'campaigns' && c.route.campaignId !== null,
    run: async ({ route }) => {
      if (route.page === 'campaigns' && route.campaignId) {
        await exportCampaignToZip(route.campaignId);
      }
    },
  },
  {
    id: 'create:map',
    label: 'New map',
    group: 'Create',
    keywords: ['image', 'battlemap', 'import'],
    run: () => openNewMapWizard(),
  },
  {
    id: 'create:encounter',
    label: 'New encounter',
    group: 'Create',
    keywords: ['fight', 'combat'],
    run: (c) => openNewEncounter(c.route.page === 'campaigns' ? c.route.campaignId : null),
  },
  {
    id: 'create:creature',
    label: 'New creature',
    group: 'Create',
    keywords: ['monster', 'npc', 'stat block'],
    run: () => useAppStore.getState().navigate({ page: 'creature-editor', ref: null }),
  },
  {
    id: 'players:open-window',
    label: 'Open player window',
    group: 'Players',
    keywords: ['player view', 'monitor', 'show'],
    available: (c) => !c.playerWindowOpen,
    run: (c) => openPlayerWindow(c.settings),
  },
  {
    id: 'players:close-window',
    label: 'Close player window',
    group: 'Players',
    keywords: ['player view', 'monitor'],
    available: (c) => c.playerWindowOpen,
    run: closePlayerWindow,
  },
  {
    id: 'players:start-lan',
    label: 'Start LAN',
    group: 'Players',
    keywords: ['network', 'server', 'phones', 'tablets', 'wifi'],
    available: (c) => isTauri() && !c.lanRunning,
    run: (c) => useLanStore.getState().start(c.settings.lan.port),
  },
  {
    id: 'players:stop-lan',
    label: 'Stop LAN',
    group: 'Players',
    keywords: ['network', 'server', 'wifi'],
    available: (c) => c.lanRunning,
    run: () => useLanStore.getState().stop(),
  },
  {
    id: 'play:start-combat',
    label: 'Start combat',
    group: 'Play',
    keywords: ['fight', 'turn'],
    available: (c) => !inCombat(c) && (c.encounter?.combatants.length ?? 0) > 0,
    run: () => stepTurn('next'),
  },
  {
    id: 'play:next-turn',
    label: 'Next turn',
    group: 'Play',
    keywords: ['space', 'advance'],
    available: inCombat,
    run: () => stepTurn('next'),
  },
  {
    id: 'play:roll-initiative',
    label: 'Roll initiative',
    group: 'Play',
    keywords: ['everyone', 'dice'],
    available: (c) => (c.encounter?.combatants.length ?? 0) > 0,
    run: () => rollInitiativeFor(null),
  },
  {
    id: 'play:end-combat',
    label: 'End combat',
    group: 'Play',
    keywords: ['xp', 'loot', 'finish'],
    available: inCombat,
    run: () => {
      useAppStore.getState().navigate({ page: 'play' });
      useEncounterUi.setState({ endCombatOpen: true });
    },
  },
  {
    id: 'play:fog',
    label: 'Fog of war',
    group: 'Play',
    keywords: ['brush', 'reveal', 'hide'],
    available: inEncounter,
    run: () => {
      useAppStore.getState().navigate({ page: 'play' });
      useEncounterUi.setState({ fogMenuOpen: true });
    },
  },
  {
    id: 'play:measure',
    label: 'Measure',
    group: 'Play',
    keywords: ['ruler', 'distance'],
    available: inEncounter,
    run: () => {
      useAppStore.getState().navigate({ page: 'play' });
      chooseTool('measure');
    },
  },
  {
    id: 'play:table',
    label: 'Table: scene, sound and show',
    group: 'Play',
    keywords: ['music', 'mood', 'weather', 'time of day', 'handout', 'picture'],
    available: inEncounter,
    run: () => {
      useAppStore.getState().navigate({ page: 'play' });
      useEncounterUi.setState({ inspectorTab: 'table' });
    },
  },
  ...WEATHERS.map((weather) => ({
    id: `play:weather-${weather}`,
    label: `Weather: ${WEATHER_LABEL[weather]}`,
    group: 'Play',
    keywords: ['scene'],
    available: (c: CommandContext) => c.encounter !== null && c.encounter.atmosphere.weather !== weather,
    run: () => useEncounterStore.getState().update((d) => void (d.atmosphere.weather = weather), 'Weather'),
  })),
  {
    id: 'play:time-on',
    label: 'Turn on time of day',
    group: 'Play',
    keywords: ['scene', 'night', 'light', 'dark'],
    available: (c) => c.encounter?.atmosphere.minute === null,
    run: () => useEncounterStore.getState().update((d) => void (d.atmosphere.minute = PHASE_MINUTE.day), 'Time of day'),
  },
  {
    id: 'play:time-off',
    label: 'Turn off time of day',
    group: 'Play',
    keywords: ['scene', 'night', 'light', 'dark'],
    available: (c) => c.encounter !== null && c.encounter.atmosphere.minute !== null,
    run: () => useEncounterStore.getState().update((d) => void (d.atmosphere.minute = null), 'Time of day'),
  },
];

/** One command per creature, map, campaign and encounter; the palette offers them once something is typed. */
export function libraryCommands(
  creatures: readonly LibraryEntry<'creature'>[],
  maps: readonly LibraryEntry<'map'>[],
  campaigns: readonly CampaignEncounters[],
): Command[] {
  const { navigate, openEncounter } = useAppStore.getState();
  return [
    ...creatures.map(({ ref, doc }) => ({
      id: `creature:${ref.area}:${ref.id}`,
      label: doc.name,
      group: 'Creature',
      keywords: [doc.type, 'stat block'],
      run: () => navigate({ page: 'creature-editor', ref }),
    })),
    ...maps.map(({ ref, doc }) => ({
      id: `map:${ref.area}:${ref.id}`,
      label: doc.name,
      group: 'Map',
      keywords: ['editor'],
      run: () => navigate({ page: 'map-editor', map: ref }),
    })),
    ...campaigns.map(({ campaign }) => ({
      id: `campaign:${campaign.id}`,
      label: campaign.name,
      group: 'Campaign',
      keywords: [],
      run: () => navigate({ page: 'campaigns', campaignId: campaign.id }),
    })),
    ...campaigns.flatMap(({ campaign, encounters }) =>
      encounters.map((encounter) => ({
        id: `encounter:${campaign.id}:${encounter.id}`,
        label: encounter.name,
        group: 'Encounter',
        keywords: [campaign.name, 'play'],
        run: () => openEncounter({ campaignId: campaign.id, encounterId: encounter.id }),
      })),
    ),
  ];
}
