import { isTauri } from '@tauri-apps/api/core';
import { documentDir, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { countOf } from '@/core/plural';
import {
  AURORA_PACK,
  auroraBooks,
  DEFAULT_AURORA_PARTS,
  planAuroraImport,
  runAuroraImport,
  type AuroraParts,
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

const PART_LABEL: Record<keyof AuroraParts, string> = {
  characters: 'Player characters',
  items: 'Items and magic items',
  spells: 'Spells',
  portraits: 'Portrait library',
};

const PART_KEYS: (keyof AuroraParts)[] = ['characters', 'items', 'spells', 'portraits'];
function fromBooks(count: number, books: string[]): string {
  return `${count} from ${countOf(books.length, 'book')}`;
}

function partDetail(part: keyof AuroraParts, plan: AuroraPlan): string {
  const items = [...plan.items, ...plan.magicItems];
  const details: Record<keyof AuroraParts, () => string> = {
    characters: () =>
      `${plan.characters.length}, with only the portraits they use` +
      (plan.characters.length > 0
        ? `: ${plan.characters
            .map(
              (c) =>
                `${c.creature.name} (level ${c.creature.level}, AC ${c.creature.armorClass}, ` +
                `HP ${c.creature.hitPoints.average})`,
            )
            .join(' · ')}`
        : ''),
    items: () => `${fromBooks(items.length, auroraBooks(items))} (${plan.magicItems.length} magic)`,
    spells: () => fromBooks(plan.spells.length, auroraBooks(plan.spells)),
    portraits: () => `${plan.portraits.length} race portraits from portraits/`,
  };
  return details[part]();
}

/** The counts of the parts this import wrote; portraits also count when characters brought theirs. */
function countLines(report: AuroraReport): [string, number][] {
  const lines: [boolean, string, number][] = [
    [report.parts.characters, 'Characters', report.characters],
    [report.parts.items, 'Items', report.items],
    [report.parts.items, 'Magic items', report.magicItems],
    [report.parts.spells, 'Spells', report.spells],
    [report.parts.portraits || report.portraits > 0, 'Portraits', report.portraits],
  ];
  return lines.filter(([shown]) => shown).map(([, label, n]) => [label, n]);
}

/** Characters, items, magic items, spells and portraits from Aurora Builder into the pack "Aurora Builder". */
export function AuroraImportDialog({ onClose }: { onClose: () => void }) {
  const [parts, setParts] = useState<AuroraParts>(DEFAULT_AURORA_PARTS);
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
      const report = await runAuroraImport(plan, parts, PICKED_FOLDER, repository, (done, total) =>
        setStage({ step: 'import', done, total }),
      );
      await useLibraryStore.getState().refreshAll();
      setStage({ step: 'done', report });
      notify(
        `Aurora Builder: imported ${countLines(report)
          .map(([label, n]) => `${n} ${label.toLowerCase()}`)
          .join(', ')}`,
      );
    } catch (error) {
      setStage({ step: 'plan', plan });
      reportError(error);
    }
  };

  const plan = stage.step === 'plan' ? stage.plan : null;
  const busy = stage.step === 'import' || stage.step === 'read';
  const footer =
    stage.step === 'done' ? (
      <Button label="Close" variant="primary" onClick={onClose} />
    ) : busy ? null : (
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
            disabled={!Object.values(parts).some(Boolean)}
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
    <Dialog
      title="Import from Aurora Builder"
      onClose={() => {
        // Closing mid-import would hide a job that keeps writing the pack.
        if (stage.step !== 'import') onClose();
      }}
      width={560}
      footer={footer}
    >
      <div className="col">
        {stage.step === 'pick' && (
          <>
            <p>
              Pick Aurora Builder&apos;s documents folder (with <code>custom</code>, <code>portraits</code> and the
              <code> .dnd5e</code> characters), then tick the parts to import into the pack &quot;{AURORA_PACK.name}
              &quot; in your data folder. Importing a part again replaces it, so level-ups arrive; unticked parts stay
              as an earlier import left them.
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
            {PART_KEYS.map((part) => (
              <label key={part} className="row">
                <input
                  type="checkbox"
                  checked={parts[part]}
                  onChange={(e) => setParts((p) => ({ ...p, [part]: e.target.checked }))}
                />
                <span>
                  <strong>{PART_LABEL[part]}</strong>: {partDetail(part, plan)}
                </span>
              </label>
            ))}
            <p className="muted small">
              Unticked parts keep what an earlier import put into the pack; ticked parts replace it.
            </p>
            {plan.problems.length > 0 && (
              <details>
                <summary>{countOf(plan.problems.length, 'file')} could not be read</summary>
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
            <dl className="import-counts">
              {countLines(stage.report).map(([label, n]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
            </dl>
            {stage.report.removed > 0 && (
              <p className="muted small">Removed {countOf(stage.report.removed, 'file')} the earlier import had.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
