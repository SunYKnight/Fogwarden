import { useEffect, useRef, useState } from 'react';
import type { AssetRef, Campaign, DocRef, Encounter, EncounterLocator } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { currentCombatant } from '@/state/encounterActions';
import { useLibraryStore } from '@/state/libraryStore';
import { AssetImage } from '../components/AssetImage';
import { Button, EmptyState, Icon, PageHeader } from '../kit';
import { openCreatureImport } from '../library/compendiumUi';
import { isImageFile, useFileDrop } from '../library/fileDrop';
import { openNewMapWizard } from '../library/NewMapWizard';
import { FirstSteps } from './FirstSteps';
import { recentItems, type RecentItem } from './recent';

const RECENT_LIMIT = 6;
const DROP_TYPES = 'image/png,image/jpeg,image/webp,.txt,.glb';

/** Battlemap image of a library map, for encounter thumbnails; a user copy shadows the shipped map. */
function useMapImage(ref: DocRef | null): AssetRef | null {
  const entries = useLibraryStore((s) => s.listings.map.entries);
  const entry = ref && entries.find((e) => e.ref.id === ref.id);
  return entry?.doc.image?.asset ?? null;
}

type CampaignEncounter = { campaign: Campaign; encounter: Encounter };

/** Every encounter of every campaign; Home shows the newest and the one to continue. */
function useEncounters(): CampaignEncounter[] | null {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [loaded, setLoaded] = useState<CampaignEncounter[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { campaigns } = await repository.listCampaigns();
      const lists = await Promise.all(campaigns.map((c) => repository.listEncounters(c.id)));
      const all = lists.flatMap((list, i) =>
        list.encounters.map((encounter) => ({ campaign: campaigns[i]!, encounter })),
      );
      if (!cancelled) setLoaded(all);
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

function RecentCard({ item }: { item: RecentItem }) {
  const navigate = useAppStore((s) => s.navigate);
  const openEncounter = useAppStore((s) => s.openEncounter);
  const reportError = useAppStore((s) => s.reportError);
  const encounterMap = useMapImage(item.kind === 'encounter' ? item.encounter.map : null);
  const isMap = item.kind === 'map';
  const open = () =>
    isMap
      ? navigate({ page: 'map-editor', map: item.ref })
      : openEncounter({ campaignId: item.campaign.id, encounterId: item.encounter.id }).catch(reportError);
  return (
    <button type="button" className="card recent-card" onClick={open}>
      <AssetImage asset={isMap ? (item.map.image?.asset ?? null) : encounterMap} alt="" />
      <span className="body">
        <strong>{isMap ? item.map.name : item.encounter.name}</strong>
        <span className="muted">
          <Icon name={isMap ? 'map' : 'swords'} size={14} /> {isMap ? 'Map' : `Encounter · ${item.campaign.name}`}
          {' · '}
          {new Date(item.updatedAt).toLocaleDateString()}
        </span>
      </span>
    </button>
  );
}

/** Routes dropped files: images become maps, stat blocks go to the creature import. */
async function handleDrop(files: File[]): Promise<void> {
  const { notify } = useAppStore.getState();
  const file = files[0];
  if (!file) {
    throw new Error('Nothing was dropped');
  }
  if (isImageFile(file)) {
    openNewMapWizard(file);
  } else if (/\.txt$/i.test(file.name)) {
    openCreatureImport(await file.text());
  } else if (/\.glb$/i.test(file.name)) {
    notify('3D models are added in the map editor: open a map and drop the .glb onto the canvas.', 'info');
  } else {
    notify(`"${file.name}" is not supported here: drop a battlemap image or a .txt stat block.`, 'info');
  }
}

function DropZone() {
  const reportError = useAppStore((s) => s.reportError);
  const input = useRef<HTMLInputElement>(null);
  const { dragging, handlers } = useFileDrop((files) => handleDrop(files).catch(reportError));
  return (
    <section className={dragging ? 'drop-zone home-drop dragging' : 'drop-zone home-drop'} {...handlers}>
      <Icon name="upload" size={32} />
      <strong>Drop files here</strong>
      <span className="muted">
        A battlemap image becomes a new map · a <code>.txt</code> stat block opens the creature import
      </span>
      <Button icon="folder" label="Choose file" onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={DROP_TYPES}
        hidden
        onChange={(e) => {
          handleDrop([...(e.target.files ?? [])]).catch(reportError);
          e.target.value = '';
        }}
      />
    </section>
  );
}

export function HomePage() {
  const last = useAppStore((s) => s.settings?.lastEncounter ?? null);
  const maps = useLibraryStore((s) => s.listings.map.entries);
  const loaded = useEncounters();
  const running = last && loaded?.find((e) => e.campaign.id === last.campaignId && e.encounter.id === last.encounterId);
  const recent = loaded ? recentItems(maps, loaded, RECENT_LIMIT) : [];
  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Home' }]} />
      <div className="page-body home">
        {running && <ContinueCard campaign={running.campaign} encounter={running.encounter} />}
        <FirstSteps />
        <DropZone />
        <section aria-label="Recent">
          <h2>Recent</h2>
          {loaded && recent.length === 0 ? (
            <EmptyState
              icon="map"
              title="Nothing here yet"
              action={<Button icon="plus" label="New map" variant="primary" onClick={() => openNewMapWizard()} />}
            >
              Maps and encounters you work on appear here.
            </EmptyState>
          ) : (
            <div className="card-grid">
              {recent.map((item) => (
                <RecentCard
                  key={item.kind === 'map' ? `map:${item.ref.area}:${item.ref.id}` : `enc:${item.encounter.id}`}
                  item={item}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
