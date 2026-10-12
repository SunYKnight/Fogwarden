import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { create } from 'zustand';
import { damMargin, parseDamProject, type DamProject } from '@/core/import/damProject';
import type { DamObjectChoices } from '@/core/import/damObjects';
import type { ImportedContent, StructureSources } from '@/core/import/importedMap';
import { isUvttFileName, parseUvtt } from '@/core/import/uvtt';
import type { BattleMap, Vec2 } from '@/core/model';
import { calibrateFromSquare, fitSquaresToImage, type GridCalibration } from '@/core/terrain/calibration';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField, NumberField, SliderField, TextField } from '../components/fields';
import { completeOnboardingStep } from '../home/onboarding';
import { Button, Dialog, Icon } from '../kit';
import { openNewEncounter } from './compendiumUi';
import { damPropsFor, loadDamObjectChoices, saveDamObjectChoices } from './daObjects';
import { choicesForProject, DamObjectsPanel } from './DamObjectsPanel';
import { isDamFile, isImageFile, isMapSourceFile, useFileDrop } from './fileDrop';
import {
  cornerGesture,
  createCalibratedMap,
  gridFromFileName,
  guessCalibration,
  mapNameFromFileName,
  roundCalibration,
  type ImageSize,
} from './mapImport';

const MAP_FILE_TYPES = 'image/png,image/jpeg,image/webp,.dd2vtt,.df2vtt,.uvtt';
// Screen pixels a press may move and still count as a click.
const CLICK_SLOP_PX = 4;

interface WizardRequest {
  /** Bumped per open so a reopened wizard starts fresh. */
  session: number;
  open: boolean;
  files: File[];
}

const useWizardStore = create<WizardRequest>(() => ({ session: 0, open: false, files: [] }));

/**
 * Opens the new map wizard, optionally with dropped files: a battlemap image or Universal VTT
 * export, plus a Dungeon Alchemist project (`.dam`) for terrain and objects.
 */
export function openNewMapWizard(files: File[] = []): void {
  useWizardStore.setState((s) => ({ session: s.session + 1, open: true, files }));
}

function closeNewMapWizard(): void {
  useWizardStore.setState({ open: false, files: [] });
}

export function NewMapWizardHost() {
  const { session, open, files } = useWizardStore();
  return open ? <NewMapWizard key={session} initialFiles={files} /> : null;
}

/** What a map maker export brings besides the picture. */
interface ExportInfo {
  fileName: string;
  content: ImportedContent;
  sources: StructureSources;
  project: DamProject | null;
  objects: DamObjectChoices | null;
}

interface Draft {
  /** The picture, decoded from the export for Universal VTT files. */
  file: File;
  url: string;
  image: ImageSize;
  name: string;
  calibration: GridCalibration;
  /** Starting grid: the export's, else guessed from the file name. */
  guess: GridCalibration;
  source: ExportInfo | null;
}

async function imageSize(file: Blob): Promise<ImageSize> {
  const bitmap = await createImageBitmap(file);
  const size = { widthPx: bitmap.width, heightPx: bitmap.height };
  bitmap.close();
  return size;
}

async function readDraft(file: File): Promise<Draft> {
  let draft: Draft;
  if (isUvttFileName(file.name)) {
    const uvtt = parseUvtt(await file.text(), file.name);
    const name = mapNameFromFileName(file.name);
    const { extension } = uvtt.image;
    const picture = new File([uvtt.image.bytes], `${name}.${extension}`, {
      type: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
    });
    const image = await imageSize(picture);
    const source = { fileName: file.name, content: uvtt.content, sources: uvtt.sources, project: null, objects: null };
    const url = URL.createObjectURL(picture);
    draft = { file: picture, url, image, name, calibration: uvtt.calibration, guess: uvtt.calibration, source };
  } else if (isImageFile(file)) {
    const image = await imageSize(file);
    const guess = roundCalibration(guessCalibration(file.name, image));
    const url = URL.createObjectURL(file);
    draft = { file, url, image, name: mapNameFromFileName(file.name), calibration: guess, guess, source: null };
  } else {
    throw new Error(`"${file.name}" is not a PNG, JPEG or WebP image or a Universal VTT export`);
  }
  return draft;
}

