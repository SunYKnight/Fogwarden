import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import {
  LEGACY_FOLDER_NAME,
  LegacyFolderError,
  planLegacyImport,
  runLegacyImport,
  type LegacyPlan,
  type LegacyProblem,
  type LegacyReport,
  type LegacySource,
} from '@/data/legacyImport';
import { listFolder, readFileBytes, readFileText } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, Dialog } from '../kit';
import { completeOnboardingStep } from './onboarding';

const PICKED_FOLDER: LegacySource = { list: listFolder, readText: readFileText, readBytes: readFileBytes };

type Stage =
  | { step: 'pick'; error: string | null }
  | { step: 'plan'; plan: LegacyPlan }
  | { step: 'import'; done: number; total: number }
  | { step: 'done'; report: LegacyReport };

function ProblemList({ title, problems }: { title: string; problems: LegacyProblem[] }) {
  return problems.length > 0 ? (
    <details>
      <summary>
        {problems.length} {title}
      </summary>
      <ul className="portrait-list">
        {problems.map((p, index) => (
          <li key={index}>
            <span className="row-name">{p.file}</span>
            <span className="muted">{p.message}</span>
          </li>
        ))}
      </ul>
    </details>
  ) : null;
}

/** Imports creatures, tile maps and area templates from the WPF tool's data folder the user picks. */
export function LegacyImportDialog({ onClose }: { onClose: () => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const [stage, setStage] = useState<Stage>({ step: 'pick', error: null });
  const [busy, setBusy] = useState(false);
  const desktop = isTauri();

  const choose = async () => {
    const folder = await open({ directory: true, title: `Choose the old data folder (${LEGACY_FOLDER_NAME})` });
    if (folder !== null) {
      setBusy(true);
      try {
        setStage({ step: 'plan', plan: await planLegacyImport(PICKED_FOLDER, folder) });
      } catch (error) {
        if (!(error instanceof LegacyFolderError)) {
          throw error;
        }
        setStage({ step: 'pick', error: error.message });
      } finally {
        setBusy(false);
      }
    }
  };

  const start = async (plan: LegacyPlan) => {
    const { repository, notify } = useAppStore.getState();
    const onProgress = (done: number, total: number) => setStage({ step: 'import', done, total });
    onProgress(0, plan.creatures.length + plan.maps.length + plan.markers.length);
    try {
      const report = await runLegacyImport(plan, PICKED_FOLDER, repository, onProgress);
      await useLibraryStore.getState().refreshAll();
      await completeOnboardingStep('legacyImport');
      setStage({ step: 'done', report });
      const { creatures, maps, areaTemplates } = report.imported;
      notify(`Imported ${creatures} creatures, ${maps} maps and ${areaTemplates} area templates`);
    } catch (error) {
      setStage({ step: 'plan', plan });
      throw error;
    }
  };

  const chooseButton = (label: string) => (
    <Button
      icon="folder"
      label={busy ? 'Reading the folder…' : label}
      disabled={busy}
      onClick={() => choose().catch(reportError)}
    />
  );
  const plan = stage.step === 'plan' ? stage.plan : null;
  const footer =
    stage.step === 'import' ? null : stage.step === 'done' ? (
      <Button label="Close" variant="primary" onClick={onClose} />
    ) : (
      <>
        <Button label="Cancel" onClick={onClose} />
        {plan && chooseButton('Choose another folder…')}
        {plan && (
          <Button
            icon="upload"
            label="Import"
            variant="primary"
            disabled={busy || plan.creatures.length + plan.maps.length + plan.markers.length === 0}
            onClick={() => start(plan).catch(reportError)}
          />
        )}
      </>
    );

  return (
    <Dialog title="Import from the old WPF tool" onClose={onClose} width={640} footer={footer}>
      <div className="col legacy-import">
        {stage.step === 'pick' && (
          <>
            <p>
              Converts creatures, tile maps and area templates from the old tool's data folder (
              <code>{LEGACY_FOLDER_NAME}</code>, next to its program) into this app's data folder. You see what will be
              imported before anything is written. Running it again replaces earlier imports instead of duplicating
              them.
            </p>
            {desktop ? (
              <div className="row">{chooseButton('Choose the old data folder…')}</div>
            ) : (
              <p className="muted">Importing needs the desktop app: the browser cannot read a folder on disk.</p>
            )}
            {stage.error && <p className="error-text">{stage.error}</p>}
          </>
        )}
        {stage.step === 'plan' && (
          <>
            <p className="muted portrait-folder">{stage.plan.folder}</p>
            <dl className="legacy-import-counts">
              <dt>Creatures</dt>
              <dd>{stage.plan.creatures.length}</dd>
              <dt>Maps</dt>
              <dd>{stage.plan.maps.length}</dd>
              <dt>Area templates</dt>
              <dd>{stage.plan.markers.length}</dd>
              <dt>Images found</dt>
              <dd>{stage.plan.images}</dd>
            </dl>
            <ProblemList title="files will be skipped" problems={stage.plan.skipped} />
            <ProblemList title="files will be imported with problems" problems={stage.plan.warnings} />
            <p className="muted">
              Everything goes into the content pack &quot;Legacy DM Tool&quot; (Compendium &gt; Packs). Earlier imports
              of the same creatures, maps and area templates are replaced, other entries stay as they are.
            </p>
          </>
        )}
        {stage.step === 'import' && (
          <>
            <progress value={stage.done} max={Math.max(stage.total, 1)} aria-label="Import progress" />
            <p className="muted">
              Imported {stage.done} of {stage.total} files…
            </p>
          </>
        )}
        {stage.step === 'done' && (
          <>
            <p>
              Imported <strong>{stage.report.imported.creatures}</strong> creatures,{' '}
              <strong>{stage.report.imported.maps}</strong> maps and{' '}
              <strong>{stage.report.imported.areaTemplates}</strong> area templates.
            </p>
            <ProblemList title="files skipped" problems={stage.report.skipped} />
            <ProblemList title="files imported with problems" problems={stage.report.warnings} />
          </>
        )}
      </div>
    </Dialog>
  );
}
