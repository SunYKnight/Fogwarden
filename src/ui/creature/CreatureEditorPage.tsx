import { produce } from 'immer';
import { useEffect, useState } from 'react';
import { createCreature, type Creature, type DocRef } from '@/core/model';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, confirmDialog, EmptyState, PageHeader } from '../kit';
import { CreatureForm, type Change } from './CreatureEditor';
import { StatBlock } from './StatBlock';

const COMPENDIUM = { page: 'compendium', tab: 'creatures' } as const;

function confirmDiscard(): Promise<boolean> {
  return confirmDialog({
    title: 'Discard changes',
    message: 'Your unsaved changes to this creature are lost.',
    confirmLabel: 'Discard',
    danger: true,
  });
}

/** Shipped creatures stay read-only; their Image and Token fields edit the portrait index instead. */
function editableCreature(entry: LibraryEntry<'creature'>): Creature {
  const portrait = useLibraryStore.getState().portraits[entry.ref.id];
  return entry.ref.area === 'content' && portrait
    ? { ...entry.doc, image: entry.doc.image ?? portrait.image, token: entry.doc.token ?? portrait.token }
    : entry.doc;
}

async function savePortrait(creature: Creature): Promise<void> {
  const { portraits, savePortraits } = useLibraryStore.getState();
  const { [creature.id]: _previous, ...others } = portraits;
  const kept =
    creature.image || creature.token ? { [creature.id]: { image: creature.image, token: creature.token } } : {};
  await savePortraits({ ...others, ...kept });
}

function CreatureEditorBody({ creature }: { creature: Creature }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const setLeaveGuard = useAppStore((s) => s.setLeaveGuard);
  const refresh = useLibraryStore((s) => s.refresh);
  const entry = useLibraryStore((s) => s.listings.creature.entries.find((e) => e.ref.id === creature.id));
  const [saved, setSaved] = useState(creature);
  const [draft, setDraft] = useState(creature);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== saved;
  const shipped = entry?.ref.area === 'content';
  const change: Change = (recipe) => setDraft((c) => produce(c, recipe));

  useEffect(() => {
    setLeaveGuard(dirty ? confirmDiscard : null);
    return () => setLeaveGuard(null);
  }, [dirty, setLeaveGuard]);

  const save = async () => {
    const unpictured = (c: Creature) => JSON.stringify({ ...c, image: null, token: null });
    setBusy(true);
    try {
      if (shipped && unpictured(draft) === unpictured(saved)) {
        await savePortrait(draft);
        setSaved(draft);
        useAppStore.getState().notify(`Saved the pictures of "${draft.name}"; the creature stays shipped`);
      } else {
        const stored = await repository.save('creature', draft);
        setSaved(stored);
        setDraft(stored);
        await refresh('creature');
        useAppStore.getState().notify(shipped ? `Saved your copy of "${stored.name}"` : 'Saved');
      }
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    const ok = await confirmDialog({
      title: 'Revert to shipped version',
      message: `Your copy of "${draft.name}" is deleted and the shipped version comes back.`,
      confirmLabel: 'Revert',
      danger: true,
    });
    if (ok) {
      await repository.remove('creature', draft.id);
      await refresh('creature');
      const original = useLibraryStore.getState().listings.creature.entries.find((e) => e.ref.id === draft.id);
      if (!original) {
        throw new Error(`Shipped creature "${draft.name}" is missing`);
      }
      setSaved(editableCreature(original));
      setDraft(editableCreature(original));
      useAppStore.getState().notify(`Reverted "${original.doc.name}"`);
    }
  };

  return (
    <div className="page-frame">
      <PageHeader
        crumbs={[{ label: 'Compendium', route: COMPENDIUM }, { label: draft.name || 'Unnamed creature' }]}
        status={dirty ? 'Unsaved changes' : entry ? 'Saved' : 'Not saved yet'}
      >
        {entry?.overridesContent && (
          <Button icon="undo" label="Revert to shipped" onClick={() => revert().catch(reportError)} />
        )}
        <Button
          icon="check"
          label="Save"
          variant="primary"
          disabled={(!dirty && entry !== undefined) || busy}
          onClick={() => save().catch(reportError)}
        />
        <Button icon="close" label="Close" onClick={() => useAppStore.getState().navigate(COMPENDIUM)} />
      </PageHeader>
      {shipped && (
        <div className="hint-bar" role="note">
          Shipped creature: saving creates your copy, which you can revert later. Changing only Image or Token keeps it
          shipped and stores the pictures separately.
        </div>
      )}
      <div className="creature-editor-body">
        <CreatureForm c={draft} change={change} />
        <div className="creature-preview">
          <StatBlock creature={draft} />
        </div>
      </div>
    </div>
  );
}

/** Creature editor as a page; `creatureRef` null starts a new creature. */
export function CreatureEditorPage({ creatureRef }: { creatureRef: DocRef | null }) {
  const [creature] = useState(() => {
    const entries = useLibraryStore.getState().listings.creature.entries;
    const entry = creatureRef && entries.find((e) => e.ref.id === creatureRef.id);
    return creatureRef ? entry && editableCreature(entry) : createCreature('New creature');
  });
  return creature ? (
    <CreatureEditorBody creature={creature} />
  ) : (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Compendium', route: COMPENDIUM }, { label: 'Missing creature' }]} />
      <EmptyState
        icon="alert"
        title="This creature no longer exists."
        action={<Button label="Back to the compendium" onClick={() => useAppStore.getState().navigate(COMPENDIUM)} />}
      />
    </div>
  );
}