/** Attaches a Dungeon Alchemist project to an export draft once it fits the map's squares. */
async function withProject(draft: Draft, file: File): Promise<Draft> {
  if (!draft.source) {
    throw new Error(`"${file.name}" adds terrain to Universal VTT exports; choose the .dd2vtt file first`);
  }
  const project = parseDamProject(await file.text(), file.name);
  damMargin(project, fitSquaresToImage(draft.image, draft.calibration.pxPerSquare));
  const { repository } = useAppStore.getState();
  const kept = project.objects.length > 0 ? await loadDamObjectChoices(repository) : null;
  const objects = kept && choicesForProject(project, kept);
  return { ...draft, source: { ...draft.source, project, objects } };
}

/** Draft from dropped or picked files: the first map file, then a project file if any. */
async function readFiles(files: File[], current: Draft | null): Promise<Draft> {
  const mapFile = files.find(isMapSourceFile);
  const projectFile = files.find(isDamFile);
  if (!mapFile && !projectFile) {
    throw new Error('Choose a battlemap image (PNG, JPEG, WebP) or a .dd2vtt, .df2vtt or .uvtt export');
  }
  const draft = mapFile ? await readDraft(mapFile) : current;
  if (!draft) {
    throw new Error(`Choose the .dd2vtt export before its project "${projectFile!.name}"`);
  }
  return projectFile ? withProject(draft, projectFile) : draft;
}

function exportSummary(content: ImportedContent): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const doors = content.openings.filter((o) => o.kind === 'door').length;
  const rooms = content.rooms.length > 0 ? [count(content.rooms.length, 'room')] : [];
  return [
    ...rooms,
    count(content.walls.length, 'wall'),
    count(doors, 'door'),
    count(content.openings.length - doors, 'window'),
    count(content.lights.length, 'light'),
  ].join(', ');
}

