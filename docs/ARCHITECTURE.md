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
| `content`     | Shipped, read-only content (SRD and the generated sample map).                                              |

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
- Data root layout: `library/{creatures,markers}/<id>.json`, `library/creatures/assets/` (creature images,
  `creatureAssetRef`), `library/portraits.json` (portrait index), `library/maps/<id>/{map.json,assets/}`,
  `campaigns/<id>/{campaign.json,encounters/<id>.json}`, `settings.json`.
- Portrait index (`src/core/model/portraits.ts`, `repository.loadPortraits`/`savePortraits`, held in
  `useLibraryStore.portraits`): creature id → `{image, token}` for creatures whose document stays untouched (shipped
  ones). Token picture precedence `resolveTokenAsset`: combatant token > creature token > creature image > index
  (token, then image); `creaturePortrait` (compendium) prefers images. `combatantToken`/`useCombatantToken`
  (`libraryStore.ts`) resolve live, so new portraits reach running encounters. Desktop-only file access outside the
  roots: `listFolder(path)`, `importFile(path, to)` (`tauriStorage.ts`, Rust `storage_list_folder`/`_import_file`).
- Assets are `AssetRef {area, path}`; display them with `repository.storage.assetUrl(ref)` or `<AssetImage>`.

## Rules and imports

- `src/core/rules`: `dice.ts` (`parseDice`, `rollDice` with seeded rng and advantage, `averageDice`),
  `abilities.ts` (modifiers, proficiency/XP by CR, `formatCr`), `distance.ts` (`gridDistanceFt`, 5-5-5 / 5-10-5),
  `templates.ts` (`areaCells`: squares at least half covered; `areaOutline`; 0° = east, 90° = south).
- `src/core/import/statblock.ts`: `parseStatBlock(text, meta)` reads stat blocks in the legacy raw file layout and
  throws `StatBlockError` naming the failing line. `legacy.ts` converts the WPF app's JSON (creatures, tile maps,
  markers). Imported documents get readable stable ids (`slugId`), so re-imports overwrite.
