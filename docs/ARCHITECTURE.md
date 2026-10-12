# Architecture

Companion to `PLAN.md` (goals, milestones). This file describes how the code is organised and the contracts
between modules.

## Units and coordinates

- All lengths are **feet**. One grid square = `map.grid.feetPerSquare` (5).
- Map plane points (`Vec2`): `x` east, `y` south, origin at the map's north-west corner.
- Three.js world: X east, **Y up**, Z south. `Vec2 {x, y}` at height `h` is world `(x, h, y)`.
- `MapPoint` = `{x, y, elevationFt}`; `elevationFt` is absolute (not above terrain).
- Terrain heights are absolute feet in a `HeightField` (`src/core/terrain/heightfield.ts`), sampled every
  `feetPerSquare / samplesPerSquare` feet, row-major (rows = south, columns = east).

## Layers of the code

| Folder        | Rule                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/core`    | Pure TypeScript. No DOM, React or three.js imports. Schemas, rules, geometry, parsers. Unit-tested in node. |
| `src/data`    | Storage abstraction + `Repository` (load/save/list documents, migrations).                                  |
| `src/state`   | Zustand stores: `appStore`, `editorStore`, `encounterStore`, `libraryStore`, `autosave`.                    |
| `src/render`  | three.js / react-three-fiber. `MapView` + layers. May import core and state.                                |
| `src/editor`  | Map editor tools (`EditorTool`), selection panels.                                                          |
| `src/sync`    | DM → player protocol and transports.                                                                        |
| `src/ui`      | React pages and components.                                                                                 |
| `src/workers` | Web workers (visibility).                                                                                   |
| `src-tauri`   | Rust shell: storage commands, later LAN server.                                                             |
| `tools`       | Node CLI scripts (run with `pnpm tsx tools/<script>.ts`).                                                   |
| `content`     | Shipped, read-only content (SRD only).                                                                      |

## Documents and storage

- Schemas: `src/core/model/*` (zod). Every document has `{schema, version, id, name, createdAt, updatedAt}`.
  Bumping a schema version requires one migration step in `src/data/migrations.ts`.
- Factories: `src/core/model/factories.ts` (`createMap`, `createCreature`, `createEncounter`, ...).
- `Repository` (`src/data/repository.ts`): `list(kind)`, `load(kind, ref)`, `save(kind, doc)` (always data area),
  `remove`, `duplicateMap`, `importMapAsset`, campaigns/encounters, settings. Content documents with the same id as a
  user document are shadowed by it.
- `Storage` (`src/data/storage.ts`): area `'data'` (user data root) or `'content'` (shipped). Implementations:
  `TauriStorage` (desktop), `BrowserStorage` (IndexedDB, dev in a browser), `MemoryStorage` (tests),
  `NodeStorage` (`tools/nodeStorage.ts`, CLI tools; same path rules and atomic writes as the Rust side).
- Data root layout: `library/{creatures,markers}/<id>.json`, `library/creatures/assets/` (creature images),
  `library/maps/<id>/{map.json,assets/}`, `campaigns/<id>/{campaign.json,encounters/<id>.json}`, `settings.json`.
- Assets are `AssetRef {area, path}`; display them with `repository.storage.assetUrl(ref)` or `<AssetImage>`.

## Rules and imports

- `src/core/rules`: `dice.ts` (`parseDice`, `rollDice` with seeded rng and advantage, `averageDice`),
  `abilities.ts` (modifiers, proficiency/XP by CR, `formatCr`), `distance.ts` (`gridDistanceFt`, 5-5-5 / 5-10-5),
  `templates.ts` (`areaCells`: squares at least half covered; `areaOutline`; 0° = east, 90° = south).
- `src/core/import/statblock.ts`: `parseStatBlock(text, meta)` reads stat blocks in the legacy raw file layout and
  throws `StatBlockError` naming the failing line. `legacy.ts` converts the WPF app's JSON (creatures, tile maps,
  markers). Imported documents get readable stable ids (`slugId`), so re-imports overwrite.
- CLI (`pnpm tsx tools/<script>.ts`, default data root = the desktop app's, override with `--data-root`):
  `import-statblocks.ts <folder> [--source <name>]`, `import-legacy.ts <240722_DnD_DMTool_Data folder>`,
  `build-srd.ts [--input <5e-SRD-Monsters.json>]` regenerates `content/creatures` and `content/markers`
  (SRD 5.1, attribution in `content/LICENSE-SRD.md`).

## Map rendering

- `MapView` (`src/render/MapView.tsx`) owns the `<Canvas>`, camera rig, base lights, terrain and pointer events.
  Extra content is passed as children. Every view (editor, DM encounter, player) renders
  `SCENE_LAYERS` (`src/render/layers.ts`) as children; a layer reads `useMapRender()`:
  `{ map, terrain, terrainVersion, uniforms, mode }` and decides from `mode` (`'editor' | 'dm' | 'player'`)
  what to draw. Register a layer by appending `{ id, Component }` to `SCENE_LAYERS`.
- Projected material: `createProjectedMaterial(uniforms, { side, sideFromSlopeDeg, sideTint })`
  (`src/render/materials/projectedMaterial.ts`). Every surface that should show the battlemap from above uses it with
  the shared `uniforms` from the render context, so calibration, grid and fog changes apply everywhere.
  Faces steeper than `sideFromSlopeDeg` show the tileable side material instead (`SideMaterial`).
- Fog: `uniforms.uFog` is a `DataTexture` (R8) covering the whole map (`uMapSizeFt`), row-major from the north-west
  corner, values `FOG_UNKNOWN`/`FOG_EXPLORED`/`FOG_VISIBLE` (`src/core/vision/fog.ts`). `FogLayer` writes it (player:
  received fog; DM: the computed player fog). `setFogMode(uniforms, 'off' | 'dm' | 'player')`.
- Hit testing: set `userData.hit: HitTag` (`{kind, id}`) on an object; `MapView` reports the nearest tagged ancestor
  in `MapPointerEvent.hit`. Pointer events carry the world point as `MapPoint`.
- Terrain meshes use three-mesh-bvh accelerated raycasting (patched in `src/render/terrain/terrainGeometry.ts`).
- Camera: `CameraRig` with `'top'` (orthographic, north up) and `'perspective'`; left mouse belongs to tools/tokens,
  right pans, middle rotates, wheel zooms. `CameraState` is serialisable for the player view.
- Structures (`src/render/structures/`, `src/render/props/`): `StructureLayer` (mitered wall prisms, openings cut out
  and filled by door/pane/bars; players see shut secret doors as wall), `RoomLayer` (floors, roofs peeled per room in
  play views while the camera or a token is inside), `RegionLayer` (draped polygons; players only see non-hidden
  hazard/note regions, discarded in unknown fog), `LightLayer` (point lights, first 8 cast shadows, carried lights
  follow their combatant; editor gizmos), `PropLayer` (glTF/GLB via `useModel`, optional battlemap projection).
  Editor `layers` toggles apply in mode `'editor'` only (`useLayerVisible`). Live door states: `useOpeningStates()`
  (`src/render/useOpeningStates.ts`). `MapLight.dimFt` is dim light beyond the bright radius (5e torch 20/20).
- Labels in the scene: `TextLabel` (`src/render/TextLabel.tsx`), a screen-sized canvas-texture sprite. drei `<Html>`
  is not used: its DOM roots throw on unmount under React 19 and would not appear in the rendered player image.
- Images: `loadImageTexture(url, sizePx)` (`src/render/loadImageTexture.ts`) decodes off the main thread and scales
  battlemaps above `MAX_TEXTURE_PX` (4096) down while decoding; huge exports otherwise freeze the UI for seconds.

## Shared geometry

- `wallSegments(map, terrain, { openingStates, secretAsWall })` (`src/core/geometry/walls.ts`): every wall piece with
  its blocking flags and bottom/top heights; openings split their segment. Used by structure rendering, vision and
  movement. Also `pointInPolygon`, `segmentIntersection`, `wallSegmentEnds`, `lerp2`, `distance2`.
- `wallPieces(map)` splits segments at openings (segment index + `t0..t1`); `wallCorners`/`wallSection`/`wallOutline`
  (`wallOutline.ts`) give mitered face points (ends meeting exactly one other wall end join like one polyline);
  `snapPoint` (`snapping.ts`: wall vertex > grid corner > square-edge midpoint); `nearestWallSegment`, `closedWallAt`,
  `splitWallAtVertex` (`wallEdit.ts`); `signedPolygonArea`, `polygonWinding`, `closestPointOnSegment` (`polygon.ts`).

## Map editor

- `useEditorStore` holds the open map, the live `HeightField` and history. Every change goes through
  `edit(label, recipe)` (immer patches, undoable), `replaceTerrain(label, field, recipe?)` (resize/resample), or a
  sculpt stroke `beginTerrainStroke()` → mutate `terrain.data` + `terrainChanged()` → `endTerrainStroke(label)`.
  Autosave writes `snapshot()` about 800 ms after the last change.
- Sculpt brushes are pure functions in `src/core/terrain/brushes.ts` returning the touched `SampleRect`. Before each
  `terrainChanged()` of a stroke call `markTerrainDirty(field, rect)` (`src/render/terrain/terrainDirty.ts`); the
  terrain mesh then rewrites only that region (positions, normals, BVH nodes). Unmarked version bumps (undo, load)
  rebuild the whole mesh. Grid size/resolution changes go through `resampleHeightField` (`src/core/terrain/resample.ts`).
- Tools receive pointer down/up only for the left button; right and middle belong to the camera.
- Tools implement `EditorTool` (`src/editor/tool.ts`) and are listed in `TERRAIN_TOOLS`
  (`src/editor/tools/terrain/index.ts`) or `STRUCTURE_TOOLS` (`src/editor/tools/structure/index.ts`).
  `Overlay` renders inside the canvas (cursor, previews), `Panel` in the side panel.
- Selection panels: `SELECTION_PANELS[kind]` (`src/editor/selectionPanels.ts`), rendered for `editorStore.selection`.
- Structure tools draw with `src/editor/tools/structure/drafting.tsx` (click points, double-click/Enter/first point
  finishes, Esc cancels, panel buttons as mouse-free alternatives). The select tool drags vertices of the selected
  wall/room/region (`selectionEditing.tsx`, one undo step per drop); the prop tool's TransformControls write back on
  release.

## Encounters and player view

- `useEncounterStore`: open encounter + its map + terrain; `update(recipe)` (immer); autosaved.
  Door states during play live in `encounter.openingStates`, never in the map.
- Encounter rules (`src/state/encounterActions.ts`): pure helpers used inside `update` recipes — damage/healing/temp
  HP, `spawnCombatant` (average or rolled HP, unique numbered names), initiative order (ties by Dex), turns and rounds,
  log entries, `rollAttack` (critical hits double the dice).
- Encounter page (`src/ui/encounter/EncounterPage.tsx`, route `encounter`): tracker, combatant panel, dice, log,
  marker panel and `ENCOUNTER_PANELS`; map interaction (token select/drag/place, ruler, marker placement, door
  toggling with Shift+click to lock) goes through `handleEncounterPointer` with transient state in `useEncounterUi`.
- `TokenLayer` / `MarkerLayer` (`src/render/tokens`, `src/render/markers`): read `useEncounterStore` in `dm` mode and
  `usePlayerStore` in `player` mode. Tokens snap to whole squares by 5e size (`snapTokenPoint`).
- Sync (`src/sync/protocol.ts`): the DM sends `map` (filtered for players), `encounter` (`PlayerEncounter`), `fog`
  (`PlayerFog`) and `camera`; the player sends `hello` to request a resend. Filtering happens on the DM side; the
  player never receives hidden combatants, secret doors, hidden regions or notes.
  Transports: `TauriEventTransport`, `BroadcastChannelTransport` (`createLocalTransport(role)`), `WebSocketTransport`
  (`src/sync/wsTransport.ts`, LAN; reconnects with backoff, announces every connect with `hello`).
- Player window: `player.html` → `PlayerApp` with `usePlayerStore` built only from received messages.
- Vision (`src/core/vision/`): `computeVisibility(map, terrain, {openingStates, combatants, cellsPerSquare})` returns
  the cells the vision sources see now (rays vs wall spans with heights and terrain via `RayGrid` buckets; light
  regions replace the ambient level, magical darkness wins, lights add bright/dim with shadows; darkvision,
  truesight, blindsight, tremorsense by range). `fog.ts` holds explored accumulation, DM overrides, brush painting.
- DM side, started in `DmApp`: `startFogTracker()` (`src/sync/fogTracker.ts`) runs visibility in
  `src/workers/visibility.worker.ts` (latest request wins), merges explored cells and DM overrides into
  `useFogViewStore.fog` and persists `encounter.fog.explored` at most once per second. `startDmPublisher(transports)`
  sends `playerFilter` output on change and a full resend on start and on `hello`. The encounter page feeds
  `useDmCameraStore` (camera push), `useFogViewStore.showFogToDm` (fog mode) and `fogBrushPointer` (reveal/hide brush).

## LAN player view

- `src-tauri/src/lan.rs`: axum server on `0.0.0.0:<settings.lan.port>`, commands `lan_start(port)`, `lan_stop()`,
  `lan_status()` → `LanInfo {port, urls, token, dmUrl, players}`; Tauri event `lan-players` carries the player count.
  Each start generates a player token (in the player URLs) and a DM token (in `dmUrl`, accepted from loopback only).
- Routes: `/player.html?token=` (sets an `/asset`-scoped token cookie so relative `.gltf` resources load),
  `/assets/*` (Vite bundle, public), `/asset/{area}/{path}?token=` (images and models only, path stays inside the
  storage root via `storage::resolve`; documents are never served), `/ws?token=` (relay). The relay forwards DM
  messages to all players and only a rebuilt `hello` from players; any other player message closes its socket.
- Bundle files come from `app.asset_resolver()`: release builds embed `dist/`; dev builds (devUrl set) read `dist/`
  from disk, so run `pnpm build` before testing the LAN view under `pnpm app:dev`. For player-code work, open
  `http://localhost:1420/player.html?token=<t>&ws=ws://127.0.0.1:<port>/ws` on the Vite dev server instead.
- DM side: `useLanStore` (`src/state/lanStore.ts`) holds the DM's `WebSocketTransport`; `DmApp` adds it to
  `startDmPublisher`. UI: `LanPanel` in `ENCOUNTER_PANELS` (start/stop, URLs, token, QR code via `uqr`).
- Browser client: `player.html?token=` → `src/app/player.tsx` sets `useAppStore`'s repository to a read-only
  `LanStorage` (`src/data/lanStorage.ts`, `assetUrl` → `/asset/...`) before rendering `PlayerApp`.

## UI registries

- Library tabs: `LIBRARY_TABS` (`src/ui/library/LibraryPage.tsx`).
- Routes: `Route` union in `src/state/appStore.ts` + `Page` switch in `src/ui/DmApp.tsx`.
- Form fields: `src/ui/components/fields.tsx` (`NumberField`, `TextField`, `SelectField`, `CheckboxField`,
  `SliderField`, `ColorField`, `Field`); errors: `useAppStore.getState().reportError(error)`.

## Conventions

See `~/.omp/agent/RULES.md` and `PLAN.md` §11. In short: one `return` per function (error `throw`s allowed), no
`continue`, `break` only in `switch`, lines ≤ 120, `//` comments ≤ 80 columns and explain _why_, no swallowed errors,
no stubs/TODOs. Format with `pnpm format`; check with `pnpm typecheck`, `pnpm lint`, `pnpm test`.
