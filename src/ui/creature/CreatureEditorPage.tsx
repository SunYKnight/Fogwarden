import { produce } from 'immer';
import { useEffect, useState } from 'react';
import { createCreature, type Creature, type DocRef } from '@/core/model';
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

function CreatureEditorBody({ creature }: { creature: Creature }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const setLeaveGuard = useAppStore((s) => s.setLeaveGuard);
  const refresh = useLibraryStore((s) => s.refresh);
  const [saved, setSaved] = useState(creature);
  const [draft, setDraft] = useState(creature);
  const entry = useLibraryStore((s) => s.listings.creature.entries.find((e) => e.ref.id === saved.id));
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
        const pictures = await repository.storeCreaturePictures(draft.id, draft);
        const stored = { ...draft, ...pictures };
        setSaved(stored);
        setDraft(stored);
        await refresh('creature');
        useAppStore.getState().notify(`Saved the pictures of "${draft.name}"; the creature stays shipped`);
      } else {
        // Ids outlive renames, so a new one comes from the first saved name.
        const id = entry ? draft.id : await repository.newLibraryId('creature', draft.name);
        const stored = await repository.save('creature', { ...draft, id });
        if (id !== draft.id) {
          // Pictures picked before saving were stored under the draft id.
          await repository.storeCreaturePictures(draft.id, { image: null, token: null });
        }
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
      setSaved(original.doc);
      setDraft(original.doc);
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
          shipped and stores the pictures as files named after it.
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
    return creatureRef ? entry?.doc : createCreature('New creature');
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
