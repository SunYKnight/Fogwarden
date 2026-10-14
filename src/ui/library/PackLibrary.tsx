import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useRef, useState, type KeyboardEvent } from 'react';
import { countOf } from '@/core/plural';
import type { LibraryKind, PackSettings } from '@/core/model';
import type { ZipFile } from '@/core/zip';
import {
  exportManifest,
  exportPack,
  installPack,
  packArchiveName,
  PackExistsError,
  packFilesOf,
  readPackZip,
  removePack,
  type PackFiles,
} from '@/data/packArchive';
import { LIBRARY_KINDS, type PackInfo } from '@/data/repository';
import { listFolder, readFileBytes, writeFileBytes } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { Button, confirmDialog, EmptyState, Icon } from '../kit';
import { openAuroraImport } from './compendiumUi';
import { download } from './mapExport';

const COUNT_LABELS: Record<LibraryKind | 'model' | 'portrait', [string, string]> = {
  creature: ['creature', 'creatures'],
  marker: ['area template', 'area templates'],
  map: ['map', 'maps'],
  table: ['table', 'tables'],
  item: ['item', 'items'],
  spell: ['spell', 'spells'],
  model: ['3D model', '3D models'],
  portrait: ['portrait', 'portraits'],
};

function countLabel(kind: keyof typeof COUNT_LABELS, count: number): string {
  return countOf(count, ...COUNT_LABELS[kind]);
}

