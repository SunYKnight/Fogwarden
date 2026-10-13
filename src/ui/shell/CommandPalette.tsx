import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Settings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useLanStore } from '@/state/lanStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Dialog, useShortcuts } from '../kit';
import { usePlayerWindowStore } from '../playerWindow';
import { rankCommands } from './commandMatch';
import {
  ACTION_COMMANDS,
  libraryCommands,
  openCommandPalette,
  useCommandPaletteStore,
  type CampaignEncounters,
  type Command,
  type CommandContext,
} from './commandRegistry';

// Thousands of creatures match a single letter; nobody scrolls past this.
const MAX_RESULTS = 50;
const ARROW_STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

function closePalette(): void {
  useCommandPaletteStore.setState({ open: false });
}

function PaletteDialog({ settings }: { settings: Settings }) {
  const route = useAppStore((s) => s.route);
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const encounter = useEncounterStore((s) => s.encounter);
  const playerWindowOpen = usePlayerWindowStore((s) => s.open);
  const lanRunning = useLanStore((s) => s.info !== null);
  const creatures = useLibraryStore((s) => s.listings.creature.entries);
  const maps = useLibraryStore((s) => s.listings.map.entries);
  const [campaigns, setCampaigns] = useState<CampaignEncounters[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  // Encounters are not kept in a store; read them fresh each time the palette opens.
  useEffect(() => {
    const load = async () => {
      const { campaigns: list } = await repository.listCampaigns();
      const lists = await Promise.all(list.map((c) => repository.listEncounters(c.id)));
      setCampaigns(list.map((campaign, i) => ({ campaign, encounters: lists[i]!.encounters })));
    };
    load().catch(reportError);
  }, [repository, reportError]);

  const context: CommandContext = useMemo(
    () => ({ route, settings, encounter, playerWindowOpen, lanRunning }),
    [route, settings, encounter, playerWindowOpen, lanRunning],
  );
  const library = useMemo(() => libraryCommands(creatures, maps, campaigns), [creatures, maps, campaigns]);
  const results = useMemo(() => {
    const pool = query.trim() === '' ? ACTION_COMMANDS : [...ACTION_COMMANDS, ...library];
    return rankCommands(
      pool.filter((c) => c.available?.(context) ?? true),
      query,
    ).slice(0, MAX_RESULTS);
  }, [query, library, context]);
  const current = Math.min(active, results.length - 1);

  const run = (command: Command) => {
    closePalette();
    Promise.resolve(context).then(command.run).catch(reportError);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = ARROW_STEP[event.key];
    const chosen = results[current];
    if (step !== undefined && results.length > 0) {
      event.preventDefault();
      setActive((current + step + results.length) % results.length);
    } else if (event.key === 'Enter' && chosen) {
      event.preventDefault();
      run(chosen);
    }
  };

  return (
    <Dialog title="Search commands" onClose={closePalette} width={560}>
      <input
        type="text"
        className="palette-input"
        value={query}
        placeholder="Command, creature, map, campaign or encounter"
        role="combobox"
        aria-label="Search commands"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} className="palette-list" role="listbox" aria-label="Commands">
        {results.map((command, i) => (
          <li
            key={command.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === current}
            className={i === current ? 'palette-item active' : 'palette-item'}
            ref={i === current ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            onMouseMove={() => setActive(i)}
            onClick={() => run(command)}
          >
            <span className="palette-label">{command.label}</span>
            <span className="muted small">{command.group}</span>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="muted">Nothing matches &ldquo;{query}&rdquo;.</p>}
    </Dialog>
  );
}

/** Ctrl+K search over commands and library entries; mounted once by the app shell after loading. */
export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const settings = useAppStore((s) => s.settings);
  useShortcuts('App', [{ keys: 'Ctrl+K', label: 'Search commands and library', run: openCommandPalette }]);
  return open && settings ? <PaletteDialog settings={settings} /> : null;
}
