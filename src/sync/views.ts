import { create } from 'zustand';
import { PARTY_VIEW, type Encounter, type PlayerLinks } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';

/** What a player screen can show: the party or one player character. */
export interface PlayerView {
  /** `PARTY_VIEW` or the player character's combatant id: a party member's id in every encounter. */
  id: string;
  name: string;
}

const PARTY: PlayerView = { id: PARTY_VIEW, name: 'Party' };
const SECRET_BYTES = 32;
// 128 bits: as hard to guess as the old random player token.
const TOKEN_HEX_CHARS = 32;

/** Party first, then the encounter's player characters in turn order. */
export function playerViews(encounter: Encounter): PlayerView[] {
  const pcs = encounter.combatants
    .filter((c) => c.side === 'player')
    .map(({ id, partyMemberId, name }) => ({ id: partyMemberId ?? id, name }));
  return [PARTY, ...pcs];
}

/**
 * Link token of a view: HMAC-SHA256 of the view and its rotation count under the DM's secret. Without the secret
 * no token of another view follows from a known one, and a rotation makes the view's previous token worthless.
 */
export async function linkToken(secret: string, view: string, rotation: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${view}:${rotation}`)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, TOKEN_HEX_CHARS);
}

interface ViewLinksState {
  /**
   * Party and the player characters of the open encounter; kept while no encounter is open, so leaving the Play
   * page does not withdraw the characters' links.
   */
  views: PlayerView[];
  /** Link token by view id; empty until derived. */
  tokens: Record<string, string>;
}

export const useViewLinksStore = create<ViewLinksState>(() => ({ views: [PARTY], tokens: {} }));

/** Token → view, the form the LAN server and the relay check links against. */
export function linkTable({ views, tokens }: ViewLinksState): Record<string, string> {
  return Object.fromEntries(views.filter((v) => tokens[v.id] !== undefined).map((v) => [tokens[v.id]!, v.id]));
}

/** Replaces the link of `view`: its old token stops working on the LAN server and the relay. */
export async function rotateLink(view: string): Promise<void> {
  const { settings, setSettings } = useAppStore.getState();
  if (!settings) {
    throw new Error('Settings are not loaded yet');
  }
  const { rotations } = settings.playerLinks;
  const playerLinks: PlayerLinks = {
    ...settings.playerLinks,
    rotations: { ...rotations, [view]: (rotations[view] ?? 0) + 1 },
  };
  await setSettings({ ...settings, playerLinks });
}

/**
 * Keeps `useViewLinksStore` in step with the open encounter and `settings.playerLinks`, and creates the link
 * secret on first use.
 */
export function startViewLinks(): () => void {
  let derived = '';
  let generation = 0;

  const update = () => {
    const { settings, setSettings, reportError } = useAppStore.getState();
    const { encounter } = useEncounterStore.getState();
    const current = useViewLinksStore.getState().views;
    const views = encounter ? playerViews(encounter) : current;
    if (JSON.stringify(views) !== JSON.stringify(current)) {
      useViewLinksStore.setState({ views });
    }
    const secret = settings?.playerLinks.secret ?? '';
    const key = JSON.stringify([secret, settings?.playerLinks.rotations, views.map((v) => v.id)]);
    if (settings && secret === '') {
      const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
      const created = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      setSettings({ ...settings, playerLinks: { ...settings.playerLinks, secret: created } }).catch(reportError);
    } else if (settings && key !== derived) {
      derived = key;
      generation += 1;
      const mine = generation;
      const { rotations } = settings.playerLinks;
      Promise.all(views.map(async (v) => [v.id, await linkToken(secret, v.id, rotations[v.id] ?? 0)] as const))
        .then((entries) => {
          // A newer derivation started meanwhile and owns the store.
          if (mine === generation) {
            useViewLinksStore.setState({ tokens: Object.fromEntries(entries) });
          }
        })
        .catch(reportError);
    }
  };

  const unsubscribers = [useAppStore.subscribe(update), useEncounterStore.subscribe(update)];
  update();
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