export function countText(counts: PackInfo['counts']): string {
  const parts = (Object.keys(COUNT_LABELS) as (keyof typeof COUNT_LABELS)[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => countLabel(kind, counts[kind]));
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

/** Ids of the packs below My content, highest precedence first. */
function packOrder(): string[] {
  return useLibraryStore
    .getState()
    .packs.filter((p) => p.origin !== 'mine')
    .map((p) => p.source.pack);
}

async function changePackSettings(change: (packs: PackSettings) => PackSettings): Promise<void> {
  const { settings, setSettings } = useAppStore.getState();
  if (!settings) {
    throw new Error('Settings are not loaded yet');
  }
  await setSettings({ ...settings, packs: change(settings.packs) });
  await useLibraryStore.getState().refreshAll();
}

/** Installs `pack`, asking before an installed pack with its id is replaced; it then ranks first. */
async function install(pack: PackFiles): Promise<void> {
  const { repository, notify } = useAppStore.getState();
  const { id, name, version } = pack.manifest;
  let installed = true;
  try {
    await installPack(repository, pack, false);
  } catch (error) {
    if (!(error instanceof PackExistsError)) {
      throw error;
    }
    installed = await confirmDialog({
      title: 'Replace pack',
      message: `"${name}" is already installed. Its files are replaced by the imported ${version || 'version'}.`,
      confirmLabel: 'Replace pack',
      danger: true,
    });
    if (installed) {
      await installPack(repository, pack, true);
    }
  }
  if (installed) {
    await changePackSettings((packs) => ({ ...packs, order: [id, ...packOrder().filter((p) => p !== id)] }));
    notify(`Imported the pack "${name}"`);
  }
}

/** Every file below `root` of a folder the user picked, paths relative to it. */
async function readFolder(root: string, dir = ''): Promise<ZipFile[]> {
  const entries = await listFolder(dir === '' ? root : `${root}/${dir}`);
  const nested = await Promise.all(
    entries.map(async (e) => {
      const path = dir === '' ? e.name : `${dir}/${e.name}`;
      return e.isDir ? readFolder(root, path) : [{ path, bytes: await readFileBytes(`${root}/${path}`) }];
    }),
  );
  return nested.flat();
}

async function importFolder(): Promise<void> {
  const folder = await open({ directory: true, title: 'Choose a content pack folder (with pack.json)' });
  if (folder !== null) {
    await install(packFilesOf(await readFolder(folder.replace(/[\\/]+$/, ''))));
  }
}

async function exportToZip(pack: PackInfo): Promise<void> {
  const { repository, notify } = useAppStore.getState();
  const manifest = exportManifest(pack, new Date());
  const fileName = packArchiveName(manifest);
  const target = isTauri()
    ? await save({ defaultPath: fileName, filters: [{ name: 'Content pack', extensions: ['zip'] }] })
    : fileName;
  if (target !== null) {
    const bytes = await exportPack(repository, pack.source, manifest);
    if (isTauri()) {
      await writeFileBytes(target, bytes);
    } else {
      download(fileName, bytes);
    }
    notify(`Exported "${target.split(/[\\/]/).at(-1)}"`);
  }
}

async function remove(pack: PackInfo): Promise<void> {
  const { name } = pack.manifest;
  const ok = await confirmDialog({
    title: 'Remove pack',
    message:
      `"${name}" (${countText(pack.counts)}) is deleted from your data folder. Your own copies of its ` +
      'entries stay. Encounters keep their combatants, but stat blocks, pictures and maps from this pack are ' +
      'gone until you import it again.',
    confirmLabel: 'Remove pack',
    danger: true,
  });
  if (ok) {
    const id = pack.source.pack;
    await removePack(useAppStore.getState().repository, id);
    await changePackSettings((packs) => {
      const { [id]: _removed, ...hiddenKinds } = packs.hiddenKinds;
      return {
        ...packs,
        order: packs.order.filter((p) => p !== id),
        disabled: packs.disabled.filter((p) => p !== id),
        hiddenKinds,
      };
    });
    useAppStore.getState().notify(`Removed the pack "${name}"`);
  }
}

export async function setPackEnabled(pack: PackInfo, enabled: boolean): Promise<void> {
  const id = pack.source.pack;
  await changePackSettings((packs) => ({
    ...packs,
    disabled: enabled ? packs.disabled.filter((p) => p !== id) : [...packs.disabled, id],
  }));
  const what = enabled ? 'its entries are back' : 'its entries are hidden';
  useAppStore.getState().notify(`${enabled ? 'Enabled' : 'Disabled'} "${pack.manifest.name}": ${what}`, 'info');
}

async function setKindShown(pack: PackInfo, kind: LibraryKind, shown: boolean): Promise<void> {
  const id = pack.source.pack;
  await changePackSettings((packs) => {
    const others = (packs.hiddenKinds[id] ?? []).filter((k) => k !== kind);
    return { ...packs, hiddenKinds: { ...packs.hiddenKinds, [id]: shown ? others : [...others, kind] } };
  });
}

async function move(id: string, to: number): Promise<void> {
  const order = packOrder().filter((p) => p !== id);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
  await changePackSettings((packs) => ({ ...packs, order }));
}

/** Header actions of the Packs tab. */
export function PackActions() {
  const reportError = useAppStore((s) => s.reportError);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        icon="users"
        label="Import from Aurora Builder…"
        disabled={!isTauri()}
        title={isTauri() ? 'Characters, items, spells and portraits' : 'Needs the desktop app'}
        onClick={openAuroraImport}
      />
      <Button
        icon="folder"
        label="Import folder…"
        disabled={!isTauri()}
        title={isTauri() ? 'A folder with pack.json at its top' : 'Needs the desktop app'}
        onClick={() => importFolder().catch(reportError)}
      />
      <Button icon="upload" label="Import pack…" variant="primary" onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            file
              .arrayBuffer()
              .then((bytes) => readPackZip(new Uint8Array(bytes)))
              .then(install)
              .catch(reportError);
          }
        }}
      />
    </>
  );
}

