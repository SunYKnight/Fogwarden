import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  API_PARTS,
  DND5E_API_PACK,
  planDndApiImport,
  runDndApiImport,
  type ApiPart,
  type ApiPlan,
  type ApiReport,
} from '@/data/dnd5eApiImport';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { completeOnboardingStep } from '@/ui/home/onboarding';
import { Button, Dialog } from '../kit';
import { closeCompendiumDialog } from './compendiumUi';

// Sizes measured on the API in 2026; pictures are about 1.7 MB each.
const PART_TEXT: Record<ApiPart, { label: string; contents: string; size: string }> = {
  monsters: { label: 'Monsters', contents: 'stat blocks', size: 'about 1 MB' },
  spells: { label: 'Spells', contents: 'spells', size: 'about 0.5 MB' },
  areas: {
    label: 'Area templates',
    contents: 'spells, those with an area as templates',
    size: 'no extra download with Spells',
  },
  magicItems: { label: 'Magic items', contents: 'items with their variants', size: 'about 0.4 MB' },
  equipment: { label: 'Equipment', contents: 'weapons, armor, gear, tools and mounts', size: 'about 0.2 MB' },
  pictures: { label: 'Monster pictures', contents: 'paintings, shrunk to 768 px', size: 'about 580 MB' },
};

const NO_PROGRESS: Record<ApiPart, number> = {
  monsters: 0,
  pictures: 0,
  spells: 0,
  areas: 0,
  magicItems: 0,
  equipment: 0,
};

type Stage =
  | { step: 'list' }
  | { step: 'unreachable' }
  | { step: 'choose'; plan: ApiPlan }
  | { step: 'import'; plan: ApiPlan; parts: ApiPart[] }
  /** `report` is null when the import was cancelled. */
  | { step: 'done'; plan: ApiPlan; parts: ApiPart[]; report: ApiReport | null };

function summary(parts: readonly ApiPart[], counts: Record<ApiPart, number>): string {
  return parts.map((p) => `${counts[p]} ${PART_TEXT[p].label.toLowerCase()}`).join(', ');
}

