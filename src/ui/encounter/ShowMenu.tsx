import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandoutKind } from '@/core/handouts';
import { newId } from '@/core/model';
import { importHandout, listHandouts, type HandoutFile } from '@/data/handouts';
import { startInterlude, stopInterlude, useInterludeStore } from '@/sound/interlude';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useHandoutStore } from '@/sync/handoutStore';
import type { PlayerHandout } from '@/sync/protocol';
import { useViewLinksStore } from '@/sync/views';
import { SelectField } from '../components/fields';
import { Button, Icon, Popover, ToolButton, type IconName } from '../kit';

const EVERYONE = '';
const KIND_ICON: Record<HandoutKind, IconName> = { image: 'image', video: 'film', text: 'fileText' };
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm,.md,.txt';

/** Handouts of the campaign: pick one, choose who sees it, show or hide it; videos also play as interludes. */
function ShowPanel({ campaignId }: { campaignId: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const views = useViewLinksStore((s) => s.views);
  const shown = useHandoutStore((s) => s.shown);
  const interlude = useInterludeStore((s) => s.interlude);
  const [files, setFiles] = useState<HandoutFile[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [audience, setAudience] = useState(EVERYONE);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    () => listHandouts(repository.storage, campaignId).then(setFiles),
    [repository, campaignId],
  );
  useEffect(() => {
    refresh().catch(reportError);
  }, [refresh, reportError]);

  const selected = files?.find((f) => f.asset.path === selectedPath) ?? null;
  const audienceName = (id: string) =>
    id === EVERYONE ? 'everyone' : (views.find((v) => v.id === id)?.name ?? 'a view that left');

  const show = async (file: HandoutFile) => {
    const text = file.kind === 'text' ? await repository.storage.readText('data', file.asset.path) : null;
    const handout: PlayerHandout = {
      id: newId(),
      name: file.name,
      kind: file.kind,
      asset: file.kind === 'text' ? null : file.asset,
      text,
    };
    useHandoutStore.setState({ shown: { handout, audience: audience === EVERYONE ? null : audience } });
    notify(`Showing ${file.name} to ${audienceName(audience)}`);
  };

  const add = async (picked: File[]) => {
    const added: HandoutFile[] = [];
    for (const file of picked) {
      added.push(
        await importHandout(repository.storage, campaignId, file.name, new Uint8Array(await file.arrayBuffer())),
      );
    }
    await refresh();
    setSelectedPath(added.at(-1)?.asset.path ?? null);
    notify(added.length === 1 ? `Added ${added[0]!.name}` : `Added ${added.length} handouts`);
  };

  return (
    <div className="show-popover">
      <div className="row">
        <strong>Show to players</strong>
        <div className="spacer" />
        <Button icon="upload" label="Add files" onClick={() => input.current?.click()} />
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]).catch(reportError);
            e.target.value = '';
          }}
        />
      </div>
      {files !== null && files.length === 0 && (
        <p className="muted">
          No handouts yet. Add pictures, videos or text files; they are kept in this campaign&apos;s handouts folder.
        </p>
      )}
      {files !== null && files.length > 0 && (
        <div className="handout-list" role="listbox" aria-label="Handouts">
          {files.map((file) => (
            <button
              key={file.asset.path}
              role="option"
              aria-selected={file === selected}
              className={file === selected ? 'handout-item active' : 'handout-item'}
              onClick={() => setSelectedPath(file.asset.path)}
            >
              <Icon name={KIND_ICON[file.kind]} />
              <span>{file.name}</span>
            </button>
          ))}
        </div>
      )}
      <SelectField
        label="Show to"
        value={audience}
        options={[EVERYONE, ...views.map((v) => v.id)]}
        format={(id) => (id === EVERYONE ? 'Everyone' : (views.find((v) => v.id === id)?.name ?? id))}
        onChange={setAudience}
      />
      <div className="row wrap">
        <Button
          icon="present"
          label="Show"
          variant="primary"
          disabled={selected === null}
          onClick={() => {
            if (selected) show(selected).catch(reportError);
          }}
        />
        {selected?.kind === 'video' && (
          <Button
            icon="film"
            label="Play as interlude"
            title="Fullscreen for every player view"
            onClick={() => {
              startInterlude(selected.asset);
              notify(`Interlude ${selected.name} plays for everyone`);
            }}
          />
        )}
      </div>
      {shown && (
        <div className="row show-status" role="status">
          <span className="grow">
            Showing {shown.handout.name} to {audienceName(shown.audience ?? EVERYONE)}
          </span>
          <Button
            icon="eyeOff"
            label="Hide"
            onClick={() => {
              useHandoutStore.setState({ shown: null });
              notify(`${shown.handout.name} hidden`, 'info');
            }}
          />
        </div>
      )}
      {interlude && (
        <div className="row show-status" role="status">
          <span className="grow">Interlude playing</span>
          <Button icon="close" label="Stop interlude" onClick={stopInterlude} />
        </div>
      )}
    </div>
  );
}

/** Play canvas toolbar entry: handouts and interludes for the players. */
export function ShowMenu() {
  const campaignId = useEncounterStore((s) => s.encounter?.campaignId);
  const showing = useHandoutStore((s) => s.shown !== null);
  return (
    campaignId && (
      <Popover
        label="Show to players"
        trigger={(open, toggle) => <ToolButton icon="present" label="Show" active={open || showing} onClick={toggle} />}
      >
        <ShowPanel campaignId={campaignId} />
      </Popover>
    )
  );
}
