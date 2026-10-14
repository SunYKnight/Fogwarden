import { type ReactNode, useEffect, useId, useState } from 'react';
import { createCampaign, createEncounter, type Campaign, type Creature, type DocRef } from '@/core/model';
import { parseStatBlock, StatBlockError } from '@/core/import/statblock';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Field, TextField } from '../components/fields';
import { MapPicker } from '../components/MapPicker';
import { StatBlock } from '../creature/StatBlock';
import { Button, Dialog, Icon } from '../kit';
import { AttachPortraitsDialog } from './AttachPortraitsDialog';
import { AuroraImportDialog } from './AuroraImportDialog';
import { DndApiImportDialog } from './DndApiImportDialog';
import { closeCompendiumDialog, useCompendiumDialogStore, type CompendiumDialog } from './compendiumUi';

// Long enough to wait out a burst of typing, short enough to feel live.
const PARSE_DELAY_MS = 300;

interface ParseResult {
  text: string;
  source: string;
  license: string;
  creature: Creature | null;
  problem: string | null;
}

/** A stat block that doesn't parse is a user input problem shown in place; other errors are reported. */
function checkStatBlock(
  text: string,
  source: string,
  license: string,
  reportError: (error: unknown) => void,
): ParseResult {
  const result: ParseResult = { text, source, license, creature: null, problem: null };
  try {
    result.creature = text.trim() === '' ? null : parseStatBlock(text, { source, license });
  } catch (error) {
    if (!(error instanceof StatBlockError)) reportError(error);
    result.problem = error instanceof StatBlockError ? error.message : null;
  }
  return result;
}

function CreatureImportDialog({ initialText }: { initialText: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const refresh = useLibraryStore((s) => s.refresh);
  const [text, setText] = useState(initialText);
  const [source, setSource] = useState('Custom');
  const [license, setLicense] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setResult(checkStatBlock(text, source, license, reportError)),
      PARSE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [text, source, license, reportError]);
  // Saving waits for the parse of exactly what the fields show.
  const current = result?.text === text && result.source === source && result.license === license;
  const parsed = current ? result.creature : null;

  const [busy, setBusy] = useState(false);

  const save = async (creature: Creature) => {
    setBusy(true);
    try {
      const id = await repository.newLibraryId('creature', creature.name);
      const stored = await repository.save('creature', { ...creature, id });
      await refresh('creature');
      closeCompendiumDialog();
      useAppStore.getState().notify(`Imported "${stored.name}"`);
      useAppStore.getState().navigate({ page: 'creature-editor', ref: { area: 'data', id: stored.id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Import creature from stat block text"
      onClose={closeCompendiumDialog}
      width={1000}
      footer={
        <>
          <Button label="Cancel" onClick={closeCompendiumDialog} />
          <Button
            icon="upload"
            label="Save and edit"
            variant="primary"
            disabled={!parsed || busy}
            onClick={() => parsed && !busy && save(parsed).catch(reportError)}
          />
        </>
      }
    >
      <div className="import-body">
        <div className="col">
          <textarea
            aria-label="Stat block text"
            rows={20}
            value={text}
            placeholder="Paste a stat block (name, size/type line, Armor Class, Hit Points, …)"
            onChange={(e) => setText(e.target.value)}
          />
          <TextField label="Source" value={source} onChange={setSource} />
          <TextField label="License" value={license} onChange={setLicense} />
          {result?.problem && (
            <div className="error-text" role="status">
              <Icon name="alert" size={16} /> {result.problem}
            </div>
          )}
        </div>
        <div className="creature-preview">
          {result?.creature ? (
            <StatBlock creature={result.creature} />
          ) : (
            <p className="muted">Paste or type a stat block to see it here.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

const NEW_CAMPAIGN = '';

function NewEncounterDialog({ campaignId, initialMap }: { campaignId: string | null; initialMap: DocRef | null }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [chosenCampaign, setChosenCampaign] = useState(campaignId ?? NEW_CAMPAIGN);
  const [campaignName, setCampaignName] = useState('');
  const [name, setName] = useState('');
  const [map, setMap] = useState<DocRef | null>(initialMap);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    if (campaignId === null) {
      repository.listCampaigns().then((listing) => {
        setCampaigns(listing.campaigns);
        setChosenCampaign((current) => current || (listing.campaigns[0]?.id ?? NEW_CAMPAIGN));
      }, reportError);
    }
  }, [repository, campaignId, reportError]);

  const creatingCampaign = chosenCampaign === NEW_CAMPAIGN;
  const valid = name.trim() !== '' && (!creatingCampaign || campaignName.trim() !== '');

  const create = async () => {
    setBusy(true);
    try {
      let targetId = chosenCampaign;
      if (creatingCampaign) {
        const trimmed = campaignName.trim();
        const campaign = { ...createCampaign(trimmed), id: await repository.newCampaignId(trimmed) };
        targetId = (await repository.saveCampaign(campaign)).id;
        // A retry after a failed encounter save must reuse this campaign.
        setChosenCampaign(targetId);
      }
      const draft = createEncounter(name.trim(), targetId, map);
      const encounterId = await repository.newEncounterId(targetId, draft.name);
      const encounter = await repository.saveEncounter({ ...draft, id: encounterId });
      closeCompendiumDialog();
      await useAppStore.getState().openEncounter({ campaignId: targetId, encounterId: encounter.id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New encounter"
      onClose={closeCompendiumDialog}
      width={760}
      footer={
        <>
          <Button label="Cancel" onClick={closeCompendiumDialog} />
          <Button
            icon="play"
            label="Create and play"
            variant="primary"
            disabled={!valid || busy}
            onClick={() => create().catch(reportError)}
          />
        </>
      }
    >
      <form
        className="col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) create().catch(reportError);
        }}
      >
        <Field label="Name" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            value={name}
            placeholder="e.g. Ambush on the road"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {campaignId === null && (
          <Field label="Campaign" htmlFor={`${id}-campaign`}>
            <select id={`${id}-campaign`} value={chosenCampaign} onChange={(e) => setChosenCampaign(e.target.value)}>
              {campaigns?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CAMPAIGN}>New campaign…</option>
            </select>
          </Field>
        )}
        {campaignId === null && creatingCampaign && (
          <Field label="Campaign name" htmlFor={`${id}-new-campaign`}>
            <input id={`${id}-new-campaign`} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </Field>
        )}
        <span className="muted">Map</span>
        <MapPicker value={map} onChange={setMap} />
      </form>
    </Dialog>
  );
}

type DialogOf<K extends CompendiumDialog['kind']> = Extract<CompendiumDialog, { kind: K }>;

const DIALOGS: { [K in CompendiumDialog['kind']]: (dialog: DialogOf<K>) => ReactNode } = {
  'creature-import': (d) => <CreatureImportDialog initialText={d.text} />,
  'new-encounter': (d) => <NewEncounterDialog campaignId={d.campaignId} initialMap={d.map} />,
  'attach-portraits': (d) => <AttachPortraitsDialog source={d.source} files={d.files} />,
  'aurora-import': () => <AuroraImportDialog onClose={closeCompendiumDialog} />,
  'dnd5e-api-import': () => <DndApiImportDialog />,
};

/** Mounted once in the shell so any page can open these dialogs. */
export function CompendiumDialogHost() {
  const dialog = useCompendiumDialogStore((s) => s.dialog);
  const render = dialog && (DIALOGS[dialog.kind] as (d: CompendiumDialog) => ReactNode);
  return render ? render(dialog) : null;
}