/** "Import from the D&D 5e API": chosen parts into the pack "D&D 5e API (SRD 5.1)", with progress per part. */
export function DndApiImportDialog() {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const repository = useAppStore((s) => s.repository);
  const [stage, setStage] = useState<Stage>({ step: 'list' });
  const [chosen, setChosen] = useState<Record<ApiPart, boolean>>({
    monsters: true,
    spells: true,
    areas: true,
    magicItems: true,
    equipment: true,
    pictures: true,
  });
  const [progress, setProgress] = useState(NO_PROGRESS);
  const running = useRef<AbortController | null>(null);

  const list = useCallback(() => {
    planDndApiImport().then(
      (plan) => setStage({ step: 'choose', plan }),
      (error: unknown) => {
        setStage({ step: 'unreachable' });
        reportError(error);
      },
    );
  }, [reportError]);

  useEffect(list, [list]);

  const retry = () => {
    setStage({ step: 'list' });
    list();
  };

  const start = async (plan: ApiPlan) => {
    const parts = API_PARTS.filter((p) => chosen[p]);
    const controller = new AbortController();
    running.current = controller;
    const done: Record<ApiPart, number> = { ...NO_PROGRESS };
    setProgress(done);
    setStage({ step: 'import', plan, parts });
    try {
      const report = await runDndApiImport(
        repository,
        plan,
        parts,
        (part, count) => {
          done[part] = count;
          setProgress({ ...done });
        },
        controller.signal,
      );
      setStage({ step: 'done', plan, parts, report });
      const problems = report.problems.length > 0 ? `; ${report.problems.length} skipped` : '';
      notify(`D&D 5e API: imported ${summary(parts, report.written)}${problems}`);
    } catch (error) {
      if (controller.signal.aborted) {
        setStage({ step: 'done', plan, parts, report: null });
        notify(`D&D 5e API import cancelled after ${summary(parts, done)}`, 'info');
      } else {
        setStage({ step: 'choose', plan });
        reportError(error);
      }
    } finally {
      running.current = null;
      await useLibraryStore.getState().refreshAll();
      if (API_PARTS.some((part) => done[part] > 0)) {
        await completeOnboardingStep('srdData');
      }
    }
  };

  // Closing mid-import cancels it; what is written so far stays in the pack.
  const close = () => {
    running.current?.abort();
    closeCompendiumDialog();
  };

  const plan = stage.step === 'list' || stage.step === 'unreachable' ? null : stage.plan;
  const chosenCount = API_PARTS.filter((p) => chosen[p]).length;
  let footer: ReactNode;
  if (stage.step === 'import') {
    footer = <Button icon="close" label="Cancel import" onClick={() => running.current?.abort()} />;
  } else if (stage.step === 'done') {
    footer = <Button label="Close" variant="primary" onClick={close} />;
  } else {
    footer = (
      <>
        <Button label="Cancel" onClick={close} />
        {stage.step === 'unreachable' ? (
          <Button label="Try again" variant="primary" onClick={retry} />
        ) : (
          <Button
            icon="download"
            label={`Import into pack "${DND5E_API_PACK.name}"`}
            variant="primary"
            disabled={plan === null || chosenCount === 0}
            onClick={() => plan && start(plan).catch(reportError)}
          />
        )}
      </>
    );
  }

  return (
    <Dialog title="Import from the D&D 5e API" onClose={close} width={600} footer={footer}>
      <div className="col">
        {stage.step === 'list' && <p>Asking dnd5eapi.co what it has…</p>}
        {stage.step === 'unreachable' && <p>The D&amp;D 5e API could not be reached.</p>}
        {stage.step === 'choose' && (
          <>
            <p>
              Downloads the System Reference Document 5.1 (CC-BY-4.0) from dnd5eapi.co into the pack &quot;
              {DND5E_API_PACK.name}&quot; in your data folder; the app itself ships no monsters. Ids are the SRD ones
              (srd-goblin …), so encounters and pictures naming them find them, and the spell areas replace the
              app&apos;s five SRD area templates.
            </p>
            {API_PARTS.map((part) => {
              const { label, contents, size } = PART_TEXT[part];
              return (
                <label key={part} className="row">
                  <input
                    type="checkbox"
                    checked={chosen[part]}
                    onChange={(e) => setChosen((c) => ({ ...c, [part]: e.target.checked }))}
                  />
                  <span>
                    <strong>{label}</strong>: {stage.plan[part].length} {contents}{' '}
                    <span className="muted">({size})</span>
                  </span>
                </label>
              );
            })}
            <p className="hint-bar">
              Importing again replaces what the pack already has. The monster pictures are not part of the SRD: they
              come from dnd5eapi.co for your personal use. Item pictures are not imported.
            </p>
          </>
        )}
        {(stage.step === 'import' || stage.step === 'done') && (
          <dl className="import-counts">
            {stage.parts.map((part) => (
              <div key={part}>
                <dt>{PART_TEXT[part].label}</dt>
                <dd>
                  <progress max={stage.plan[part].length} value={progress[part]} /> {progress[part]} /{' '}
                  {stage.plan[part].length}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {stage.step === 'done' &&
          (stage.report ? (
            <>
              <p>
                Imported into the pack &quot;{DND5E_API_PACK.name}&quot;: {summary(stage.parts, stage.report.written)}.
              </p>
              {stage.report.problems.length > 0 && (
                <details>
                  <summary>{stage.report.problems.length} skipped</summary>
                  <ul className="small">
                    {stage.report.problems.map((p) => (
                      <li key={`${p.part}/${p.name}`}>
                        {PART_TEXT[p.part].label}, {p.name}: {p.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p>Cancelled. What was downloaded so far stays in the pack; importing again completes it.</p>
          ))}
      </div>
    </Dialog>
  );
}