function Overridden({ pack }: { pack: PackInfo }) {
  const listings = useLibraryStore((s) => s.listings);
  const packs = useLibraryStore((s) => s.packs);
  const hideDuplicates = useAppStore((s) => s.settings?.packs.hideDuplicates ?? true);
  const overridden = new Map<string, number>();
  const duplicated = new Map<string, number>();
  for (const listing of Object.values(listings)) {
    for (const s of listing.shadowed.filter((x) => x.pack === pack.source.pack)) {
      overridden.set(s.by, (overridden.get(s.by) ?? 0) + 1);
    }
    for (const d of hideDuplicates ? listing.duplicates.filter((x) => x.pack === pack.source.pack) : []) {
      duplicated.set(d.by, (duplicated.get(d.by) ?? 0) + 1);
    }
  }
  const parts = [
    ...[...overridden].map(([by, n]) => `${n} overridden by ${packName(packs, by)}`),
    ...[...duplicated].map(([by, n]) => `${n} hidden as duplicates of ${packName(packs, by)}`),
  ];
  return parts.length > 0 ? (
    <span
      className="muted small"
      title="Entries with the same id in a pack higher up win; while Hide duplicates is on, so do the same names"
    >
      <Icon name="info" size={12} /> {parts.join(' · ')}
    </span>
  ) : null;
}

/** Tick boxes of the kinds a pack holds; an unticked kind is left out as if the pack were disabled. */
function KindToggles({ pack, busy, run }: Pick<RowProps, 'pack' | 'busy' | 'run'>) {
  const hidden = useAppStore((s) => s.settings?.packs.hiddenKinds[pack.source.pack]) ?? [];
  const { counts } = pack;
  const kinds = LIBRARY_KINDS.filter((kind) => counts[kind] > 0);
  const files = (['model', 'portrait'] as const).filter((kind) => counts[kind] > 0);
  return (
    <div className="row wrap small">
      {kinds.map((kind) => (
        <label key={kind} className="row" title="Untick to hide them everywhere; encounters keep their combatants">
          <input
            type="checkbox"
            checked={!hidden.includes(kind)}
            disabled={busy || !pack.enabled}
            onChange={(e) => run(() => setKindShown(pack, kind, e.target.checked))}
          />
          {countLabel(kind, counts[kind])}
        </label>
      ))}
      {files.length > 0 && <span>{files.map((kind) => countLabel(kind, counts[kind])).join(' · ')}</span>}
      {kinds.length + files.length === 0 && <span>Empty</span>}
    </div>
  );
}

/** Switch of the name duplicate rule with what it hides per kind right now. */
function DuplicatesSwitch({ busy, run }: Pick<RowProps, 'busy' | 'run'>) {
  const hide = useAppStore((s) => s.settings?.packs.hideDuplicates ?? true);
  const listings = useLibraryStore((s) => s.listings);
  const counts = LIBRARY_KINDS.filter((kind) => listings[kind].duplicates.length > 0).map((kind) =>
    countLabel(kind, listings[kind].duplicates.length),
  );
  const summary = counts.length === 0 ? 'no duplicates now' : `${hide ? 'hides' : 'would hide'} ${counts.join(', ')}`;
  return (
    <label className="row">
      <input
        type="checkbox"
        role="switch"
        checked={hide}
        disabled={busy}
        onChange={(e) => run(() => changePackSettings((packs) => ({ ...packs, hideDuplicates: e.target.checked })))}
      />
      <span>
        <strong>Hide duplicates</strong>: when packs hold entries with the same name, show only the one from the pack
        higher up <span className="muted">({summary})</span>
      </span>
    </label>
  );
}

interface RowProps {
  pack: PackInfo;
  index: number;
  busy: boolean;
  run: (task: () => Promise<void>) => void;
  onDragStart: () => void;
  onDrop: () => void;
}

