import { useState } from 'react';
import type { OnboardingStep } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, Dialog, Icon, type IconName } from '../kit';
import { openNewMapWizard } from '../library/NewMapWizard';
import { completeOnboardingStep, dismissFirstSteps, openSampleEncounter } from './onboarding';

interface StepSpec {
  id: OnboardingStep;
  icon: IconName;
  title: string;
  text: string;
  action: string;
}

const STEPS: StepSpec[] = [
  {
    id: 'dataFolder',
    icon: 'folder',
    title: 'Choose data folder',
    text: 'Where your maps, creatures and campaigns are stored; pick a synced folder to share them.',
    action: 'Open settings',
  },
  {
    id: 'legacyImport',
    icon: 'upload',
    title: 'Import from the old WPF tool',
    text: 'Bring over creatures, tile maps and area templates from the previous DM tool.',
    action: 'How to import',
  },
  {
    id: 'mapFromImage',
    icon: 'image',
    title: 'Create a map from an image',
    text: 'Pick a battlemap image and line up its grid in three steps.',
    action: 'New map',
  },
  {
    id: 'sampleEncounter',
    icon: 'play',
    title: 'Open the sample encounter',
    text: 'Four goblins ambush two heroes at a ruined chapel: a ready-made fight on a 3D map.',
    action: 'Open sample',
  },
];

function LegacyImportDialog({ onClose }: { onClose: () => void }) {
  const roots = useAppStore((s) => s.roots);
  const reportError = useAppStore((s) => s.reportError);
  const dataRoot = roots ? ` --data-root "${roots.dataRoot}"` : '';
  const command = `pnpm tsx tools/import-legacy.ts "<path to 240722_DnD_DMTool_Data>"${dataRoot}`;

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    useAppStore.getState().notify('Command copied');
  };
  const finish = async () => {
    await useLibraryStore.getState().refreshAll();
    await completeOnboardingStep('legacyImport');
    onClose();
  };

  return (
    <Dialog
      title="Import from the old WPF tool"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button label="Close" onClick={onClose} />
          <Button
            label="Imported, refresh library"
            icon="check"
            variant="primary"
            onClick={() => finish().catch(reportError)}
          />
        </>
      }
    >
      <div className="col">
        <p>
          The import runs as a command in the project folder of this app. It converts creatures, tile maps and area
          templates from the old tool's data folder (<code>240722_DnD_DMTool_Data</code>) into this app's data folder.
          Running it again overwrites earlier imports instead of duplicating them.
        </p>
        <ol>
          <li>Open a terminal in the project folder.</li>
          <li>Run the command below with the path to the old data folder.</li>
          <li>Come back and refresh the library.</li>
        </ol>
        <div className="command-line">
          <code>{command}</code>
          <Button icon="copy" label="Copy" onClick={() => copy().catch(reportError)} />
        </div>
        <p className="muted">
          Raw stat block files are imported the same way with <code>tools/import-statblocks.ts</code>, or one at a time
          by dropping the <code>.txt</code> file on the Home page.
        </p>
      </div>
    </Dialog>
  );
}

/** Next actions for a new user; hidden once dismissed or all done. */
export function FirstSteps() {
  const onboarding = useAppStore((s) => s.settings?.onboarding);
  const reportError = useAppStore((s) => s.reportError);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const actions: Record<OnboardingStep, () => Promise<void>> = {
    dataFolder: async () => {
      await completeOnboardingStep('dataFolder');
      useAppStore.getState().navigate({ page: 'settings' });
    },
    legacyImport: async () => setLegacyOpen(true),
    mapFromImage: async () => openNewMapWizard(),
    sampleEncounter: async () => {
      setBusy(true);
      try {
        await openSampleEncounter();
      } finally {
        setBusy(false);
      }
    },
  };

  const remaining = onboarding ? STEPS.filter((s) => !onboarding.done[s.id]).length : 0;
  return onboarding && !onboarding.dismissed && remaining > 0 ? (
    <section className="home-card first-steps" aria-label="First steps">
      <div className="home-card-head">
        <h2>First steps</h2>
        <span className="muted">
          {STEPS.length - remaining} of {STEPS.length} done
        </span>
        <div className="spacer" />
        <Button
          icon="close"
          label="Hide first steps"
          variant="ghost"
          onClick={() => dismissFirstSteps().catch(reportError)}
        />
      </div>
      <ol className="first-steps-list">
        {STEPS.map((step) => {
          const done = onboarding.done[step.id];
          return (
            <li key={step.id} className={done ? 'done' : ''}>
              <span className="first-step-icon">
                <Icon name={done ? 'check' : step.icon} />
              </span>
              <div className="first-step-text">
                <strong>{step.title}</strong>
                <span className="muted">{done ? 'Done' : step.text}</span>
              </div>
              <Button
                label={step.action}
                variant={done ? 'ghost' : 'default'}
                disabled={busy}
                onClick={() => actions[step.id]().catch(reportError)}
              />
            </li>
          );
        })}
      </ol>
      {legacyOpen && <LegacyImportDialog onClose={() => setLegacyOpen(false)} />}
    </section>
  ) : null;
}
