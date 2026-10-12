import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { createCampaign, nowIso, type Campaign, type Encounter } from '@/core/model';
import type { LoadProblem } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CalendarTab } from '../campaign/CalendarTab';
import { NameDialog, Problems, type CampaignTabProps } from '../campaign/campaignUi';
import { CastTab } from '../campaign/CastTab';
import { JournalTab } from '../campaign/JournalTab';
import { QuestsTab } from '../campaign/QuestsTab';
import { AssetImage } from '../components/AssetImage';
import { Button, confirmDialog, EmptyState, PageHeader, Section, Tabs, type TabSpec } from '../kit';
import { openNewEncounter } from './compendiumUi';
import { encounterStatus, statusLabel } from './encounterStatus';

const CAMPAIGNS = { page: 'campaigns', campaignId: null } as const;
const NOTES_SAVE_MS = 800;

type CampaignTab = 'encounters' | 'journal' | 'cast' | 'quests' | 'calendar';

const CAMPAIGN_TABS: TabSpec<CampaignTab>[] = [
  { id: 'encounters', label: 'Encounters', icon: 'swords' },
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'cast', label: 'People & places', icon: 'users' },
  { id: 'quests', label: 'Quests', icon: 'flag' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
];

const TAB_BODIES: Record<Exclude<CampaignTab, 'encounters'>, ComponentType<CampaignTabProps>> = {
  journal: JournalTab,
  cast: CastTab,
  quests: QuestsTab,
  calendar: CalendarTab,
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface CampaignSummary {
  campaign: Campaign;
  encounters: number;
  lastPlayed: string | null;
}

/** All campaigns as cards with encounter count and last activity. */
export function CampaignList() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const [summaries, setSummaries] = useState<CampaignSummary[] | null>(null);
  const [problems, setProblems] = useState<LoadProblem[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const load = async () => {
      const listing = await repository.listCampaigns();
      const lists = await Promise.all(listing.campaigns.map((c) => repository.listEncounters(c.id)));
      setProblems([...listing.problems, ...lists.flatMap((l) => l.problems)]);
      setSummaries(
        listing.campaigns.map((campaign, i) => ({
          campaign,
          encounters: lists[i]!.encounters.length,
          lastPlayed: lists[i]!.encounters[0]?.updatedAt ?? null,
        })),
      );
    };
    load().catch(reportError);
  }, [repository, reportError]);

  const create = async (name: string) => {
    const id = await repository.newCampaignId(name);
    const campaign = await repository.saveCampaign({ ...createCampaign(name), id });
    navigate({ page: 'campaigns', campaignId: campaign.id });
  };

  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Campaigns' }]}>
        <Button icon="plus" label="New campaign" variant="primary" onClick={() => setCreating(true)} />
      </PageHeader>
      <div className="page-body">
        <Problems problems={problems} />
        <div className="card-grid">
          {summaries?.map(({ campaign, encounters, lastPlayed }) => (
            <button
              key={campaign.id}
              type="button"
              className="card campaign-card"
              onClick={() => navigate({ page: 'campaigns', campaignId: campaign.id })}
            >
              <span className="body">
                <strong>{campaign.name}</strong>
                <span className="muted">
                  {encounters} {encounters === 1 ? 'encounter' : 'encounters'}
                </span>
                <span className="muted">
                  {lastPlayed ? `Last activity ${formatWhen(lastPlayed)}` : 'Not played yet'}
                </span>
              </span>
            </button>
          ))}
        </div>
        {summaries?.length === 0 && (
          <EmptyState
            icon="swords"
            title="No campaigns yet."
            action={<Button icon="plus" label="New campaign" variant="primary" onClick={() => setCreating(true)} />}
          >
            A campaign groups the encounters you prepare and play.
          </EmptyState>
        )}
      </div>
      {creating && (
        <NameDialog
          title="New campaign"
          initial=""
          confirmLabel="Create"
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function EncounterRow({ encounter, onChanged }: { encounter: Encounter; onChanged: () => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const map = useLibraryStore((s) => s.listings.map.entries.find((m) => m.ref.id === encounter.map?.id));
  const status = encounterStatus(encounter);
  const locator = { campaignId: encounter.campaignId, encounterId: encounter.id };

  const duplicate = async () => {
    const at = nowIso();
    const name = `${encounter.name} copy`;
    const id = await repository.newEncounterId(encounter.campaignId, name);
    const copy = { ...encounter, id, name, createdAt: at, updatedAt: at };
    await repository.saveEncounter(copy);
    useAppStore.getState().notify(`Created "${copy.name}"`);
    onChanged();
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete encounter',
      message: `"${encounter.name}" with its combatants, log and fog will be deleted.`,
      confirmLabel: 'Delete encounter',
      danger: true,
    });
    if (ok) {
      await repository.removeEncounter(encounter.campaignId, encounter.id);
      await useAppStore.getState().forgetEncounter(locator);
      onChanged();
    }
  };

  const mapName = encounter.map ? (map?.doc.name ?? 'Missing map') : 'No map';
  return (
    <div
      className="encounter-row"
      onDoubleClick={() => useAppStore.getState().openEncounter(locator).catch(reportError)}
    >
      <AssetImage asset={map?.doc.image?.asset ?? null} alt="" className="encounter-thumb" />
      <div className="encounter-info">
        <strong>{encounter.name}</strong>
        <span className="muted">
          {mapName} · {encounter.combatants.length} combatants ·{' '}
          {status.kind === 'not-started' ? 'Created' : 'Last played'} {formatWhen(encounter.updatedAt)}
        </span>
      </div>
      <span className={`status-chip ${status.kind}`}>{statusLabel(status)}</span>
      <Button
        icon="play"
        label="Play"
        variant="primary"
        onClick={() => useAppStore.getState().openEncounter(locator).catch(reportError)}
      />
      <Button icon="copy" label="Duplicate" iconOnly onClick={() => duplicate().catch(reportError)} />
      <Button icon="trash" label="Delete" iconOnly variant="danger" onClick={() => remove().catch(reportError)} />
    </div>
  );
}

function CampaignNotes({ campaign, onSaved }: { campaign: Campaign; onSaved: (c: Campaign) => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [notes, setNotes] = useState(campaign.notes);
  const pending = notes !== campaign.notes;

  const flush = useCallback(() => {
    if (notes !== campaign.notes) {
      repository.saveCampaign({ ...campaign, notes }).then(onSaved, reportError);
    }
  }, [repository, campaign, notes, onSaved, reportError]);

  useEffect(() => {
    const timer = window.setTimeout(flush, NOTES_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [flush]);

  return (
    <Section title="Notes" actions={<span className="muted">{pending ? 'Saving...' : 'Saved'}</span>}>
      <textarea
        className="campaign-notes"
        rows={6}
        aria-label="Campaign notes"
        placeholder="Plot threads, NPCs, what happened last session"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={flush}
      />
    </Section>
  );
}

/** One campaign: encounters with status and Play, notes, journal, people and places, quests, calendar. */
function TabBody({ tab, ...props }: CampaignTabProps & { tab: Exclude<CampaignTab, 'encounters'> }) {
  const Body = TAB_BODIES[tab];
  return <Body {...props} />;
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const [campaign, setCampaign] = useState<Campaign | null | undefined>(undefined);
  const [listing, setListing] = useState<{ encounters: Encounter[]; problems: LoadProblem[] } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [tab, setTab] = useState<CampaignTab>('encounters');

  useEffect(() => {
    repository
      .listCampaigns()
      .then((l) => setCampaign(l.campaigns.find((c) => c.id === campaignId) ?? null), reportError);
  }, [repository, campaignId, reportError]);

  const loadEncounters = useCallback(
    () => repository.listEncounters(campaignId).then(setListing, reportError),
    [repository, campaignId, reportError],
  );
  useEffect(() => {
    loadEncounters();
  }, [loadEncounters]);

  const rename = async (name: string) => {
    if (campaign) setCampaign(await repository.saveCampaign({ ...campaign, name }));
  };

  const remove = async (target: Campaign) => {
    const ok = await confirmDialog({
      title: 'Delete campaign',
      message: `"${target.name}" and all its encounters will be deleted.`,
      confirmLabel: 'Delete campaign',
      danger: true,
    });
    if (ok) {
      await repository.storage.remove(`campaigns/${target.id}`);
      await useAppStore.getState().forgetEncounter({ campaignId: target.id });
      navigate(CAMPAIGNS);
    }
  };

  const encounters = listing?.encounters ?? [];
  return campaign === null ? (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Campaigns', route: CAMPAIGNS }, { label: 'Missing campaign' }]} />
      <EmptyState
        icon="alert"
        title="This campaign no longer exists."
        action={<Button label="All campaigns" onClick={() => navigate(CAMPAIGNS)} />}
      />
    </div>
  ) : (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Campaigns', route: CAMPAIGNS }, { label: campaign?.name ?? '...' }]}>
        <Button icon="edit" label="Rename" disabled={!campaign} onClick={() => setRenaming(true)} />
        <Button
          icon="trash"
          label="Delete"
          variant="danger"
          disabled={!campaign}
          onClick={() => campaign && remove(campaign).catch(reportError)}
        />
      </PageHeader>
      <div className="campaign-tabbar">
        <Tabs tabs={CAMPAIGN_TABS} value={tab} onChange={setTab} label="Campaign" />
      </div>
      <div className="page-body campaign-page">
        {tab === 'encounters' ? (
          <>
            <Section
              title={`Encounters (${encounters.length})`}
              actions={
                <Button
                  icon="plus"
                  label="New encounter"
                  variant="primary"
                  onClick={() => openNewEncounter(campaignId)}
                />
              }
            >
              <Problems problems={listing?.problems ?? []} />
              <div className="col">
                {encounters.map((e) => (
                  <EncounterRow key={e.id} encounter={e} onChanged={loadEncounters} />
                ))}
              </div>
              {listing?.encounters.length === 0 && (
                <EmptyState
                  icon="swords"
                  title="No encounters in this campaign yet."
                  action={
                    <Button
                      icon="plus"
                      label="New encounter"
                      variant="primary"
                      onClick={() => openNewEncounter(campaignId)}
                    />
                  }
                >
                  Pick a name and a map, then play it right away.
                </EmptyState>
              )}
            </Section>
            {campaign && <CampaignNotes key={campaign.id} campaign={campaign} onSaved={setCampaign} />}
          </>
        ) : (
          <TabBody tab={tab} campaignId={campaignId} encounters={encounters} />
        )}
      </div>
      {renaming && campaign && (
        <NameDialog
          title="Rename campaign"
          initial={campaign.name}
          confirmLabel="Rename"
          onSubmit={rename}
          onClose={() => setRenaming(false)}
        />
      )}
    </div>
  );
}
