import { isTauri } from '@tauri-apps/api/core';
import { documentDir, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import {
  AURORA_PACK,
  planAuroraImport,
  runAuroraImport,
  type AuroraPlan,
  type AuroraReport,
  type AuroraSource,
} from '@/data/auroraImport';
import { listFolder, readFileBytes, readFileText } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, Dialog } from '../kit';

const PICKED_FOLDER: AuroraSource = { list: listFolder, readText: readFileText, readBytes: readFileBytes };
const AURORA_FOLDER = '5e Character Builder';

type Stage =
  | { step: 'pick' }
  | { step: 'read'; folder: string }
  | { step: 'plan'; plan: AuroraPlan }
  | { step: 'import'; done: number; total: number }
  | { step: 'done'; report: AuroraReport };

/** `Documents/5e Character Builder` when it exists, else null (the picker then opens where the OS likes). */
async function defaultFolder(): Promise<string | null> {
  const folder = await join(await documentDir(), AURORA_FOLDER);
  // Listing is the only existence check for folders outside the data root.
  return listFolder(folder).then(
    () => folder,
    () => null,
  );
}

function countLines(counts: Omit<AuroraReport, 'removed'>): [string, number][] {
  return [
    ['Characters', counts.characters],
    ['Items', counts.items],
    ['Magic items', counts.magicItems],
    ['Spells', counts.spells],
    ['Portraits', counts.portraits],
  ];
}

function Counts({ counts }: { counts: Omit<AuroraReport, 'removed'> }) {
  return (
    <dl className="import-counts">
      {countLines(counts).map(([label, n]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{n}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Characters, items, magic items, spells and portraits from Aurora Builder into the pack "Aurora Builder". */
export function AuroraImportDialog({ onClose }: { onClose: () => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const repository = useAppStore((s) => s.repository);
  const [stage, setStage] = useState<Stage>({ step: 'pick' });
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri()) {
      defaultFolder().then(setSuggested, reportError);
    }
  }, [reportError]);

  const read = async (folder: string) => {
    setStage({ step: 'read', folder });
    try {
      setStage({ step: 'plan', plan: await planAuroraImport(PICKED_FOLDER, folder) });
    } catch (error) {
      setStage({ step: 'pick' });
      reportError(error);
    }
  };

  const choose = async () => {
    const folder = await open({ directory: true, defaultPath: suggested ?? undefined, title: 'Aurora Builder folder' });
    if (typeof folder === 'string') {
      await read(folder);
    }
  };

  const start = async (plan: AuroraPlan) => {
    setStage({ step: 'import', done: 0, total: 1 });
    try {
      const report = await runAuroraImport(plan, PICKED_FOLDER, repository, (done, total) =>
        setStage({ step: 'import', done, total }),
      );
      await useLibraryStore.getState().refreshAll();
      setStage({ step: 'done', report });
      notify(
        `Imported ${report.characters} characters, ${report.items + report.magicItems} items and ${report.spells} spells`,
      );
    } catch (error) {
      setStage({ step: 'plan', plan });
      reportError(error);
    }
  };

  const plan = stage.step === 'plan' ? stage.plan : null;
  const footer =
    stage.step === 'done' ? (
      <Button label="Close" variant="primary" onClick={onClose} />
    ) : stage.step === 'import' || stage.step === 'read' ? null : (
      <>
        <Button
          icon="folder"
          label="Choose folder…"
          disabled={!isTauri()}
          onClick={() => choose().catch(reportError)}
        />
        {plan ? (
          <Button
            icon="upload"
            label={`Import into pack "${AURORA_PACK.name}"`}
            variant="primary"
            onClick={() => void start(plan)}
          />
        ) : (
          suggested && (
            <Button
              icon="search"
              label="Read Documents folder"
              variant="primary"
              onClick={() => void read(suggested)}
            />
          )
        )}
      </>
    );

  return (
    <Dialog title="Import from Aurora Builder" onClose={onClose} width={560} footer={footer}>
      <div className="col">
        {stage.step === 'pick' && (
          <>
            <p>
              Pick Aurora Builder&apos;s documents folder (with <code>custom</code>, <code>portraits</code> and the
              <code> .dnd5e</code> characters). Everything goes into the pack &quot;{AURORA_PACK.name}&quot; in your
              data folder; importing again replaces it, so level-ups arrive.
            </p>
            {suggested ? (
              <p className="muted small">Found: {suggested}</p>
            ) : (
              !isTauri() && <p className="hint-bar">Needs the desktop app.</p>
            )}
          </>
        )}
        {stage.step === 'read' && <p>Reading {stage.folder} …</p>}
        {plan && (
          <>
            <p className="muted small">{plan.folder}</p>
            <Counts
              counts={{
                characters: plan.characters.length,
                items: plan.items.length,
                magicItems: plan.magicItems.length,
                spells: plan.spells.length,
                portraits: plan.portraits.length,
              }}
            />
            {plan.characters.length > 0 && (
              <p className="small">
                {plan.characters
                  .map(
                    (c) =>
                      `${c.creature.name} (level ${c.creature.level}, AC ${c.creature.armorClass}, ` +
                      `HP ${c.creature.hitPoints.average})`,
                  )
                  .join(' · ')}
              </p>
            )}
            {plan.problems.length > 0 && (
              <details>
                <summary>{plan.problems.length} files could not be read</summary>
                <ul className="small">
                  {plan.problems.map((p) => (
                    <li key={p.file}>
                      {p.file}: {p.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="hint-bar">
              Book content stays on this computer: the pack is for your own use; export and share it only if the books
              allow it.
            </p>
          </>
        )}
        {stage.step === 'import' && (
          <>
            <p>
              Importing … {stage.done} / {stage.total}
            </p>
            <progress max={stage.total} value={stage.done} />
          </>
        )}
        {stage.step === 'done' && (
          <>
            <p>Imported into the pack &quot;{AURORA_PACK.name}&quot;:</p>
            <Counts counts={stage.report} />
            {stage.report.removed > 0 && (
              <p className="muted small">Removed {stage.report.removed} files the earlier import had.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