function projectSummary(project: DamProject): string {
  let min = Infinity;
  let max = -Infinity;
  for (const height of project.terrain.data) {
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  const { structure } = project;
  const objects = project.objects.length > 0 ? `, ${project.objects.length} objects` : '';
  const rooms = structure.rooms.length > 0 ? `, ${structure.rooms.length} rooms` : '';
  const upper = structure.otherLevelParts > 0 ? '; upper floors are not imported yet' : '';
  return `ground heights ${min.toFixed(1)} to ${max.toFixed(1)} ft${rooms}${objects}${upper}`;
}

type Step = 'image' | 'project' | 'grid' | 'objects' | 'done';

const STEP_LABELS: Record<Step, string> = {
  image: 'Image',
  project: 'Project',
  grid: 'Grid',
  objects: 'Objects',
  done: 'Done',
};

// Only Dungeon Alchemist writes .dd2vtt, so only it has a matching project.
function hasProjectStep(draft: Draft | null): boolean {
  return draft?.source?.fileName.toLowerCase().endsWith('.dd2vtt') ?? false;
}

function stepsFor(draft: Draft | null): Step[] {
  const project: Step[] = hasProjectStep(draft) ? ['project'] : [];
  const objects: Step[] = draft?.source?.objects ? ['objects'] : [];
  return ['image', ...project, 'grid', ...objects, 'done'];
}

function StepTrail({ steps, step }: { steps: Step[]; step: Step }) {
  const current = steps.indexOf(step);
  return (
    <ol className="wizard-steps">
      {steps.map((s, i) => (
        <li key={s} className={i === current ? 'current' : i < current ? 'done' : ''}>
          <span className="wizard-step-number">{i < current ? <Icon name="check" size={14} /> : i + 1}</span>
          {STEP_LABELS[s]}
        </li>
      ))}
    </ol>
  );
}

function NewMapWizard({ initialFiles }: { initialFiles: File[] }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [step, setStep] = useState<Step>('image');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [created, setCreated] = useState<BattleMap | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialFiles.length > 0) {
      readFiles(initialFiles, null).then(setDraft, reportError);
    }
  }, [initialFiles, reportError]);

  useEffect(() => {
    const url = draft?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [draft?.url]);

  const createMap = async (source: Draft, calibration: GridCalibration) => {
    setBusy(true);
    try {
      const project = source.source?.project ?? null;
      const objects = source.source?.objects ?? null;
      if (project && objects) {
        await saveDamObjectChoices(repository, objects);
      }
      const map = await createCalibratedMap(repository, source.file, {
        name: source.name.trim() || 'New map',
        image: source.image,
        calibration,
        content: source.source?.content,
        sources: source.source?.sources,
        project,
        props: project && objects ? damPropsFor(repository, project, objects) : undefined,
      });
      await useLibraryStore.getState().refresh('map');
      await completeOnboardingStep('mapFromImage');
      useAppStore.getState().notify(`Map "${map.name}" created`);
      setCreated(map);
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  const openInEditor = (map: BattleMap) => {
    closeNewMapWizard();
    useAppStore.getState().navigate({ page: 'map-editor', map: { area: 'data', id: map.id } });
  };

  const startEncounter = (map: BattleMap) => {
    closeNewMapWizard();
    openNewEncounter(null, { area: 'data', id: map.id });
  };

  const createButton = draft && (
    <Button
      label={busy ? 'Creating…' : 'Create map'}
      icon="check"
      variant="primary"
      disabled={busy}
      onClick={() => createMap(draft, draft.calibration).catch(reportError)}
    />
  );
  // Exports carry their grid; the grid step only checks it.
  const exportNext = draft?.source?.objects ? (
    <Button label="Next" icon="chevronRight" variant="primary" onClick={() => setStep('objects')} />
  ) : (
    createButton
  );
  const removeProject = (from: Draft): Draft =>
    from.source ? { ...from, source: { ...from.source, project: null, objects: null } } : from;
  const projectFiles = (files: File[]) => {
    const file = files.find(isDamFile);
    if (!draft || !file) {
      reportError(new Error('Choose a Dungeon Alchemist project file (.dam)'));
    } else {
      withProject(draft, file).then(setDraft, reportError);
    }
  };
  const projectStep = hasProjectStep(draft);
  const backFromLater: Step = projectStep ? 'project' : 'image';
  let body = (
    <ImageStep
      draft={draft}
      onFiles={(files) => readFiles(files, draft).then(setDraft, reportError)}
      onRename={(name) => draft && setDraft({ ...draft, name })}
    />
  );
  let exportActions = (
    <>
      <Button label="Check grid" icon="grid" disabled={busy} onClick={() => setStep('grid')} />
      {exportNext}
    </>
  );
  if (projectStep) {
    exportActions = <Button label="Next" icon="chevronRight" variant="primary" onClick={() => setStep('project')} />;
  }
  let footer = (
    <>
      <Button label="Cancel" onClick={closeNewMapWizard} />
      <div className="spacer" />
      {draft?.source ? (
        exportActions
      ) : (
        <Button label="Next" icon="chevronRight" variant="primary" disabled={!draft} onClick={() => setStep('grid')} />
      )}
    </>
  );
  if (step === 'project' && draft) {
    body = <ProjectStep draft={draft} onFiles={projectFiles} onRemove={() => setDraft(removeProject(draft))} />;
    const hasProject = Boolean(draft.source?.project);
    footer = (
      <>
        <Button label="Back" disabled={busy} onClick={() => setStep('image')} />
        <div className="spacer" />
        <Button label="Check grid" icon="grid" disabled={busy} onClick={() => setStep('grid')} />
        <Button
          label="Skip"
          disabled={busy}
          title="Creates the map without terrain and objects"
          onClick={() => {
            const plain = removeProject(draft);
            setDraft(plain);
            createMap(plain, plain.calibration).catch(reportError);
          }}
        />
        <Button
          label={busy ? 'Creating…' : 'Continue'}
          icon="chevronRight"
          variant="primary"
          disabled={busy || !hasProject}
          onClick={() =>
            draft.source?.objects ? setStep('objects') : createMap(draft, draft.calibration).catch(reportError)
          }
        />
      </>
    );
  }
  if (step === 'grid' && draft) {
    body = (
      <GridStep
        draft={draft}
        onChange={(calibration) => setDraft({ ...draft, calibration })}
        onReset={() => setDraft({ ...draft, calibration: draft.guess })}
      />
    );
    footer = (
      <>
        <Button label="Back" disabled={busy} onClick={() => setStep(backFromLater)} />
        <div className="spacer" />
        {draft.source ? (
          exportNext
        ) : (
          <>
            <Button
              label="Skip, keep the guess"
              disabled={busy}
              title="Creates the map with the grid guessed from the file name; correct it later in the editor"
              onClick={() => createMap(draft, draft.guess).catch(reportError)}
            />
            {createButton}
          </>
        )}
      </>
    );
  }
  if (step === 'objects' && draft?.source?.project && draft.source.objects) {
    const source = draft.source;
    body = (
      <DamObjectsPanel
        project={draft.source.project}
        choices={draft.source.objects}
        preview={{ url: draft.url, image: draft.image, calibration: draft.calibration }}
        onChange={(objects) => setDraft({ ...draft, source: { ...source, objects } })}
      />
    );
    footer = (
      <>
        <Button label="Back" disabled={busy} onClick={() => setStep(backFromLater)} />
        <div className="spacer" />
        {createButton}
      </>
    );
  }
  if (step === 'done' && created) {
    const placed = created.props.length > 0 ? `, ${created.props.length} objects` : '';
    const stored = created.image;
    const reduced =
      draft && stored && (stored.widthPx !== draft.image.widthPx || stored.heightPx !== draft.image.heightPx);
    body = (
      <div className="wizard-done">
        <Icon name="check" size={32} />
        <div>
          <p>
            <strong>{created.name}</strong> is ready: {created.grid.squaresX} × {created.grid.squaresY} squares with a
            calibrated grid.{' '}
            {draft?.source
              ? `Imported ${exportSummary(created)}${draft.source.project ? `, terrain${placed}` : ''}.`
              : 'Walls, doors and terrain are added in the editor.'}
          </p>
          {reduced && (
            <p className="muted">
              Reduced from {draft.image.widthPx} × {draft.image.heightPx} to {stored.widthPx} × {stored.heightPx} px;
              the 3D view never shows more. Your original file is unchanged.
            </p>
          )}
        </div>
      </div>
    );
    footer = (
      <>
        <Button label="Close" onClick={closeNewMapWizard} />
        <div className="spacer" />
        <Button label="Use in a new encounter" icon="swords" onClick={() => startEncounter(created)} />
        <Button label="Open in editor" icon="edit" variant="primary" onClick={() => openInEditor(created)} />
      </>
    );
  }

  const wide = step === 'grid' || step === 'objects';
  return (
    <Dialog title="New map" onClose={closeNewMapWizard} width={wide ? 1100 : 560} footer={footer}>
      <StepTrail steps={stepsFor(draft)} step={step} />
      {body}
    </Dialog>
  );
}

interface ImageStepProps {
  draft: Draft | null;
  onFiles: (files: File[]) => void;
  onRename: (name: string) => void;
}

function ImageStep({ draft, onFiles, onRename }: ImageStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const { dragging, handlers } = useFileDrop(onFiles);
  const fromName = draft && gridFromFileName(draft.file.name);
  const source = draft?.source ?? null;
  let details = null;
  if (draft && source) {
    details = (
      <p className="muted">
        {source.fileName}: {draft.image.widthPx} × {draft.image.heightPx} px at {draft.calibration.pxPerSquare} px per
        square · {exportSummary(source.content)}
      </p>
    );
  } else if (draft) {
    details = (
      <p className="muted">
        {draft.image.widthPx} × {draft.image.heightPx} px ·{' '}
        {fromName
          ? `the file name says ${fromName.squaresX} × ${fromName.squaresY} squares`
          : 'no grid size in the file name; you place the grid in the next step'}
      </p>
    );
  }
  return (
    <div className="col">
      <div className={dragging ? 'drop-zone dragging' : 'drop-zone'} {...handlers}>
        {draft ? (
          <img className="wizard-preview" src={draft.url} alt={draft.name} />
        ) : (
          <>
            <Icon name="image" size={32} />
            <span>Drop a battlemap image or a Universal VTT export (.dd2vtt, .df2vtt, .uvtt) here</span>
          </>
        )}
        <Button
          icon="upload"
          label={draft ? 'Choose another file' : 'Choose file'}
          variant={draft ? 'default' : 'primary'}
          onClick={() => input.current?.click()}
        />
        <input
          ref={input}
          type="file"
          accept={`${MAP_FILE_TYPES},.dam`}
          multiple
          hidden
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      {draft && (
        <>
          <TextField label="Name" value={draft.name} onChange={onRename} />
          {details}
        </>
      )}
    </div>
  );
}

interface ProjectStepProps {
  draft: Draft;
  onFiles: (files: File[]) => void;
  onRemove: () => void;
}

function ProjectStep({ draft, onFiles, onRemove }: ProjectStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const { dragging, handlers } = useFileDrop(onFiles);
  const project = draft.source?.project ?? null;
  return (
    <div className="col">
      <h3>Dungeon Alchemist project (optional)</h3>
      <p className="muted">
        The .dd2vtt export holds the picture, walls and lights but no 3D objects or terrain. The matching .dam project
        file adds ground heights, buildings (rooms, wall heights, doors and windows) and object positions.
      </p>
      <div className={dragging ? 'drop-zone dragging' : 'drop-zone'} {...handlers}>
        {project ? (
          <div className="row">
            <Icon name="check" size={20} />
            <span>
              {project.fileName}: {projectSummary(project)}
            </span>
            <Button label="Remove" icon="close" onClick={onRemove} />
          </div>
        ) : (
          <>
            <Icon name="upload" size={32} />
            <span>Drop the .dam file here</span>
            <Button label="Choose .dam file" icon="upload" onClick={() => input.current?.click()} />
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".dam"
          hidden
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/** Lines through every grid corner within `span` squares of the origin, in grid units. */
function gridPath(span: number): string {
  return Array.from({ length: 2 * span + 1 }, (_, k) => {
    const i = k - span;
    return `M${i} ${-span}V${span}M${-span} ${i}H${span}`;
  }).join('');
}

interface GridStepProps {
  draft: Draft;
  onChange: (calibration: GridCalibration) => void;
  onReset: () => void;
}

function GridStep({ draft, onChange, onReset }: GridStepProps) {
  const [actualSize, setActualSize] = useState(false);
  const [detectRotation, setDetectRotation] = useState(false);
  const [pending, setPending] = useState<Vec2 | null>(null);
  const [drag, setDrag] = useState<{ down: Vec2; current: Vec2 } | null>(null);
  const { image, calibration } = draft;
  const { pxPerSquare, rotationDeg, offsetPx } = calibration;
  const squares = fitSquaresToImage(image, pxPerSquare);
  const span = Math.ceil(Math.hypot(image.widthPx, image.heightPx) / pxPerSquare) + 1;
  const lines = useMemo(() => gridPath(span), [span]);
  const marker = Math.max(image.widthPx, image.heightPx) / 160;

  const toImage = (e: PointerEvent<SVGSVGElement>): Vec2 => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = image.widthPx / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };
  const update = (change: Partial<GridCalibration>) => onChange(roundCalibration({ ...calibration, ...change }));

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button === 0) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const point = toImage(e);
      setDrag({ down: point, current: point });
    }
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag) setDrag({ ...drag, current: toImage(e) });
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (drag) {
      // The overlay's viewBox is the image: screen px to image px.
      const slop = (CLICK_SLOP_PX * image.widthPx) / e.currentTarget.getBoundingClientRect().width;
      const gesture = cornerGesture(pending, drag.down, toImage(e), slop);
      setPending(gesture.pending);
      setDrag(null);
      if (gesture.square) {
        const [a, b] = gesture.square;
        onChange(roundCalibration(calibrateFromSquare(a, b, detectRotation ? null : rotationDeg)));
      }
    }
  };

  return (
    <div className="wizard-grid">
      <div className={actualSize ? 'wizard-canvas actual' : 'wizard-canvas'}>
        <div className="wizard-stage">
          <img src={draft.url} alt={draft.name} draggable={false} />
          <svg
            viewBox={`0 0 ${image.widthPx} ${image.heightPx}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            <g transform={`translate(${offsetPx.x} ${offsetPx.y}) rotate(${rotationDeg}) scale(${pxPerSquare})`}>
              <path d={lines} className="wizard-grid-lines" vectorEffect="non-scaling-stroke" />
              <rect
                width={squares.squaresX}
                height={squares.squaresY}
                className="wizard-grid-extent"
                vectorEffect="non-scaling-stroke"
              />
            </g>
            {drag && (
              <rect
                x={Math.min(drag.down.x, drag.current.x)}
                y={Math.min(drag.down.y, drag.current.y)}
                width={Math.abs(drag.current.x - drag.down.x)}
                height={Math.abs(drag.current.y - drag.down.y)}
                className="wizard-drag"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {pending && <circle cx={pending.x} cy={pending.y} r={marker} className="wizard-corner" />}
          </svg>
        </div>
      </div>
      <div className="wizard-controls col">
        <p className="muted">
          {pending
            ? 'Now click the opposite corner of the same square.'
            : 'Drag across one grid square of the image, or click two opposite corners of a square.'}
        </p>
        <NumberField
          label="Squares across"
          value={squares.squaresX}
          min={1}
          max={1000}
          step={1}
          onChange={(n) => update({ pxPerSquare: image.widthPx / Math.round(n) })}
        />
        <SliderField
          label="Square size"
          value={pxPerSquare}
          min={10}
          max={Math.max(300, Math.ceil(pxPerSquare * 1.5))}
          step={0.5}
          suffix=" px"
          onChange={(v) => update({ pxPerSquare: v })}
        />
        <SliderField
          label="Offset X"
          value={offsetPx.x}
          min={-Math.ceil(pxPerSquare)}
          max={Math.ceil(pxPerSquare)}
          step={0.5}
          suffix=" px"
          onChange={(x) => update({ offsetPx: { ...offsetPx, x } })}
        />
        <SliderField
          label="Offset Y"
          value={offsetPx.y}
          min={-Math.ceil(pxPerSquare)}
          max={Math.ceil(pxPerSquare)}
          step={0.5}
          suffix=" px"
          onChange={(y) => update({ offsetPx: { ...offsetPx, y } })}
        />
        <SliderField
          label="Rotation"
          value={rotationDeg}
          min={-45}
          max={45}
          step={0.1}
          suffix="°"
          onChange={(v) => update({ rotationDeg: v })}
        />
        <CheckboxField label="Detect rotation" value={detectRotation} onChange={setDetectRotation} />
        <p>
          <strong>
            {squares.squaresX} × {squares.squaresY} squares
          </strong>{' '}
          <span className="muted">
            ({squares.squaresX * 5} × {squares.squaresY * 5} ft)
          </span>
        </p>
        <div className="row wrap">
          <Button
            icon="search"
            label={actualSize ? 'Fit to window' : 'Actual size'}
            onClick={() => setActualSize(!actualSize)}
          />
          <Button icon="undo" label="Reset guess" onClick={onReset} />
        </div>
        <div className="wizard-checklist">
          <strong>Looks right?</strong>
          <ul>
            <li>
              <Icon name="check" size={14} /> Grid lines run along walls and floor tiles
            </li>
            <li>
              <Icon name="check" size={14} /> Squares still line up at the far edges (use Actual size)
            </li>
            <li>
              <Icon name="check" size={14} /> The outlined area covers the whole map
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