function PackRow({ pack, index, busy, run, onDragStart, onDrop }: RowProps) {
  const mine = pack.origin === 'mine';
  const { manifest } = pack;
  const meta = [manifest.version && `v${manifest.version}`, manifest.author, manifest.license].filter(Boolean);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.altKey && e.key === 'ArrowUp' ? -1 : e.altKey && e.key === 'ArrowDown' ? 1 : 0;
    if (!mine && step !== 0) {
      e.preventDefault();
      // Row 0 is My content, so pack row n sits at order index n - 1.
      run(() => move(pack.source.pack, index - 1 + step));
    }
  };
  return (
    <div
      className={pack.enabled ? 'pack-row' : 'pack-row disabled'}
      draggable={!mine && !busy}
      tabIndex={mine ? undefined : 0}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      title={mine ? undefined : 'Drag or press Alt+Up/Down to change the precedence'}
    >
      <span className="pack-grip">{!mine && <Icon name="grip" size={16} />}</span>
      <Icon name={mine ? 'user' : 'package'} size={22} />
      <div className="pack-main">
        <div className="row">
          <strong>{manifest.name}</strong>
          {pack.origin === 'shipped' && <span className="badge">built in</span>}
          {meta.length > 0 && <span className="muted small">{meta.join(' · ')}</span>}
          {manifest.url && (
            <a className="small" href={manifest.url} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
        </div>
        {manifest.description && <span className="muted small pack-description">{manifest.description}</span>}
        {mine ? (
          <span className="small">{countText(pack.counts)}</span>
        ) : (
          <KindToggles pack={pack} busy={busy} run={run} />
        )}
        <Overridden pack={pack} />
      </div>
      {mine ? (
        <span className="muted small">Always on</span>
      ) : (
        <label className="pack-switch">
          <input
            type="checkbox"
            role="switch"
            checked={pack.enabled}
            disabled={busy}
            onChange={(e) => run(() => setPackEnabled(pack, e.target.checked))}
          />
          {pack.enabled ? 'On' : 'Off'}
        </label>
      )}
      <Button icon="download" label="Export" disabled={busy} onClick={() => run(() => exportToZip(pack))} />
      {pack.origin === 'user' ? (
        <Button
          icon="trash"
          label="Remove"
          iconOnly
          variant="danger"
          disabled={busy}
          onClick={() => run(() => remove(pack))}
        />
      ) : (
        <span className="pack-remove-gap" />
      )}
    </div>
  );
}

/** Compendium tab "Packs": installed content packs in precedence order. */
export function PackLibrary() {
  const reportError = useAppStore((s) => s.reportError);
  const packs = useLibraryStore((s) => s.packs);
  const problems = useLibraryStore((s) => s.packProblems);
  const [dragged, setDragged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (task: () => Promise<void>) => {
    setBusy(true);
    task()
      .catch(reportError)
      .finally(() => setBusy(false));
  };
  return (
    <div className="pack-library">
      <p className="hint-bar" role="note">
        When two packs hold an entry with the same id, the one higher up wins; My content always wins. Disabled packs
        and unticked kinds disappear from the Compendium, the Maps page and the Add dialog. Drag to change the order.
      </p>
      <DuplicatesSwitch busy={busy} run={run} />
      {problems.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--danger)' }}>
          <h3>Pack problems</h3>
          {problems.map((p) => (
            <div key={`${p.area}:${p.path}`} className="muted">
              {p.area}:{p.path} — {p.message}
            </div>
          ))}
        </div>
      )}
      <div className="pack-list" aria-label="Content packs">
        {packs.map((pack, index) => (
          <PackRow
            key={`${pack.source.area}:${pack.source.pack}`}
            pack={pack}
            index={index}
            busy={busy}
            run={run}
            onDragStart={() => setDragged(pack.source.pack)}
            onDrop={() => {
              if (dragged !== null && dragged !== pack.source.pack) {
                run(() => move(dragged, Math.max(0, index - 1)));
              }
              setDragged(null);
            }}
          />
        ))}
      </div>
      {packs.length === 1 && (
        <EmptyState icon="package" title="No packs installed.">
          Import a pack (.zip or folder with pack.json) to add creatures, maps and more.
        </EmptyState>
      )}
    </div>
  );
}
