import { create } from 'zustand';
import { PARTY_VIEW, type Encounter, type PartyMember, type PlayerLinks } from '@/core/model';
import { useAppStore, type Route } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';

/** What a player screen can show: the party or one player character. */
export interface PlayerView {
  /** `PARTY_VIEW` or the player character's combatant id: a party member's id in every encounter. */
  id: string;
  name: string;
}

const PARTY: PlayerView = { id: PARTY_VIEW, name: 'Party' };
const SECRET_BYTES = 32;
// 128 bits: not guessable.
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
  /**
   * `views` plus the characters of the campaign's earlier encounters this session: a character sitting out an
   * encounter keeps a working link, so the player's open page picks up again when the character returns.
   */
  linked: PlayerView[];
  /** Link token by view id of `linked`; empty until derived. */
  tokens: Record<string, string>;
}

export const useViewLinksStore = create<ViewLinksState>(() => ({ views: [PARTY], linked: [PARTY], tokens: {} }));

/** Token → view, the form the LAN server and the relay check links against. */
export function linkTable({ linked, tokens }: Pick<ViewLinksState, 'linked' | 'tokens'>): Record<string, string> {
  return Object.fromEntries(linked.filter((v) => tokens[v.id] !== undefined).map((v) => [tokens[v.id]!, v.id]));
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
 * Keeps `useViewLinksStore` in step with the open encounter, its campaign's party and `settings.playerLinks`, and
 * creates the link secret on first use.
 */
export function startViewLinks(): () => void {
  let derived = '';
  let generation = 0;
  let campaign: string | null = null;
  let party: { campaignId: string | null; members: PartyMember[] } = { campaignId: null, members: [] };
  let partyAsked: { key: string; route: Route | null } = { key: '', route: null };
  let partyLoads = 0;

  // The party is edited on the campaign page, which saves straight to the
  // repository: opening an encounter or changing pages reads it again.
  const loadParty = (campaignId: string) => {
    partyLoads += 1;
    const mine = partyLoads;
    const { repository, reportError } = useAppStore.getState();
    repository
      .listCampaigns()
      .then(({ campaigns }) => {
        if (mine === partyLoads) {
          party = { campaignId, members: campaigns.find((c) => c.id === campaignId)?.party ?? [] };
          update();
        }
      })
      .catch(reportError);
  };

  const update = () => {
    const { settings, setSettings, reportError, route } = useAppStore.getState();
    const { encounter } = useEncounterStore.getState();
    const current = useViewLinksStore.getState();
    const views = encounter ? playerViews(encounter) : current.views;
    // Another campaign's players must not keep a way in.
    const sameCampaign = !encounter || encounter.campaignId === campaign;
    campaign = encounter?.campaignId ?? campaign;
    const askKey = `${campaign}|${encounter?.id ?? ''}`;
    if (campaign !== null && (askKey !== partyAsked.key || route !== partyAsked.route)) {
      partyAsked = { key: askKey, route };
      loadParty(campaign);
    }
    const creatures = useLibraryStore.getState().listings.creature.entries;
    const members = party.campaignId === campaign ? party.members : [];
    const partyViews = members.map((m) => ({
      id: m.id,
      name: creatures.find((e) => e.ref.id === m.creature.id)?.doc.name ?? (m.player || 'Party member'),
    }));
    const earlier = sameCampaign ? current.linked : [];
    const linked = [...views, ...partyViews, ...earlier].filter(
      (view, i, all) => all.findIndex((v) => v.id === view.id) === i,
    );
    if (JSON.stringify(views) !== JSON.stringify(current.views)) {
      useViewLinksStore.setState({ views });
    }
    if (JSON.stringify(linked) !== JSON.stringify(current.linked)) {
      useViewLinksStore.setState({ linked });
    }
    const secret = settings?.playerLinks.secret ?? '';
    const key = JSON.stringify([secret, settings?.playerLinks.rotations, linked.map((v) => v.id)]);
    if (settings && secret === '') {
      const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
      const created = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      setSettings({ ...settings, playerLinks: { ...settings.playerLinks, secret: created } }).catch(reportError);
    } else if (settings && key !== derived) {
      derived = key;
      generation += 1;
      const mine = generation;
      const { rotations } = settings.playerLinks;
      Promise.all(linked.map(async (v) => [v.id, await linkToken(secret, v.id, rotations[v.id] ?? 0)] as const))
        .then((entries) => {
          // A newer derivation started meanwhile and owns the store.
          if (mine === generation) {
            useViewLinksStore.setState({ tokens: Object.fromEntries(entries) });
          }
        })
        .catch(reportError);
    }
  };

  const unsubscribers = [
    useAppStore.subscribe(update),
    useEncounterStore.subscribe(update),
    useLibraryStore.subscribe((state, previous) => {
      if (state.listings.creature !== previous.listings.creature) update();
    }),
  ];
  update();
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