- `src/core/import/portraitMatch.ts`: `matchPortraits(fileNames, creatures)` pairs picture files with creatures by
  `portraitKey` (slug without extension and `source--` prefixes): id beats name beats family name ("Werewolf, Human
  Form" → "werewolf"); a file fits all creatures sharing the key, the first sorted file wins per creature.
  UI: `AttachPortraitsDialog` (Compendium header) previews, then copies into `library/creatures/assets/`.
- CLI (`pnpm tsx tools/<script>.ts`, default data root = the desktop app's, override with `--data-root`):
  `import-statblocks.ts <folder> [--source <name>]`, `import-legacy.ts <240722_DnD_DMTool_Data folder>`,
  `build-srd.ts [--input <5e-SRD-Monsters.json>]` regenerates `content/creatures` and `content/markers`
  (SRD 5.1, attribution in `content/LICENSE-SRD.md`), `build-sample.ts` regenerates the sample map
  `content/maps/sample-chapel` (procedural drawing, own PNG encoder `tools/png.ts`, `content/LICENSE-SAMPLE.md`).

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
- Tools implement `EditorTool` (`src/editor/tool.ts`: kit `icon`, `step` tab, `shortcut` letter, `hint`, `cursor`) and
  are listed in `TERRAIN_TOOLS` (`src/editor/tools/terrain/index.ts`) or `STRUCTURE_TOOLS`
  (`src/editor/tools/structure/index.ts`); `TOOLS` adds select and calibration, which belong to no step.
  `Overlay` renders inside the canvas (cursor, previews), `Panel` inline in the tool bar (compact fields).
- Page (`src/ui/editor/MapEditorPage.tsx`): header (undo/redo, map settings, Top/3D, player look), step tabs
  (`editorStore.step`), tool bar, canvas, inspector (selection panel, else step help + layers), status bar
  (hint, cursor x/y/height, snapping, save state). Map-wide settings live in `MapSettingsDialog`; its grid section
  (`GridFields` in `calibrate.tsx`) starts the calibrate tool with `startGridPick()` and reopens after the pick.
- Keys go through `useShortcuts('Map editor', …)`: Ctrl+Z/Y, 1-4 steps, tool letters, T camera, Del/Backspace
  delete the selection (`deleteSelection`), Esc deselects then returns to Select. Tools register higher-priority
  keys only while they have something to cancel (`useDraftKeys`, grid pick, pending prop).
- Selection panels: `SELECTION_PANELS[kind]` (`src/editor/selectionPanels.ts`), rendered for `editorStore.selection`.
  The select tool sets `editorStore.hover` (what a click would select); `SelectionOverlay` outlines it.
- Structure tools draw with `src/editor/tools/structure/drafting.tsx` (click points, double-click/Enter/first point
  finishes, Esc cancels, tool bar buttons as mouse-free alternatives). The select tool drags vertices of the selected
  wall/room/region (`selectionEditing.tsx`, one undo step per drop); the prop tool's TransformControls write back on
  release. `ModelDropTarget` imports `.glb`/`.gltf` files dropped on the canvas and places them at the drop point.

## Encounters and player view

- `useEncounterStore`: open encounter + its map + terrain; `update(recipe, label?)` (immer); autosaved.
  Door states during play live in `encounter.openingStates`, never in the map. Every update that changes more than
  `log` and `fog` becomes one labelled undo step (`undo()`/`redo()` return the label; bounded `History`); log and
  fog patches are left out of the steps, so undo never erases log lines or re-fogs explored ground, and fog
  tracking, fog brush strokes and dice rolls don't flood the history.
- Encounter rules (`src/state/encounterActions.ts`): pure helpers used inside `update` recipes — damage/healing/temp
  HP, `spawnCombatant` (average or rolled HP, unique numbered names), initiative order (ties by Dex), turns and rounds,
  log entries, `rollAttack` (critical hits double the dice).
- Play page (`src/ui/encounter/EncounterPage.tsx`, shown by `PlayPage` for `settings.lastEncounter`): header with
  breadcrumb, round and undo/redo; `InitiativeStrip` (turn order, inline initiative, drag to reorder, "+ Add" →
  `AddCombatantsDialog`); `PlayViewport` (map, canvas toolbar with Select/Measure/Area/camera/Fog menu, "n not on
  map" chip that places unplaced combatants one after another, right click without drag → `openCombatantMenu`);
  `TurnBar` (attacks of the current combatant, quick damage/heal for the selection, turn buttons); `Inspector` tabs
  Creature/Dice/Log/Areas. Commands shared by these (HP, conditions, turns, initiative, removal) are in
  `combatantCommands.ts`; keys are registered with `useShortcuts('Play', …)`. Map interaction (token
  select/drag/place, ruler, marker placement, door toggling with Shift+click to lock) goes through
  `handleEncounterPointer` with transient state in `useEncounterUi`.
- `TokenLayer` / `MarkerLayer` (`src/render/tokens`, `src/render/markers`): read `useEncounterStore` in `dm` mode and
  `usePlayerStore` in `player` mode. Tokens snap to whole squares by 5e size (`snapTokenPoint`).
- `TokenView`: disc with the picture in the top view; in the perspective camera a standee (side-colored base, card
  in a side/current/selected frame, height from `TOKEN_DIAMETER_FT` and the picture aspect, `standee.ts` crop math)
  turned around Y each frame with a module-level scratch vector. Card meshes report hits at the token base
  (`raycastToBase`) and DM tokens ignore the pointer while a token is dragged or placed. `settings.tokenStandees`
  (DM) and `PlayerEncounter.standees` (players) choose standees. Geometry and materials are shared
  (`tokenMaterials.ts`; per-texture materials die with the texture); `useAssetTexture` reference-counts one texture
  per asset, decoded at most 1024 px.
- Sync (`src/sync/protocol.ts`, protocol 2): the DM sends `map` (filtered for players), `encounter`
  (`PlayerEncounter`), `fog` (`PlayerFog`), `camera` and `view` (the view's name, shown in the player page's status
  corner); the player sends `hello` to request a resend. Filtering happens on the DM side; the player never receives
  hidden combatants, secret doors, hidden regions or notes. Combatant tokens are sent resolved
  (`filterEncounterForPlayers(..., { showTurnOrder, standees, tokenOf })`).
- Player views (`src/sync/views.ts`): `PARTY_VIEW` (`'party'`, all vision sources) or one player character's
  combatant id (only that character's vision). `playerViews(encounter)` lists Party plus the encounter's player
  characters; `useViewLinksStore` keeps them (also while no encounter is open, so leaving Play withdraws no link)
  with one link token each. `startViewLinks()` (in `DmApp`) derives the tokens: `linkToken(secret, view, rotation)`
  is HMAC-SHA256 under `settings.playerLinks.secret` (created on first start), truncated to 128 bits; `rotateLink`
  bumps `settings.playerLinks.rotations[view]`. The servers only get the token → view table (`linkTable`), so no
  token reveals or leads to another view's. In a character's view every player character stays visible (the table
  knows where its party is), other combatants only in cells that character sees; the map, shared markers and door
  states are the same for every view. Assets stay shared: any valid link may load any uploaded asset by path, but a
  view only learns the paths in its own payload, so it never asks for a token picture of a combatant it cannot see.
- Transports. Player side (`SyncTransport`): `TauriEventTransport`, `BroadcastChannelTransport`
  (`createLocalTransport(role)`), `WebSocketTransport` (`src/sync/wsTransport.ts`; reconnects with backoff,
  announces every connect with `hello`, stops for good on close code `RELAY_LINK_REVOKED` and the page says the
  link no longer works). DM side (`DmTransport`: `send(views, payload)`, `onResend`, `watchViews`):
  `LocalViewTransport` (player window; `DmApp` sets its view from `settings.playerWindow.view`, Party when that
  character is not in the encounter, none while the window is closed) and `ViewSocketTransport` (LAN and relay
  socket: view frames out, per-view hellos and status frames in; the first status after every connect asks for a
  full resend).
- Player window: `player.html` → `PlayerApp` with `usePlayerStore` built only from received messages.
- Vision (`src/core/vision/`): `computeVisibility(map, terrain, {openingStates, combatants, cellsPerSquare})` returns
  the cells each vision source sees now, by combatant id (rays vs wall spans with heights and terrain via `RayGrid`
  buckets; light regions replace the ambient level, magical darkness wins, lights add bright/dim with shadows and
  light every source alike; darkvision, truesight, blindsight, tremorsense by range). `fog.ts` holds explored
  accumulation per source (`exploreBySource`), `viewFog(sources, ids)` (union of the given sources' sight and memory
  with the DM overrides), DM overrides, brush painting.
- DM side, started in `DmApp`: `startFogTracker()` (`src/sync/fogTracker.ts`) runs visibility in
  `src/workers/visibility.worker.ts` (latest request wins), adds each source's cells to its own explored set, puts
  the party's fog into `useFogViewStore.fog` and the per-source parts into `useFogViewStore.sources`, and persists
  `encounter.fog.exploredBy` (base64 bitset per combatant id, encounter schema v2) at most once per second.
  `startDmPublisher(transports)` computes only views some transport has receivers for; a character's fog is
  composed from `sources` once per tracker result. It sends the map to all watched views, each view's encounter and
  fog on change, the full state of the requested views to one transport on its resend request. Cost
  (`pnpm tsx tools/bench-visibility.ts`, sample encounter with 2 PCs, 2 cells per square): visibility about 1.1 ms
  (1.0 ms before per-source results), party fog 0.04 ms, each connected character view +0.06 ms; at 8 cells per
  square 15-16 ms, 0.6 ms and +1 ms. The Play page feeds `useDmCameraStore` (camera),
  `useFogViewStore.showFogToDm` (fog mode) and `fogBrushPointer` (reveal/hide brush, both from the canvas Fog
  menu); "Reset explored" forgets one character's or everyone's explored cells.

## LAN player view

- `src-tauri/src/lan.rs`: axum server on `0.0.0.0:<settings.lan.port>`, commands `lan_start(port, links)`,
  `lan_set_links(links)` (token → view, checked like the relay's patterns), `lan_stop()`, `lan_status()` →
  `LanInfo {port, hosts, dmUrl, players}` (`hosts`: base URLs, LAN addresses first, localhost last). Each start
  generates a DM token (in `dmUrl`, accepted from loopback only); player tokens are the links' keys.
- Routes: `/player.html?token=` (sets an `/asset`-scoped cookie with that token so relative `.gltf` resources load),
  `/assets/*` (Vite bundle, public), `/asset/{area}/{path}?token=` (images and models only, path stays inside the
  storage root via `storage::resolve`; documents are never served), `/ws?token=` (relay). The DM socket speaks the
  internet relay's view frames and status frames (see below); a player gets only frames of its link's view, and
  only a rebuilt `hello` passes from players; any other player message closes its socket. Changed links close the
  sockets of withdrawn tokens with `RELAY_LINK_REVOKED` and of reassigned ones with 1013.
- Bundle files come from `app.asset_resolver()` (`src-tauri/src/frontend.rs`): release builds embed `dist/`; dev
  builds (devUrl set) read `dist/` from disk, so run `pnpm build` before testing the LAN view under `pnpm app:dev`.
  For player-code work, open `http://localhost:1420/player.html?token=<t>&ws=ws://127.0.0.1:<port>/ws` on the Vite
  dev server instead.
- DM side: `useLanStore` (`src/state/lanStore.ts`) holds the DM's `ViewSocketTransport`, takes the player count
  from its status frames and pushes `linkTable` whenever the links change; `DmApp` adds the transport to
  `startDmPublisher`. UI: `LanControls` (`src/ui/shell/LanControls.tsx`) on the Server page and in the rail's
  Players popover (start/stop, address, `PlayerLinks`: view select, link, copy, QR code via `uqr`, New link); the
  port is set under Settings.
- Browser client: `player.html?token=` → `src/app/player.tsx` sets `useAppStore`'s repository to a read-only
  `LanStorage` (`src/data/lanStorage.ts`, `assetUrl` → `/asset/...`) before rendering `PlayerApp`.

## Internet relay

- The DM app connects out to a relay on a server the DM controls; the relay only receives what the player filter
  already produced. Contract shared by both sides: `src/sync/relayApi.ts` (`RELAY_API_VERSION` 2, routes, limits,
  file type allowlists, schemas, view frames); the only player message the relay forwards is validated with
  `playerHelloSchema` (`protocol.ts`), and DM messages pass unparsed behind their view list, so sync protocol bumps
  need no relay redeploy.
- View frames on the DM socket: `<view>[,<view>...]\n<message>`; DM → relay goes to the players of those views,
  relay → DM carries a player's rebuilt hello under its view. Status frames `{relay: {players, views}}` (players per
  view) go to the DM on connect and whenever players or links change.
- Relay (`server/`, Node 20+, `ws`): `createRelay({dmKey, dataDir})` (`relayServer.ts`), entry `relay.ts` (env
  `DMTOOL_DM_KEY`, `DMTOOL_RELAY_PORT`, `DMTOOL_RELAY_HOST`, `DMTOOL_RELAY_DATA`), bundled by `pnpm build:server`
  (`tools/build-server.ts`, esbuild) into `dist-server/relay.mjs`. Routes: `/health`; `/?t=<token>` and
  `/player.html` (uploaded player page, sets the `/asset` token cookie); `/assets/*` (uploaded bundle, public);
  `/asset/{area}/{path}?token=` (uploaded assets); `/ws` (players with `?token=`, the DM with the subprotocols
  `dmtool-dm` + DM key, never in a logged URL). Player tokens are the keys of the links table. DM API with
  `Authorization: Bearer <key>`: `GET /api/session` (`{api, players}`), `PUT /api/links` (replaces the token → view
  table, kept in `dataDir/links.json` across restarts; withdrawn tokens' sockets close with `RELAY_LINK_REVOKED`,
  reassigned ones with 1013), `POST /api/missing` (which upload targets differ by SHA-256), `PUT
/api/asset/{area}/{path}` and `PUT /api/bundle/{path}` (hash header checked, 128 MiB limit, extension allowlist,
  `containedPath`, atomic rename). The relay pings every 30 s and drops players more than 16 MiB behind.
- Player bundle: `tools/vite-relay-plugin.ts` copies `relay.mjs` into `dist/` (so `pnpm build` fails without
  `build:server`, which `pnpm build` runs first) and writes `dist/player-bundle.json` (every built file except
  `index.html` and source maps, the player page last, with SHA-256). On connect the app reads them through the
  `frontend_file` command and uploads what changed, so app updates never need a relay redeploy.
- DM side: `useRelayStore` (`src/state/relayStore.ts`: `link`, `players`, `baseUrl`, `lastError`, `transport`)
  and `src/sync/relayClient.ts`: `fetchRelaySession` (refuses a relay of another API version with an "update the
  server" or "update the app" message), `pushRelayLinks` (on connect and whenever the links change),
  `RelayUploader` (`ensure(refs)` uploads assets plus glTF/GLB side files found by `modelSideFiles`, remembered per
  connection; `uploadBundle`) and `RelayTransport` (a `ViewSocketTransport` whose sends wait for the assets
  `collectAssetRefs` finds anywhere in the payload). `DmApp` adds the transport to `startDmPublisher`. Plain
  `http://` URLs are refused except for loopback (the DM key would travel unencrypted).
- Setup (`src-tauri/src/deploy.rs`, `russh` with `ring`): templates `src-tauri/src/deploy/install.sh` and
  `dmtool-relay.nginx.conf` filled with the validated domain, email and port; commands `deploy_write_files(folder,
setup)`, `deploy_host_key(host, port)` (`SHA256:` fingerprint, confirmed and stored in
  `settings.remote.knownHosts` by the UI), `deploy_run(request, events)` (uploads to `~/dmtool-relay-setup/` with
  `cat` over exec, runs the script as root, directly or via `sudo`, streams lines to a `Channel`, returns the DM key
  from the `DMTOOL_DM_KEY=` line, which never reaches the log). The script installs Node 22 (NodeSource) when
  needed, user and systemd unit `dmtool-relay`, `/etc/dmtool-relay/relay.env` with the DM key (kept on re-runs),
  the nginx site (WebSocket upgrade on `/ws`) and, given an email, a certbot certificate.
- UI: `src/ui/server/ServerPage.tsx` (rail entry Server): Local network (`LanControls`), Remote server (URL, DM key,
  connect, connection test via `/health` + `/api/session`, link + QR), Set up a server (`DeployDialog`). Settings
  `remote` (schema v5): `url`, `dmKey`, `setup`, `ssh` (no password), `knownHosts`.

## UI registries

- Library tabs: `LIBRARY_TABS` (`src/ui/library/LibraryPage.tsx`).
- Routes: `Route` union in `src/state/appStore.ts` + `Page` switch in `src/ui/DmApp.tsx`.
- Home (`src/ui/home/HomePage.tsx`, default route): Continue card (`settings.lastEncounter`), recent maps and
  encounters, `FirstSteps` (progress in `settings.onboarding`, `completeOnboardingStep(step)`), drop zone.
  `openSampleEncounter()` (`onboarding.ts`) creates campaign `sample-campaign` / encounter `sample-goblin-ambush`
  once from `sampleContent.ts` and opens it.
- New map wizard: `openNewMapWizard(file?)` (`src/ui/library/NewMapWizard.tsx`, host in `DmApp`); image → grid
  (`calibrateFromSquare` from a drag or two clicks, SVG overlay in image pixels) → `createCalibratedMap`
  (`mapImport.ts`) saves the map already calibrated. File drops use `useFileDrop` (`src/ui/library/fileDrop.ts`).
- Form fields: `src/ui/components/fields.tsx` (`NumberField`, `TextField`, `SelectField`, `CheckboxField`,
  `SliderField`, `ColorField`, `Field`); errors: `useAppStore.getState().reportError(error)`.

## Conventions

See `~/.omp/agent/RULES.md` and `PLAN.md` §11. In short: one `return` per function (error `throw`s allowed), no
`continue`, `break` only in `switch`, lines ≤ 120, `//` comments ≤ 80 columns and explain _why_, no swallowed errors,
no stubs/TODOs. Format with `pnpm format`; check with `pnpm typecheck`, `pnpm lint`, `pnpm test`.
