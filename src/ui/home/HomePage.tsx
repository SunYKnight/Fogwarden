import { useEffect, useRef, useState } from 'react';
import type { AssetRef, Campaign, DocRef, Encounter, EncounterLocator } from '@/core/model';
import { QUESTS } from '@/data/campaignFiles';
import { useAppStore } from '@/state/appStore';
import { currentCombatant } from '@/state/encounterActions';
import { appendToJournal } from '@/state/journalRecorder';
import { useLibraryStore } from '@/state/libraryStore';
import { importCampaignZip } from '../campaign/campaignArchiveUi';
import { Problems, useCampaignDocs } from '../campaign/campaignUi';
import { AssetImage } from '../components/AssetImage';
import { Button, EmptyState, Icon, PageHeader } from '../kit';
import { openNewCampaign } from '../library/CampaignLibrary';
import { openCreatureImport, openNewEncounter } from '../library/compendiumUi';
import { encounterStatus, statusLabel } from '../library/encounterStatus';
import { isDamFile, isMapSourceFile, useFileDrop } from '../library/fileDrop';
import { openNewMapWizard } from '../library/NewMapWizard';
import { FirstSteps } from './FirstSteps';
import { homeCampaignId, recentMaps, type MapEntry } from './recent';

const RECENT_LIMIT = 6;
const DROP_TYPES = 'image/png,image/jpeg,image/webp,.dd2vtt,.df2vtt,.uvtt,.dam,.txt,.glb,.zip';
const IMPORT_HINT =
  'A battlemap image or a .dd2vtt export becomes a new map; a .txt stat block opens the creature import; ' +
  'an exported campaign (.zip) becomes a campaign. Files can also be dropped anywhere on this page.';

/** Battlemap image of a library map, for encounter thumbnails; a user copy shadows the shipped map. */
function useMapImage(ref: DocRef | null): AssetRef | null {
  const entries = useLibraryStore((s) => s.listings.map.entries);
  const entry = ref && entries.find((e) => e.ref.id === ref.id);
  return entry?.doc.image?.asset ?? null;
}

interface Loaded {
  campaigns: Campaign[];
  encounters: Encounter[];
}

/** Every campaign and encounter; Home picks the campaign and its next steps from them. */
function useCampaigns(): Loaded | null {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { campaigns } = await repository.listCampaigns();
      const lists = await Promise.all(campaigns.map((c) => repository.listEncounters(c.id)));
      if (!cancelled) setLoaded({ campaigns, encounters: lists.flatMap((list) => list.encounters) });
    };
    load().catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [repository, reportError]);
  return loaded;
}

function ContinueCard({ campaign, encounter }: { campaign: Campaign; encounter: Encounter }) {
  const openEncounter = useAppStore((s) => s.openEncounter);
  const reportError = useAppStore((s) => s.reportError);
  const image = useMapImage(encounter.map);
  const turn = currentCombatant(encounter);
  const locator: EncounterLocator = { campaignId: campaign.id, encounterId: encounter.id };
  return (
    <section className="home-card continue-card" aria-label="Continue">
      <AssetImage asset={image} alt="" className="continue-thumb" />
      <div className="col">
        <span className="muted">Continue · {campaign.name}</span>
        <h2>{encounter.name}</h2>
        <span>
          {encounter.round > 0 ? `Round ${encounter.round}` : 'Not started'}
          {turn && ` · ${turn.name}'s turn`} · {encounter.combatants.length} combatants
        </span>
        <div className="row">
          <Button
            icon="play"
            label="Resume"
            variant="primary"
            onClick={() => openEncounter(locator).catch(reportError)}
          />
        </div>
      </div>
    </section>
  );
}

function UpcomingEncounter({ encounter, primary }: { encounter: Encounter; primary: boolean }) {
  const openEncounter = useAppStore((s) => s.openEncounter);
  const reportError = useAppStore((s) => s.reportError);
  const image = useMapImage(encounter.map);
  const status = encounterStatus(encounter);
  return (
    <div className="encounter-row">
      <AssetImage asset={image} alt="" className="encounter-thumb" />
      <div className="encounter-info">
        <strong>{encounter.name}</strong>
        <span className="muted">{encounter.combatants.length} combatants</span>
      </div>
      <span className={`status-chip ${status.kind}`}>{statusLabel(status)}</span>
      <Button
        icon="play"
        label="Play"
        variant={primary ? 'primary' : 'default'}
        onClick={() =>
          openEncounter({ campaignId: encounter.campaignId, encounterId: encounter.id }).catch(reportError)
        }
      />
    </div>
  );
}

function OpenQuests({ campaignId }: { campaignId: string }) {
  const { docs, problems } = useCampaignDocs(campaignId, QUESTS);
  const open = (docs ?? []).filter((q) => q.status === 'open').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="col">
      <h3>Open quests</h3>
      <Problems problems={problems} />
      {docs !== null && open.length === 0 ? (
        <span className="muted">No open quests.</span>
      ) : (
        <ul className="home-quests">
          {open.map((quest) => (
            <li key={quest.id}>
              <Icon name="flag" size={14} /> {quest.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One line into the current session's journal entry, the same place Play writes its events to. */
function QuickJournal({ campaignId }: { campaignId: string }) {
  const reportError = useAppStore((s) => s.reportError);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const note = text.trim();

  const add = async () => {
    setSaving(true);
    try {
      const saved = await appendToJournal(campaignId, [note], null);
      setText('');
      useAppStore.getState().notify(`Added to "${saved.title}"`, 'success');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="col"
      onSubmit={(e) => {
        e.preventDefault();
        if (note !== '') add().catch(reportError);
      }}
    >
      <h3>Journal</h3>
      <div className="row">
        <input
          className="grow"
          aria-label="Journal note"
          placeholder="A note for this session's journal"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button icon="journal" label="Add" type="submit" disabled={note === '' || saving} />
      </div>
    </form>
  );
}

/** Continue and Next session of one campaign; exactly one button is the accent: the next step. */
function CampaignDashboard(props: { campaign: Campaign; encounters: Encounter[]; last: EncounterLocator | null }) {
  const { campaign, encounters, last } = props;
  const running = last?.campaignId === campaign.id ? encounters.find((e) => e.id === last.encounterId) : undefined;
  const upcoming = encounters.filter((e) => e !== running && encounterStatus(e).kind !== 'finished');
  return (
    <>
      {running && <ContinueCard campaign={campaign} encounter={running} />}
      <section className="home-card" aria-label="Next session">
        <div className="home-card-head">
          <h2>Next session</h2>
          <div className="spacer" />
          <Button
            icon="plus"
            label="New encounter"
            variant={running || upcoming.length > 0 ? 'default' : 'primary'}
            onClick={() => openNewEncounter(campaign.id)}
          />
        </div>
        <div className="home-next">
          <div className="col">
            <h3>Encounters</h3>
            {upcoming.length === 0 ? (
              <span className="muted">Nothing prepared yet: add the fights of the next session.</span>
            ) : (
              upcoming.map((e, i) => <UpcomingEncounter key={e.id} encounter={e} primary={!running && i === 0} />)
            )}
          </div>
          <div className="col">
            <OpenQuests campaignId={campaign.id} />
            <QuickJournal campaignId={campaign.id} />
          </div>
        </div>
      </section>
    </>
  );
}

function RecentMapCard({ entry }: { entry: MapEntry }) {
  const navigate = useAppStore((s) => s.navigate);
  return (
    <button type="button" className="card recent-card" onClick={() => navigate({ page: 'map-editor', map: entry.ref })}>
      <AssetImage asset={entry.doc.image?.asset ?? null} alt="" />
      <span className="body">
        <strong>{entry.doc.name}</strong>
        <span className="muted">
          <Icon name="map" size={14} /> {new Date(entry.doc.updatedAt).toLocaleDateString()}
        </span>
      </span>
    </button>
  );
}

/** Routes dropped files: images and map exports become maps, stat blocks and campaigns are imported. */
async function handleDrop(files: File[]): Promise<void> {
  const { notify } = useAppStore.getState();
  const file = files[0];
  if (!file) {
    throw new Error('Nothing was dropped');
  }
  if (files.some(isMapSourceFile)) {
    openNewMapWizard(files);
  } else if (isDamFile(file)) {
    notify(`Drop "${file.name}" together with the .dd2vtt export it belongs to.`, 'info');
  } else if (/\.txt$/i.test(file.name)) {
    openCreatureImport(await file.text());
  } else if (/\.zip$/i.test(file.name)) {
    await importCampaignZip(new Uint8Array(await file.arrayBuffer()));
  } else if (/\.glb$/i.test(file.name)) {
    notify('3D models are added in the map editor: open a map and drop the .glb onto the canvas.', 'info');
  } else {
    notify(
      `"${file.name}" is not supported here: drop a battlemap image, a map export, a .txt stat block or ` +
        'an exported campaign.',
      'info',
    );
  }
}

function ImportButton() {
  const reportError = useAppStore((s) => s.reportError);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon="upload" label="Import…" title={IMPORT_HINT} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={DROP_TYPES}
        multiple
        hidden
        onChange={(e) => {
          handleDrop([...(e.target.files ?? [])]).catch(reportError);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function HomePage() {
  const last = useAppStore((s) => s.settings?.lastEncounter ?? null);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const maps = useLibraryStore((s) => s.listings.map.entries);
  const loaded = useCampaigns();
  const [picked, setPicked] = useState<string | null>(null);
  const { dragging, handlers } = useFileDrop((files) => handleDrop(files).catch(reportError));
  const campaignId = loaded && homeCampaignId(loaded.campaigns, loaded.encounters, picked, last);
  const campaign = loaded?.campaigns.find((c) => c.id === campaignId);
  const recent = recentMaps(maps, RECENT_LIMIT);
  return (
    <div className={dragging ? 'page-frame page-drop dragging' : 'page-frame page-drop'} {...handlers}>
      <PageHeader crumbs={[{ label: 'Home' }]}>
        {campaign && (
          <>
            <select aria-label="Campaign" value={campaign.id} onChange={(e) => setPicked(e.target.value)}>
              {loaded?.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button
              icon="swords"
              label="Open campaign"
              onClick={() => navigate({ page: 'campaigns', campaignId: campaign.id })}
            />
          </>
        )}
        <ImportButton />
      </PageHeader>
      <div className="page-body home">
        <FirstSteps />
        {campaign && loaded ? (
          <CampaignDashboard
            key={campaign.id}
            campaign={campaign}
            encounters={loaded.encounters.filter((e) => e.campaignId === campaign.id)}
            last={last}
          />
        ) : (
          loaded && (
            <EmptyState
              icon="swords"
              title="No campaigns yet."
              action={<Button icon="plus" label="New campaign" variant="primary" onClick={openNewCampaign} />}
            >
              A campaign holds the encounters, journal and quests of one group; Home then shows its next session.
            </EmptyState>
          )
        )}
        <section aria-label="Recent maps">
          <div className="home-card-head">
            <h2>Recent maps</h2>
            <div className="spacer" />
            <Button icon="plus" label="New map" onClick={() => openNewMapWizard()} />
          </div>
          {recent.length === 0 ? (
            <span className="muted">
              Maps you work on appear here. Drop a battlemap image on this page to start one.
            </span>
          ) : (
            <div className="card-grid">
              {recent.map((entry) => (
                <RecentMapCard key={`${entry.ref.area}:${entry.ref.id}`} entry={entry} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
