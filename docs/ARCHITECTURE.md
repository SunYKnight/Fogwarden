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
| `src-tauri`   | Rust shell: storage and version history commands, LAN server, relay deployment (SSH).                       |
| `tools`       | Node CLI scripts (run with `pnpm tsx tools/<script>.ts`).                                                   |
| `content`     | Shipped, read-only content packs in `content/packs/` (SRD 5.1 area templates, CC0 models, the sample map).  |

## Documents and storage

- Schemas: `src/core/model/*` (zod). Every document has `{schema, version, id, name, createdAt, updatedAt}`.
  Bumping a schema version requires one migration step in `src/data/migrations.ts`: a pure function, or `LAYOUT`
  when data moved into other files (`src/data/layoutMigration.ts` converts those once per data root).
  In-memory documents keep terrain heights and fog bitsets as base64 (`mapSchema`, `encounterSchema`, also the
  sync payload); the files hold them as PNGs (`mapFileSchema`, `encounterFileSchema`, `campaignFileSchema`).
- Factories: `src/core/model/factories.ts` (`createMap`, `createCreature`, `createEncounter`, ...).
- `Repository` (`src/data/repository.ts`): `list(kind)`, `load(kind, ref)`, `save(kind, doc, pack?)` (My content
  unless an imported pack is named; stamps `updatedAt`), `store*` (write as given; migration), `remove` (My content),
  `duplicateMap`, `importMapAsset`, `importCreaturePicture`, `storeCreaturePictures`, campaigns/encounters,
  settings. Library documents come from content packs (see "Content packs" below). File formats: see "Data
  formats" below.
- New document ids: factories give a ULID placeholder; every create path (new, duplicate, import, first save of a
  new creature) takes `newLibraryId(kind, name)`, `newCampaignId(name)` or `newEncounterId(campaignId, name)`
  instead. They apply `freeDocumentId` (`src/core/import/ids.ts`: slug cut to 60 characters, fallback for an empty
  slug, `-2`, `-3` … while the folder has that id in any case or it is a Windows device name such as `con`) to the
  folder listing; library ids also skip ids of every installed pack and picture file names. Renames keep the id.
  Existing ULID documents keep theirs: encounters (campaign, map, creature refs) and settings refer to them.
- `Storage` (`src/data/storage.ts`): area `'data'` (user data root) or `'content'` (shipped). Implementations:
  `TauriStorage` (desktop), `BrowserStorage` (IndexedDB, dev in a browser), `MemoryStorage` (tests),
  `NodeStorage` (`tools/nodeStorage.ts`, CLI tools; same path rules, atomic writes and version history as the Rust
  side: it refuses writes and removes in `history/` and leaves `history` out of data root listings).
  `readBytes` (Rust `storage_read_bytes`, raw IPC response) reads PNG blobs.
- Desktop storage and history commands are `#[tauri::command(async)]`, so file work never blocks the windows. A data
  write goes to a unique temp file (`<name>.<pid>-<n>.tmp`), `sync_all`, then the rename, so a power loss leaves the
  old or the new file, never an empty one. `storage_set_data_root` refuses relative paths; `storage_copy_data_root`
  copies `history/` with `history::copy_history` (objects once, dated files hard-linked). A `bootstrap.json` naming a
  missing folder, or one that does not parse, makes that session use the app data folder with a native warning
  dialog; the file stays, so the next start tries the chosen folder again.
- Command permissions: `src-tauri/build.rs` lists every app command in `AppManifest::commands`, so each needs an
  `allow-*` grant. `capabilities/default.json` (DM and player window): `core:default`, `core:window:allow-close` and
  the read-only storage commands (`storage_roots`, `_read_text`, `_read_bytes`, `_list`, `_exists`, `_asset_path`).
  `capabilities/dm.json`: every other command, player window placement, `core:window:allow-destroy`, dialogs, updater
  and restart. The monitor number windows (`identify-*`) get no commands. A new command goes into `build.rs` and a
  capability.
- Version history (`src-tauri/src/history.rs`, desktop only): every data area write (`storage_write_text`/
  `_bytes`, `_import_file`, `_copy` file by file, all atomic) and `storage_remove` first calls `history::keep`:
  unless `history/<YYYY-MM-DD>/<path>` (local date) exists or the new bytes equal the old ones, the current file's
  content goes once into `history/.objects/<sha256>` and the dated path becomes a hard link to it (a copy where the
  file system has no hard links). Writes, removes and copies into `history/` are refused; `storage_list` of the data
  root leaves it out. Commands `history_list` (`{folders: [{name, files: [{path, bytes}]}], bytes}`, oldest first,
  size counting each file identity once via volume + file index / device + inode), `history_prune` (`appStore.init`
  on every start and root switch: folders older than 30 days, then the oldest before today while above 2 GiB, then
  objects no folder links to), `history_clean(olderThanDays)`, `history_restore(files: [{folder, path}])` (keeps the
  replaced file like a write and in `history/<YYYY-MM-DD> <HH-MM-SS> before restore/`, so restores are undoable even
  after earlier changes that day), `history_open_folder`. `src/data/history.ts`: `documentOf(path)` maps a data path
  to its document (kind, id, own file; a map's pictures and terrain belong to the map), `historyDocuments(folder)`,
  `restorePlan(listing, folder, key)` (per file of the document the version of the first folder from `folder` on,
  i.e. the document as it was before that folder's changes), `historyDocumentName`. UI: `HistorySection`
  (Settings > Data). `BrowserStorage` keeps no history.
- Creature pictures are files named after the creature id next to its text file (`<id>.<png|jpg|jpeg|webp>`,
  `<id>.token.<ext>`); they resolve by pack precedence like documents, so a picture in My content's
  `library/creatures/` pictures a pack's creature without a user copy. Token picture precedence `resolveTokenAsset`:
  combatant token > creature token > creature image; `creaturePortrait` (compendium) prefers the image.
  `combatantToken`/`useCombatantToken` (`libraryStore.ts`) resolve live, so new pictures reach running encounters.
  Desktop-only file access outside the roots: `listFolder(path)`, `importFile(path, to)`, `readFileText(path)`,
  `readFileBytes(path)` (`tauriStorage.ts`, Rust `storage_list_folder`/`_import_file`/`_read_file_text`/
  `_read_file_bytes`; absolute paths the user picked, files or folders only).
- Assets are `AssetRef {area, path}`; display them with `repository.storage.assetUrl(ref)` or `<AssetImage>`.
- PNG: `src/core/png.ts` (`encodePng`/`decodePng`/`readPngSize`, dependency-free, `CompressionStream` deflate,
  every color type and bit depth, Adam7), `src/core/terrain/heightmap.ts`, `src/core/vision/fogMask.ts`.

## Data formats

Every file in a data root is meant to be read and edited with a text editor or an image viewer. JSON is
pretty-printed (2 spaces, schema key order, trailing newline), so an unchanged document saves byte for byte the same.
Packs (`content/packs/<id>/`, `<data root>/packs/<id>/`) use the same folders as `library/` plus `pack.json`.

```text
<data root>/
  settings.json
  library/
    creatures/<id>.txt                 stat block text with a header
    creatures/<id>.png|jpg|jpeg|webp   picture (also for pack creatures)
    creatures/<id>.token.<ext>         token picture
    markers/<id>.json                  area template
    maps/<id>/map.json                 map without heights
    maps/<id>/terrain.png              16-bit grayscale heightmap
    maps/<id>/assets/                  battlemap image, .glb/.gltf props and their files
    dungeon-alchemist-objects.json     model per Dungeon Alchemist object kind
    dungeon-alchemist-models/<model>/  models picked for those kinds, with their files
    tables/<id>.txt                    random table (one entry per line)
    items/<id>.md                      item (header + Markdown description)
    spells/<id>.md                     spell (header + Markdown description)
    portraits/<name>.<png|jpg|webp>    picture library (picked for creatures and player characters)
    sounds/sounds.json                 moods (playlists) and sound board, file names relative to sounds/
    sounds/<file>.<mp3|ogg|wav|m4a>    imported music and effects
  packs/<id>/
    pack.json                          {id, name, version, author, license, description, url}
    creatures/ markers/ maps/ tables/ items/ spells/ portraits/ sounds/ models/   as in library/
  campaigns/<id>/
    campaign.json
    notes.md                           campaign notes (Markdown)
    encounters/<id>/encounter.json
    encounters/<id>/fog/explored/<combatant id>.png   what that character has explored
    encounters/<id>/fog/revealed.png   cells the DM revealed
    encounters/<id>/fog/hidden.png     cells the DM hid
    handouts/<name>.<png|jpg|webp|mp4|webm|md|txt>   handouts the DM shows players
    journal/<date>-session-<n>.md      session journal entry (header + Markdown)
    people-and-places/<id>.md          person or place (header + Markdown)
    people-and-places/<id>.<ext>       its picture (named in the header)
    quests/<id>.md                     quest (header + Markdown)
    calendar.json                      in-game calendar
  history/<YYYY-MM-DD>/<path>          earlier version of <path> (version history, see Documents and storage)
  history/.objects/<sha256>            its content, stored once
```

- **Sounds** (`sounds/sounds.json` in My content and in every pack, `soundLibraryFileSchema`):
  `{schema: "sounds", version: 1, moods: [{id, name, tracks: [file]}], effects: [{id, name, file, volume}]}`;
  files are relative to that `sounds/` folder. Moods with the same id join their tracks across packs; the default
  moods (exploration, tavern, combat, boss) always exist. Sound region loops and video battlemaps are files in
  the map's `assets/` folder. Architecture: "Sound and atmosphere" below.
- File names are ids: renaming `goblin-boss.txt` renames the creature's id (encounters and overrides refer to ids).
- **Creature** (`src/core/import/creatureFile.ts`: `formatCreatureFile`, `parseCreatureFile`, `formatStatBlock`):
  an optional header between `---` lines, then the stat block in the layout `parseStatBlock` reads. Header lines
  are `key: value` with creature field names (case-insensitive): text plain (a multi-line value such as `notes`
  as an indented block under `notes:`), `tags` as a comma list, other values as JSON. The header holds `createdAt`
  and `updatedAt` plus only what the stat block cannot carry (`kind`, `level` of a player character, `source`,
  `license`, `tags`, `notes`, values the block would read back differently); header values win over the block. A
  player character's `level` becomes its combatant's level when added. Unknown or duplicate keys are errors
  naming the line. With a header the block is read exactly (indented lines continue an entry, a bracketed line
  under an action holds attack data its text does not imply); without one, any pasted stat block loads tolerantly
  as a monster. `parseCreatureFile(formatCreatureFile(c))` reproduces every D&D 5e API monster of the fixture
  `src/core/import/fixtures/dnd5e-api-monsters.json` exactly and the text byte for byte (`creatureFile.test.ts`).

  ```text
  ---
  source: SRD 5.1
  license: CC-BY-4.0
  createdAt: 2023-01-27T00:00:00.000Z
  updatedAt: 2023-01-27T00:00:00.000Z
  ---
  Goblin
  Small humanoid (goblinoid), neutral evil

  Armor Class 15 (leather armor, shield)
  Hit Points 7 (2d6)
  Speed 30 ft.
  ...
  ```

- **Area template** (`library/markers/<id>.json`): `{schema: "marker", version, id, name, createdAt, updatedAt,
shape, sizeFt, widthFt, heightFt, color, opacity, notes, save?}`; the optional `save` is `{ability, dc, damage,
damageType, halfOnSuccess}` (`damage` a dice formula rolled once for all targets) and is copied into placed markers.
- **Map** (`map.json`, schema `map` v3): the map document with `terrain.heightmap` instead of the heights:
  `"heightmap": { "file": "terrain.png", "baseFt": -3, "feetPerUnit": 0.0078125 }`. Pixel value `v` (0..65535) of
  `terrain.png` is the height `baseFt + v * feetPerUnit` feet; the image has `squaresX * samplesPerSquare + 1`
  columns (east) and `squaresY * samplesPerSquare + 1` rows (south), north-west corner first. `feetPerUnit` is the
  coarsest power of two the heights lie on, at most 2^-16 ft for small ranges, so saving moves a height by at most
  half a step (whole and half feet stay exact) and a reloaded map saves the same image again. 8-bit and RGB edits load
  too (8-bit value × 257, first channel).
- **Campaign** (`campaign.json`, schema `campaign` v3): `{schema, version, id, name, createdAt, updatedAt,
party: [{id, creature: DocRef, player}]}`; notes in `notes.md` (missing file = no notes). Party members are
  library creatures (kind player) referenced by `DocRef` plus the player's name; v2 → v3 adds `party: []`.
- **Journal, people and places, quests** (`src/core/campaign/journal.ts`, `people.ts`, `quests.ts`): Markdown with
  an optional header between `---` lines (`src/core/frontMatter.ts`: one `key: value` per line, lists comma
  separated, unknown or duplicate keys are errors naming the line). Journal keys `title`, `session`, `date`
  (`YYYY-MM-DD`), `encounters` (ids); people and places `name`, `kind` (`person`/`place`), `picture` (file name in
  the same folder), `tags`, `encounters`; quests `name`, `status` (`open`/`done`/`failed`); all with `createdAt`
  and `updatedAt`. A missing header reads as defaults (name = id, status open).
- **Calendar** (`calendar.json`, `calendarSchema` in `src/core/campaign/calendar.ts`, schema `calendar` v1):
  `{schema, version, yearLabel, months: [{name, days}], now: {year, month, day, hour, minute}, events: [{id, at,
title, notes}]}`; months and days count from 1, days have 24 hours, years are the sum of the months.
- **Random table** (`library/tables/<id>.txt`, `src/core/tables.ts`): optional header (`name`, `dice`,
  `createdAt`, `updatedAt`), then one entry per line; `#` lines are comments. `3: text` weighs 3, plain lines 1. A
  `dice` header, any `a-b:` range or the numbers 1, 2, 3 … on every line make a dice table: ranges must follow each
  other without gaps, `00` is 100, without `dice` it rolls `1d<highest>` and must start at 1.
- **Item** (`library/items/<id>.md`, `src/core/items.ts`): header `name`, `type`, `rarity` (empty for mundane
  items), `attunement` (empty, `yes` or the condition such as `by a spellcaster`), `cost`, `weight`, `source`,
  `createdAt`, `updatedAt`, then the description in Markdown.
- **Spell** (`library/spells/<id>.md`, `src/core/spells.ts`): header `name`, `level` (0 = cantrip, to 9), `school`,
  `castingTime`, `range`, `components` (`V, S, M (…)`), `duration`, `ritual` (`yes`/`no`), `classes` (comma list),
  `source`, `createdAt`, `updatedAt`, then the description in Markdown. Items and spells use `frontMatter.ts` like
  the campaign files.
- **Portraits** (`portraits/` in My content or a pack): PNG, JPEG or WebP files offered by the picture library
  (`repository.listPortraits()`); picking one for a creature copies it to the creature's picture name on save.
- **Encounter** (`encounter.json`, schema `encounter` v7): combatants, markers, door states, log, notes,
  `turnStart` (where the current combatant began its turn; v7),
  `playersMoveTokens` (players may drag their own token) and `fog.cellsPerSquare`. Since v5 every combatant has
  `level` (player characters, else null), `effects` (`{id, name, condition, expires: {round, turnOf, at:
"start"|"end"} | null}`), `concentrating`, `deathSaves` (`{successes, failures}`), `resources` (spent ones:
  `legendaryUsed`, `recharging` names, `slotsUsed` by slot level, `dailyUsed` by name) and `light` (`{name, brightFt,
dimFt, color}` or null); log kinds `xp`, `loot` and `death` mark End combat and deaths. Fog masks are 1-bit
  grayscale PNGs with one pixel per fog cell (`squaresX *
cellsPerSquare` × `squaresY * cellsPerSquare`), white = set. Paint white into `fog/revealed.png` to reveal cells.
  Masks of another size than the map's fog grid (map resized) read as empty. `partyMemberId?` names the party member
  a combatant was spawned from; such a combatant's `id` is the member's id (`addParty(encounter, members)` in
  `encounterActions.ts`, Add combatants > Add party), so its player view, link token, `settings.playerWindow.view`
  and fog key (`fog.exploredBy`, `fog/explored/<id>.png`) are the same in every encounter of the campaign. Absent
  for everyone else; no encounter schema bump (optional field).
- **Settings** (`settings.json`, schema `settings` v12): UI and server preferences. Secrets, keep the file private:
  `remote.dmKey` (authenticates the app at the internet relay as DM) and `playerLinks.secret` (all player links are
  derived from it; changing it invalidates every link).
- **Dungeon Alchemist object choices** (`library/dungeon-alchemist-objects.json`, `damObjectChoicesSchema`):
  `{schema: "dungeon-alchemist-objects", version: 1, modelFolder, gameFolder, objects: {<block id>: {name, model,
unitFt, rotationDeg}}}`; `gameFolder` is the Dungeon Alchemist install the DM located (null finds Steam installs),
  `model` is an `AssetRef` (null skips the kind), `unitFt` feet per model unit (5 for models made for Dungeon
  Alchemist, where one unit is one square), `rotationDeg` is added clockwise.
- **Migration** (`migrateDataRoot`, run by `appStore.init` on every start and data root switch, a no-op once
  converted): creature `.json` → `.txt` plus pictures from `library/creatures/assets/` and `library/portraits.json`
  (portrait index, removed) under the convention names; map heights → `terrain.png`; encounter `.json` → encounter
  folder with fog masks (combatant tokens pointing at moved pictures follow them); campaign notes → `notes.md`. Each
  document is written in the new layout, read back and compared with the old one (heights within half a heightmap
  step); only then is the old file replaced or deleted. A failing document keeps its old file and is listed as
  "Kept in the old format: …" in the load problems; old pictures and the portrait index stay until all documents
  converted. Maps and campaigns are checked by version on every start, so a conversion cut short before its last
  write (the old JSON) is redone.
- **Pack migration** (`migrateToPacks`, `src/data/packMigration.ts`, after `migrateDataRoot`, only while
  `settings.json` is older than v7 or missing): asset references to shipped files (`content:creatures/…`,
  `markers/`, `maps/`, `models/cc0/`) are rewritten in maps, encounters and `dungeon-alchemist-objects.json` (any
  `{area, path}` object in the JSON). Rewritten documents are read back and restored on a mismatch; any problem is
  listed as "Not moved into packs yet: …" and leaves the settings version, so the next start tries again. Success
  saves the settings as v7.

## Content packs

- A pack is a folder `packs/<id>/` with `pack.json` (`packManifestSchema`: `id`, `name`, `version`, `author`,
  `license`, `description`, `url`) and the library folders. Shipped packs are in the content root
  (`content/packs/srd` (five area templates), `cc0-models`, `sample-map`), imported ones in the data root; the data
  root's `library/` is "My content" (`MY_CONTENT`), always on and first. `src/data/packs.ts`: `LibrarySource {pack,
area, root}`, `MY_CONTENT_SOURCE`, `packSource`, `writableSource`, `orderPacks`, `mapAssetRefs`/`remapJsonAssets`.
- Precedence: My content, then `settings.packs.order` (settings v7), then packs the order does not name (imported
  before shipped, by id); `settings.packs.disabled` hides packs and `settings.packs.hiddenKinds` (v12) single kinds
  of a pack: `packShowsKind(id, kind, settings)` (`data/packs.ts`); `Repository.kindSources(kind)` splits packs into
  `shown` and `held`, and `list`, `load`, `sourceOf` and creature pictures use `shown`; `listing.unavailable[]`
  carries `hidden`, and the inspector/Party tab name the holding pack (`useHeldPackOf`). Name duplicates are only a
  list concern: `libraryStore.withDuplicates()` adds `listed` (entries minus same-name entries of lower packs while
  `settings.packs.hideDuplicates`; `slug` names; My content never hidden; player characters only against player
  characters) and `duplicates[] {id, pack, by}`; lists read `listed`, lookups by id keep reading `entries`.
  `repository.installedPacks()` (all, with
  `enabled`), `librarySources()` (enabled, in order), `listPacks()` (manifest, counts per kind and 3D models,
  problems such as a user folder with a built-in pack's id). The repository takes the pack settings from
  `loadSettings`/`saveSettings`.
- Kinds (`LibraryKind`: creature, marker, map, table, item, spell) are laid out by `KIND_LAYOUTS` (`dir`, file
  suffix, folder, fallback id) and read/written by one codec each (`textCodec` for one text file per document). A
  new kind adds its `LibraryKind`, `LibraryDocs` type, layout and codec. `list(kind)` returns the winner per id
  (`entry.pack`, `entry.overrides`: packs it hides), `shadowed` (`{id, pack, by}`) and `unavailable` (ids only a
  disabled pack holds). `load(kind, ref)` resolves `ref.id` by precedence (`ref.area` only records where it was);
  an id only a disabled pack holds throws naming that pack. Encounters keep working from their combatants' own
  HP/AC/conditions; the inspector says which disabled or hiding pack holds the stat block (`useHeldPackOf`), a map
  in a disabled pack is reported on opening, and its grid still sizes the fog so saving never drops fog.
- Packs are read-only in the app: saving a pack's document writes My content (the user copy that overrides it).
  Imports may write into a user pack: `ensurePack(manifest)` then `save(kind, doc, packId)`,
  `importCreaturePicture(…, packId)`, `importMapAsset(…, packId)` (`import-statblocks.ts --pack <id>`).
- Asset references inside a pack name its own files as `packs/<id>/…`. `src/data/packArchive.ts`: `exportPack`
  (zip with `pack.json` at the top; references into the exported root become `data:packs/<id>/…`; My content
  exports as `my-content-<date>`), `readPackZip`/`packFilesOf` (`pack.json` at the top or in the single top
  folder), `installPack` (staging folder `packs/<id>.importing`, every file read back and compared, then the old
  version replaced; the staging folder stays when swapping in fails, as the only complete copy, and the next import
  clears it; `PackExistsError` asks before replacing; built-in ids refused), `removePack`. ZIP: `src/core/zip.ts`
  (dependency-free, stored/deflate via `CompressionStream('deflate-raw')`, CRC-32 checked, unsafe names and names
  with `:` refused, each entry inflated only up to its stated size, overlapping entries and archives over 2 GiB
  unpacked refused, no ZIP64). LAN and relay serve pack pictures and models like any asset; `pack.json`, stat block
  text and `terrain.png` are documents and never served.
- UI: Settings > Content (`PackLibrary`, `PackActions` in `PackLibrary.tsx`): rows in precedence order (drag or
  Alt+Up/Down to reorder), name, version, author, license, counts (also portraits), "n overridden by …", enable
  switch, Export, Remove (imported packs, confirmed); header actions Import from Aurora Builder… and Import folder…
  (desktop), Import pack… (.zip).
  `OriginBadge` names an entry's pack. Compendium tabs Items and Spells (`ItemSpellLibrary.tsx`): search, filters
  (item type and rarity; spell level, school and class; source book for both), rows with the source book (the
  pack shows in the preview), at most 300 rows at once, preview with the facts and the
  Markdown description. `PictureLibraryDialog` (creature editor Image/Token "Library…", Add combatants' hand-typed
  player character) shows `repository.listPortraits()` as thumbnails. Compendium tab Players (`PlayerLibrary.tsx`,
  `PlayerActions`): library creatures of kind player with `characterSummary` (level, subtype as race, tags but
  `aurora` as class, AC, HP) and their campaigns' parties; edit/duplicate/delete via
  `useCreatureActions`/`CreaturePreview` shared with `CreatureLibrary` (which hides kind player). Route
  `creature-editor` takes `kind` for new creatures (New player character); the editor's Close goes back to the tab
  of the creature's kind. Campaign tab Party (`src/ui/campaign/PartyTab.tsx`): members with picture, summary,
  editable player name, remove; Add characters… picker; Import from Aurora…
- Campaign archives (`src/data/campaignArchive.ts`, `<campaign id>.fogwarden-campaign.zip`) mirror the data root:
  `fogwarden-campaign.json` (`manifestSchema`: `format` 1, `app`, `exportedAt`, `campaign {id, name}`,
  `library [{kind: creature|marker|map, id, files}]`, `assets`, `packs [{id, name}]`), `campaigns/<id>/…` (whole
  folder), `library/…` (My content maps, creatures with pictures and area templates its encounters use) and other
  data files its JSON or bundled maps refer to. `exportCampaign(repository, campaignId, now)` bundles a document when
  My content holds it, else lists its pack; it also bundles the My content creatures of `campaign.json`'s party and
  names the packs holding the others. `readCampaignZip` validates the manifest with zod and the file layout; ids
  must be names Windows keeps as written (no `<>:"|?*`, control characters, trailing dot or space, device names).
  `importCampaign(repository, archive, 'fail' | 'replace' | 'copy')`: `CampaignExistsError` for `'fail'`; a copy is
  `Name (2)`… under `newCampaignId`; documents identical to My content's are shared, others whose id is taken get
  `newLibraryId(kind, id)` and the references follow (party `creature` refs too); assets keep their path when free
  or identical, else go to `campaigns/<id>/imported-assets/<path>`; staged in `campaigns.importing/<id>`, read back,
  then swapped in (the staging folder stays when swapping in fails and the next import clears it); the result names
  `missingPacks`. UI (`src/ui/campaign/campaignArchiveUi.ts`): campaign page
  Export…, campaign card context menu Export…, Campaigns header Import campaign…, Home Import…/drop (`.zip`),
  commands `campaign:import` and `campaign:export`; Replace campaign / Import as copy via `choiceDialog` (kit).
  Sound moods are not bundled.

## Rules and imports

- `src/core/rules`: `dice.ts` (`parseDice`, `rollDice` with seeded rng and advantage, `averageDice`),
  `abilities.ts` (modifiers, proficiency/XP by CR, `formatCr`), `distance.ts` (`gridDistanceFt`, 5-5-5 / 5-10-5),
  `templates.ts` (`areaCells`: squares at least half covered; `areaOutline`; 0° = east, 90° = south),
  `space.ts` (`CREATURE_SPACE_FT`, token `footprintCells`), `difficulty.ts` (DMG 2014 `partyThresholds`,
  `xpMultiplier` by monster count and party size, `encounterDifficulty`, `splitXp`), `areaEffects.ts`
  (`combatantsInArea`: any footprint square in `areaCells`; `saveBonus`; `damageResponse` from plain resistance,
  immunity and vulnerability entries, qualified weapon entries ignored; `areaDamage`: save first, then resistance),
  `resources.ts` (`creatureResources`: legendary count from the intro, `(Recharge 5-6)` and rest recharges,
  `(3/Day)` features, slots from "1st level (4 slots)", innate `N/day [each]` lists, lair flag).
- `src/core/import/statblock.ts`: `parseStatBlock(text, meta)` reads raw stat block text and throws
  `StatBlockError` naming the failing line. Imported documents get readable stable ids (`slugId`), so re-imports
  overwrite. `src/core/imageSize.ts` reads PNG/JPEG pixel sizes from the header.
- `src/core/import/portraitMatch.ts`: `matchPortraits(fileNames, creatures)` pairs picture files with creatures by
  `portraitKey` (slug without extension and `source--` prefixes): id beats name beats family name ("Werewolf, Human
  Form" → "werewolf"); a file fits all creatures sharing the key, the first sorted file wins per creature.
  UI: `AttachPortraitsDialog` (Compendium header) previews, then copies each file to `library/creatures/<id>.<ext>`.
- Aurora Builder (`src/core/xml.ts`: dependency-free XML reader; `src/core/import/aurora.ts`,
  `auroraMarkdown.ts`, `auroraCharacter.ts`; `src/data/auroraImport.ts`): `indexAuroraElements` reads the element
  files of `custom/**/*.xml` by Aurora id; `auroraItem` (types Item, Weapon, Armor, Magic Item: type from the
  `type` setter or category, weapon category and armor group from internal supports, damage/properties/AC as a
  first description line, rarity title-cased, attunement with its condition) and `auroraSpell` map them;
  `auroraMarkdown` turns description markup (`p`, `h1`-`h6`, lists, tables, `b`/`i`, sidebars as quotes,
  `div class="reference"` as "See _name_.") into Markdown. Ids are the Aurora id as a slug
  (`ID_PHB_SPELL_AID` → `phb-spell-aid`), characters' the file name (`Varis_6.dnd5e` → `varis-6`), so re-imports
  overwrite. `auroraCharacter(text, fileName, index)`: `.dnd5e` files hold the build, not the sheet, so it collects
  the ids of the chosen elements and the equipped items and evaluates their `<stat>` rules like Aurora (sum per
  name, highest per `bonus` group, `level`, `requirements` and `equipped` conditions, values referring to other
  stats); Aurora's built-ins are applied directly (ability score improvements `ID_INTERNAL_ASI_*`, save and skill
  proficiency and expertise ids, darkvision ids, proficiency bonus, armor: light full Dex, medium at most +2,
  heavy none, `ac:calculation` alternatives, shield, `ac:misc`). Hit points: first level die in full, then the
  average (Aurora option) or Aurora's stored rolls (`rndhp`), plus Con and `hp` stats. The result is a creature of
  kind `player` with `level`, attacks as actions, spellcasting as a trait with slots, the portrait file name and
  the embedded portrait. Checked against Aurora's own sheets of four characters (AC, HP, speed, scores, saves,
  skills, passive Perception equal). `planAuroraImport(source, folder)` reads everything without writing
  (problems per unreadable file); `runAuroraImport(plan, parts, source, repository, onProgress)` writes the ticked
  `AuroraParts` {characters, items, spells, portraits} into the pack `aurora-builder` (`AURORA_PACK`, license "see
  source books"): portraits (all with `portraits`, else only those the imported characters reference), items,
  spells, characters (portrait from the folder by file name, else the embedded one), then deletes the files of the
  ticked parts the import did not write; unticked parts keep their files. `auroraBooks(docs)` lists source books.
  UI: `AuroraImportDialog` (Settings > Content, Compendium > Players, campaign Party tab, Add combatants > Player
  character > From Aurora…; folder dialog starting in `Documents/5e Character Builder`, counts preview, progress,
  report).
- **D&D 5e API import** (`src/core/import/dnd5eApi.ts` pure conversion, `src/data/dnd5eApiImport.ts` I/O,
  `src/ui/library/DndApiImportDialog.tsx`): lists `/api/2014/{monsters,spells,magic-items,equipment}`, fetches
  each document (4 at a time; HTTP 429 waits 1 s and retries since CORS hides `Retry-After`) and writes it into the
  user pack `dnd5e-api` as it arrives. Monsters are rendered to stat block text and read back with `parseStatBlock`
  (`srdCreature`, cross-checked against the API's numbers); spells → `Spell` (`srdSpell`), spell
  `area_of_effect` → `MarkerTemplate` (`srdAreaTemplate`), magic items and equipment → `Item` (`srdMagicItem`,
  `srdEquipment`). Ids `srd-<index>`. Spells and their areas share one download. `importApiMonsters(repository,
indexes | 'all')` imports single monsters the pack lacks (sample campaign). Opened by `openDndApiImport()`
  (Compendium Creatures Import ▾, Items and Spells header and empty states, empty Creatures list, Add combatants
  with an empty library, first step `srdData`); `attachPortraitsFromApi()` fetches monster pictures alone.
- Map imports (`src/core/import`, all positions end in feet from the map's north-west corner):
  - `uvtt.ts` `parseUvtt(text, fileName)`: Universal VTT (`.dd2vtt`/`.df2vtt`/`.uvtt`). Squares minus
    `map_origin` × 5 ft; `pixels_per_grid` is the calibration; the base64 picture is sniffed (`sniffImage`: PNG,
    JPEG, WebP; Dungeon Alchemist writes JPEG). `line_of_sight` → full walls (10 ft, `FULL_WALL`),
    `objects_line_of_sight` → 6 ft sight-blocking walls (`SIGHT_OBJECT`, above medium eye height), portals →
    doors, not `closed` ones → windows (Dungeondraft's light-passing portals), lights: `range` squares is the full
    reach, half bright and half dim, ARGB colors. Ambient tint luminance → level (`lightLevelOfColor`);
    `baked_lighting` makes it one level lighter with a map note (`bakedLighting`).
  - `dungeonAlchemist.ts`: Foundry export folders. `collectDaMaps(fileNames)` pairs `<name>[_NN|-_NN].json` with
    the picture of the same name (webp > png > jpg), groups floors by name (" - Foundry_Export" dropped) and finds
    the `.dam` whose name starts the export's. `parseDaFloor(text, fileName)`: wall segments in scene pixels minus
    Foundry padding (`ceil(size * padding / grid) * grid`); `door` 1/2 = door/secret door with `ds` state;
    `sense` 1 → 10 ft wall, 2 (limited) → 3 ft sight-blocking wall, 0 → 3 ft railing; `move` 0 → passable;
    light radii in grid units (`dim` includes `bright`); `shiftX/Y` → grid offset; scene darkness → ambient,
    always treated as baked lighting. One map per floor (`daFloorName`: "<name> – Floor N").
  - `mapStructures.ts` `buildStructures(walls, portals)`: joins polylines of the same `WallProfile` where exactly
    two ends meet (closed when a chain returns to its start), drops colinear vertices (0.05 ft), turns portals whose
    ends lie on a source wall into openings there and every other portal into a wall piece that joins the walls at
    its ends (a door between two runs gives one wall); freestanding portals keep their own wall.
  - `damProject.ts` `parseDamProject(text, fileName)`: Dungeon Alchemist project files, readers per `Version`
    (`READERS`, 11 so far; others throw). One unit is one tile = one square = 5 ft (Dungeon Alchemist's custom
    model guide: 1 Blender meter is one square). `terrainLayers[0].terrain` is base64: int32 header `-1, 0, cols,
rows, count`, then `count` float32 heights in tiles, rows from the south edge, 8 samples per tile
    (`decodeDamTerrain`; the second layer repeats the first 0.1 tiles lower). Objects are the
    `buildingBlockInstances` that `objects[]` lists (walls, floors, pillars and openings have their own blocks):
    kind (`blockId`), center (tiles, y from the south), base `height`, `scale`, `rotation` (clockwise, missing =
    0). Only the ground level is read: the foundation that is its own base on layer 0 (`foundations[]`; layer -1
    is a cellar, layer 1 the floor above); parts on other foundations count as `otherLevelParts`. Buildings
    (`DamStructure`): `walls[].wall {p1, p2}` are tile-corner pieces one tile long; `wallOpenings[].wallPieceSection`
    `"x1 y1 x2 y2 level;offset;width"` is a run of `width` pieces from p1 towards p2 (offset 0 in every file seen);
    `rooms[].parts` are the floor tiles, outlined by `cellOutline` (`geometry/polygon.ts`, holes left out);
    `pillars[].position.positionInCm` are wall corners in cm (100 per tile; one entry per corner quadrant, read
    once). Floor = ground foundation height (0.2 tiles = 1 ft; the terrain under buildings lies at it), storey =
    height of the foundation above minus it (2.4 tiles = 12 ft), else 12 ft. `floors[].height` is no height (it
    counts up per tile) and is not read; door or window is not in the file (only the opening's model id).
    Exports add the same border around the project (4 squares in the default), so `damMargin` derives it from
    the map size; `damTerrainField` resamples onto the map's height grid, the border repeats the nearest edge.
    Dungeon Alchemist's meshes are never read.
  - `damStructures.ts` `withDamStructures(content, sources, project, grid)`: the picture is a perspective render
    from above the map centre; the ground lies true to the grid (project tile `(x, y)` → map square
    `(margin + x, margin + height - y)`), wall tops appear scaled about the centre, and `.dd2vtt`/Foundry/Fantasy
    Grounds lines are drawn at the wall tops (`Untitled Map2`: factor 1.0534, lines up within 0.05 ft; 2.6 ft off
    unscaled). `fitWallTopScale` finds the factor from the export's own lines (`ImportedMap.sources`, as drawn).
    Export lines and portals within 0.75 ft of the scaled project walls are dropped, the rest stay; project walls
    (`wallRuns`: touching colinear pieces merged) become storey-high walls on the true lines, openings take door or
    window from the export portals on them (door without one), free pillars become 1.5 ft closed walls, rooms get
    floor, storey ceiling and a roof. Other levels add "Upper floors … are not imported yet" to the notes.
  - `damObjects.ts`: `damObjectKinds`, `damProps` (props at the object positions, Y turn negated because three.js
    turns counter-clockwise, `unitFt × scale`, no sight or movement blocking; the export's walls do that).
  - UI: `mapImport.ts` `saveImportedMap` (content, terrain, project buildings via `withDamStructures` when
    `sources` come along, `props(mapId, grid)`; terrain and buildings are checked before any
    file is written; `writeImage` returns the stored picture's size and the calibration is scaled to it, squares
    stay those of the original), `storeMapImage` (pictures above `MAX_TEXTURE_PX` are stored reduced to it:
    `reducedImageSize`/`scaleCalibration` in `calibration.ts`, `OffscreenCanvas`, JPEG, PNG if any pixel is
    transparent; players never download more than the 3D view shows), `daObjects.ts` (choices file, library
    models, `CC0_MODELS` from the pack `content/packs/cc0-models`, `damPropsFor` copies each chosen model with its
    glTF side files to `assets/models/<folder>/`, `damObjectPixels` places a kind's objects on the export picture),
    `DamObjectsPanel` (one row per kind: CC0 stand-in, own file, a file from a picked folder such as Dungeon
    Alchemist's custom models, or Skip; beside it the picture with dots on every object of the hovered or selected
    kind), `DaFolderImport.tsx` (Maps page, desktop: reads every floor up front and checks each project fits its
    lowest floor; terrain and objects go to the lowest floor). `NewMapWizard.tsx`: `.dd2vtt` drafts get a "Project"
    step after the image (pick or drop the `.dam`, Skip creates the map without it); `.df2vtt`/`.uvtt` come from
    other tools and have no project.
- CLI (`pnpm tsx tools/<script>.ts`, default data root = the desktop app's, override with `--data-root`):
  `import-statblocks.ts <folder> [--source <name>] [--pack <id>]`, `build-srd.ts` regenerates the pack
  `content/packs/srd` (five area templates; attribution in its `LICENSE.md`), `build-sample.ts` regenerates the
  pack `content/packs/sample-map` with the map `sample-chapel` (procedural drawing, PNG encoder `src/core/png.ts`).

## Map rendering

- `MapView` (`src/render/MapView.tsx`) owns the `<Canvas>`, camera rig, base lights, terrain and pointer events.
  Extra content is passed as children. Every view (editor, DM encounter, player) renders
  `SCENE_LAYERS` (`src/render/layers.ts`) as children; a layer reads `useMapRender()`:
  `{ map, terrain, terrainVersion, uniforms, mode }` and decides from `mode` (`'editor' | 'dm' | 'player'`)
  what to draw. Register a layer by appending `{ id, Component }` to `SCENE_LAYERS`.
- Graphics settings (`settings.graphics`, Settings > Graphics; player windows without settings use
  `defaultGraphicsSettings()`): `MapView` sets the Canvas `dpr` from `resolutionScale`, `gl.antialias` from
  `antialias` (the Canvas is keyed by it, since WebGL fixes antialiasing at context creation) and, with
  `maxFps` 30, `frameloop="demand"` plus `FrameRateCap`, which invalidates at most 30 times a second; prop changes
  and orbit-control moves still invalidate at once. `textureSizePx` (1024/2048/4096) caps battlemap textures
  (`useProjectionUniforms`), token pictures (`tokenTextureEdgePx`: half of it, at most 1024 px) and glTF textures
  (`useModel`); each cache key includes the size, so a change reloads them. `shadowMapSizePx` sizes each shadowed
  light's cube map (lights are keyed by it, as three never resizes a cube shadow map).
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
  hazard/note regions, discarded in unknown fog), `LightLayer` (point lights, the first `graphics.shadowedLights`
  (default 4) cast shadows with `graphics.shadowMapSizePx` maps, carried lights
  follow their combatant, also those combatants carry themselves via `useCarriedLights`; editor gizmos), `PropLayer`
  (glTF/GLB via `useModel`: one parse per file and texture size, images above `graphics.textureSizePx` replaced by
  scaled `createImageBitmap` copies before upload, parses of another size freed once no prop shows them; exports
  call `loadGltf(storage, asset, null)` for the stored textures; optional battlemap projection).
  Editor `layers` toggles apply in mode `'editor'` only (`useLayerVisible`). Live door states: `useOpeningStates()`
  (`src/render/useOpeningStates.ts`). `MapLight.dimFt` is dim light beyond the bright radius (5e torch 20/20).
- Labels in the scene: `TextLabel` (`src/render/TextLabel.tsx`), a screen-sized canvas-texture sprite. drei `<Html>`
  is not used: its DOM roots throw on unmount under React 19 and would not appear in the rendered player image.
- Images: `loadImageTexture(url, sizePx, maxEdgePx)` (`src/render/loadImageTexture.ts`) decodes off the main thread
  and scales images above `maxEdgePx` down while decoding (battlemaps: `graphics.textureSizePx`); huge exports
  otherwise freeze the UI for seconds. `MAX_TEXTURE_PX` (4096) caps stored battlemaps and exported pictures.

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
  Autosave writes `snapshot()` about 800 ms after the last change. Edits to the same fields under one label within
  1 s join one undo step (sliders, colour pickers). Saves of one store run one after another and revisions never
  reset, so a late save of the previous document cannot mark the next one's edits saved. The DM window's close
  request (Tauri `onCloseRequested`) waits for the map and encounter saves; a failed save keeps the window open.
- Sculpt brushes are pure functions in `src/core/terrain/brushes.ts` returning the touched `SampleRect`. Before each
  `terrainChanged()` of a stroke call `markTerrainDirty(field, rect)` (`src/render/terrain/terrainDirty.ts`); the
  terrain mesh then rewrites only that region (positions, normals, BVH nodes). Unmarked version bumps (undo, load)
  rebuild the whole mesh. Grid size/resolution changes go through `resampleHeightField` (`src/core/terrain/resample.ts`).
- Tools receive pointer down/up only for the left button; right and middle belong to the camera.
- Tools implement `EditorTool` (`src/editor/tool.ts`: kit `icon`, `step` tab, `shortcut` letter, `hint`, `cursor`) and
  are listed in `TERRAIN_TOOLS` (`src/editor/tools/terrain/index.ts`) or `STRUCTURE_TOOLS`
  (`src/editor/tools/structure/index.ts`); `TOOLS` adds select and calibration, which belong to no step.
  `Overlay` renders inside the canvas (cursor, previews), `Panel` inline in the tool bar (compact fields).
- Page (`src/ui/editor/MapEditorPage.tsx`): header (undo/redo, map settings, export, Top/3D, player look), step tabs
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

## Map export

- UI: `MapExportDialog` (`src/ui/library/`), opened from the Maps page card menu (_Export…_, the saved map) and the
  editor header (`editorStore.exportOpen`, the live map; editor keys pause while it is open). `exportMap` in
  `mapExport.ts` asks for the target with the dialog plugin's `save` first, then builds the bytes and writes them with
  `writeFileBytes(path, bytes)` (`tauriStorage.ts`, Rust `storage_write_file_bytes`: absolute path, extension
  `glb`/`dd2vtt`/`png`/`zip`, existing folder outside the data and content roots and system folders, atomic write).
  The browser build downloads instead.
- `renderMapPicture(map, battlemap, {grid, mimeType})` (`src/render/export/mapPicture.ts`): the map's squares as one
  picture from the north-west corner (battlemap turned and moved by the inverse calibration over the ground color,
  at most `MAX_TEXTURE_PX`, grid lines on request). Image export (PNG), UVTT image (JPEG) and GLB texture (JPEG, grid
  when `grid.show`) use it; video battlemaps give their first frame.
- Universal VTT: `formatUvtt(map, {bytes, pxPerSquare})` (`src/core/export/uvtt.ts`). Sight-blocking walls are split
  at their openings (`wallPieces`; a closed wall's last run continues into its first): full height (≥ 10 ft) as
  `line_of_sight`, lower as `objects_line_of_sight`; every opening on them is a portal (`closed` false for windows,
  portcullises and arrow slits, which let sight through); enabled unattached lights with `range` = bright + dim in
  squares; ambient level as a gray tint (black for magical darkness, which reads back as plain darkness).
  `parseUvtt` reads the result back to the same walls, openings, lights and
  grid (`uvtt.test.ts`).
- GLB: `exportMapGlb(map, terrain, sources, {lights})` (`src/render/export/mapGlb.ts`) builds the scene from the
  render code's geometry: `createTerrainGeometry`, `buildWallGeometry`, `openingFrame` (`openingShape.ts`, also used
  by `StructureLayer`; doors, panes and bars closed), `roomFloorGeometry`/`roomRoofGeometry` (`roomGeometry.ts`,
  also used by `RoomLayer`), props from `sources.model` (`loadGltf` clone) with their transform. Every projected
  surface is split like the projected material: faces more upright than the slope limit get the battlemap by map
  position, steeper ones the side texture (`sideTexture` canvas as PNG) tiled every 5 ft along their dominant axis,
  with their own vertices; projected props are baked into map space for that. Everything is in feet under one root
  node scaled by 0.3048 (meters); lights are KHR_lights_punctual point lights (range in meters, intensity lighting
  the reach to about 25 lux). An exporter plugin embeds the encoded pictures as they are (no canvas re-encode), so
  `mapGlb.test.ts` runs in node: it re-imports the sample map with `GLTFLoader` and checks node names, textured
  materials and bounds in meters. Checked once by importing an export in Blender 2.83 (objects, 0.3048 root scale,
  30.48 × 24.38 m bounds, images and lights as expected).

## Encounters and player view

- `useEncounterStore`: open encounter + its map + terrain; `update(recipe, label?)` (immer); autosaved.
  Door states during play live in `encounter.openingStates`, never in the map. Every update that changes more than
  `log` and `fog` becomes one labelled undo step (`undo()`/`redo()` return the label; bounded `History`); log and
  fog patches are left out of the steps, so undo never erases log lines or re-fogs explored ground, and fog
  tracking, fog brush strokes and dice rolls don't flood the history.
- Encounter rules (`src/state/encounterActions.ts`): pure helpers used inside `update` recipes — damage/healing/temp
  HP, `spawnCombatant` (average or rolled HP, unique numbered names), initiative order (ties by Dex), turns and rounds,
  log entries, `rollAttack` (critical hits double the dice).
- Combat upkeep (`src/state/combatRules.ts`, same style): `effectExpiry` turns a duration (rounds from the current
  turn, or the start/end of a combatant's next turn) into a turn boundary; `advanceTurn` (Next turn) expires effects
  at the ending and starting turn (or once their round is over, when their combatant left), lifts conditions no
  remaining effect imposes, reminds of lair actions when initiative 20 passes (also across the round wrap) and runs
  `startOfTurn` (legendary actions back, d6 per spent recharge ability). `settleHpChange` after every HP change:
  damage at 0 HP fails a player character's death save, HP above 0 clears death saves, concentration ends at 0 HP,
  else damage owes a concentration save (`concentrationDc`). `rollDeathSave`, `stabilize`, `rollConcentrationSave`,
  `rollAreaSaves`, `applyAreaDamage`, `combatXp`/`describeXp`.
- Play page (`src/ui/encounter/EncounterPage.tsx`, shown by `PlayPage` for `settings.lastEncounter`): header with
  breadcrumb, round and undo/redo; `InitiativeStrip` (turn order, inline initiative, drag to reorder, "+ Add" →
  `AddCombatantsDialog`); `PlayViewport` (map, canvas toolbar with Select/Measure/Area/camera/Fog menu, "n not on
  map" chip that places unplaced combatants one after another, right click without drag → `openCombatantMenu`);
  `TurnBar` (attacks of the current combatant, quick damage/heal for the selection, turn buttons); `Inspector` tabs
  Creature/Dice/Log/Areas. Commands shared by these (HP, conditions, turns, initiative, removal, End combat) are in
  `combatantCommands.ts`; keys are registered with `useShortcuts('Play', …)`. Map interaction (token
  select/drag/place, ruler, marker placement, door toggling with Shift+click to lock) goes through
  `handleEncounterPointer` with transient state in `useEncounterUi`.
- Combat rules UI: `DifficultyBadge` (`EncounterDifficulty.tsx`) in the Play header and the Add combatants dialog
  (pending monsters count); `CombatantRules.tsx` in the Creature tab (Level for player characters, `DeathSaves` at
  0 HP, `EffectsSection` with concentration, `ResourcesSection`, `CarriedLightField` under Players and map);
  `AreaTargets` in the Areas tab for `useEncounterUi.areaTargetsId` (set when a marker is placed or its Targets
  button is pressed); `ConcentrationDialog` works through `useEncounterUi.concentrationChecks` (queued by
  `changeHp` and area damage); `EndCombatDialog` (End combat in the turn bar) logs XP and loot (typed with item
  names suggested, rolled on random tables via `rollTable`, or a random library item of a chosen rarity) before
  `endCombat`. The Add combatants dialog's Player character tab lists library creatures of kind `player`
  (spawned with their `level`) and keeps the hand-typed form under "Enter by hand".
- `TokenLayer` / `MarkerLayer` (`src/render/tokens`, `src/render/markers`): read `useEncounterStore` in `dm` mode and
  `usePlayerStore` in `player` mode. Tokens snap to whole squares by 5e size (`snapTokenPoint`).
- `TokenView`: disc with the picture in the top view; in the perspective camera a standee (side-colored base, card
  in a side/current/selected frame, height from `CREATURE_SPACE_FT` and the picture aspect, `standee.ts` crop math)
  turned around Y each frame with a module-level scratch vector. Card meshes report hits at the token base
  (`raycastToBase`) and DM tokens ignore the pointer while a token is dragged or placed. `settings.tokenStandees`
  (DM) and `PlayerEncounter.standees` (players) choose standees. Geometry and materials are shared
  (`tokenMaterials.ts`; per-texture materials die with the texture); `useAssetTexture` reference-counts one texture
  per asset and size, decoded at most `tokenTextureEdgePx(graphics.textureSizePx)` (1024 px, 512 px at 1024).
- Creature type icons: `creatureTypeIcon(type, typeText)` / `creatureIconOf(creature)` (`src/core/creatureTypeIcon.ts`)
  map a creature to one of 14 type icons or `swarm` (tag or text "swarm"; unknown → humanoid). The SVGs
  (game-icons.net, CC BY 3.0, `src/ui/creatureTypes/icons/LICENSE.md`, shown in Settings > About) are bundled; their
  path data (`CREATURE_ICON_PATHS`) feeds `CreatureThumb` (picture, else icon: Compendium rows and preview, Add
  combatants) and `typeIconTexture` (token without picture: icon in the side color plus the combatant's number).
  Ad-hoc combatants without a library creature keep initials. Players get the icon key as `PlayerCombatant.typeIcon`
  (`typeIconOf` beside `tokenOf`).
- Sync (`src/sync/protocol.ts`, protocol 2): the DM sends `map` (filtered for players, with a `revision`),
  `encounter` (`PlayerEncounter`), `fog` (`PlayerFog`), `camera` and `view` (the view's name, shown in the player
  page's status corner); the player sends `hello` to request a resend and the requests of "Player devices" below.
  `hello` may carry `mapRevision`, the map the page already has; `onResend(view, mapRevision)` and
  `startDmPublisher` then leave the map out of the resend. Messages are parsed with zod: the DM side with
  `playerMessageSchema`, the player side with an envelope schema (`protocol`, `from`, payload with a string `type`).
  Filtering happens on the DM side; the player never receives hidden combatants, secret doors, hidden regions or
  notes. Combatant tokens are sent resolved (`filterEncounterForPlayers(..., { showTurnOrder, standees, tokenOf,
typeIconOf })`).
- Player views (`src/sync/views.ts`): `PARTY_VIEW` (`'party'`, all vision sources) or one player character's
  combatant id, which for party members is their member id (`playerViews` uses `partyMemberId ?? id`); only that
  character's vision. View id = combatant id everywhere (fog, sheets, moves, `rebuildPlayerMessage`, `lan.rs`,
  relay), so nothing needs translating. `playerViews(encounter)` lists Party plus the encounter's player
  characters; `useViewLinksStore` keeps them as `views` (link picker, Show, player window; also while no encounter
  is open, so leaving Play withdraws no link) and as `linked`: those views, the open campaign's party members (id =
  member id, name = the character's name from the creature library, else the player's name; read with
  `repository.listCampaigns()` when an encounter opens or the page changes, since the campaign page saves straight
  to the repository) and characters of the campaign's earlier encounters this session. Opening another campaign's
  encounter drops the old campaign's views. `linkTable` and the derived tokens cover `linked`, one link token each.
  `startViewLinks()` (in `DmApp`) derives the tokens: `linkToken(secret, view, rotation)`
  is HMAC-SHA256 under `settings.playerLinks.secret` (created on first start), truncated to 128 bits; `rotateLink`
  bumps `settings.playerLinks.rotations[view]`. The servers only get the token → view table (`linkTable`), so no
  token reveals or leads to another view's. In a character's view every player character stays visible (the table
  knows where its party is), other combatants only in cells that character sees; the map, shared markers and door
  states are the same for every view. Assets stay shared: any valid link may load any uploaded asset by path, but a
  view only learns the paths in its own payload, so it never asks for a token picture of a combatant it cannot see.
- Transports. Player side (`SyncTransport`): `TauriEventTransport`, `BroadcastChannelTransport`
  (`createLocalTransport(role)`), `WebSocketTransport` (`src/sync/wsTransport.ts`; reconnects with backoff,
  announces every connect with `hello` naming the last map revision it received, stops for good on close code
  `RELAY_LINK_REVOKED` and the page says the link no longer works). DM side (`DmTransport`: `send(views, payload)`,
  `onResend`, `onPlayerRequest`, `watchViews`):
  `LocalViewTransport` (player window; `DmApp` sets its view from `settings.playerWindow.view`, Party when that
  character is not in the encounter, none while the window is closed) and `ViewSocketTransport` (LAN and relay
  socket: view frames out, per-view hellos, player requests and status frames in; the first status after every
  connect asks for a
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
  `encounter.fog.exploredBy` (base64 bitset per combatant id, on disk one PNG mask each) at most once per second.
  `startDmPublisher(transports)` computes only views some transport has receivers for; a character's fog is
  composed from `sources` once per tracker result. It sends the map to all watched views, each view's encounter and
  fog on change, the full state of the requested views to one transport on its resend request. Cost
  (`pnpm tsx tools/bench-visibility.ts`, sample encounter with 2 PCs, 2 cells per square): visibility about 1.1 ms
  (1.0 ms before per-source results), party fog 0.04 ms, each connected character view +0.06 ms; at 8 cells per
  square 15-16 ms, 0.6 ms and +1 ms. The Play page feeds `useDmCameraStore` (camera),
  `useFogViewStore.showFogToDm` (fog mode) and `fogBrushPointer` (reveal/hide brush, both from the canvas Fog
  menu); "Reset explored" forgets one character's or everyone's explored cells.

## Campaign tools

- Campaign page (`CampaignDetail` in `src/ui/library/CampaignLibrary.tsx`): tab bar under the header (Encounters ·
  Party · Journal · People & places · Quests · Calendar, `CAMPAIGN_TABS`/`TAB_BODIES`; a campaign without a party
  opens on Party), each tab's primary action inside its
  body. Tabs live in `src/ui/campaign/` and share `useCampaignDocs`, `NotesEditor` (Write/Preview, saves 800 ms
  after typing, on blur and on close), `EncounterLinks` and `NameDialog` (`campaignUi.tsx`). Markdown preview:
  `src/ui/components/Markdown.tsx` (headings, lists, quotes, code, bold, italic; React elements only, never HTML;
  links are shown, not followed).
- Files: `CampaignFiles` (`src/data/campaignFiles.ts`) per campaign: `list`/`load`/`save` (stamps `updatedAt`)/
  `remove`/`newId` for the kinds `JOURNAL`, `CAST`, `QUESTS`; `importPicture`/`removePicture`/`pictureRef` for
  people and places; `loadCalendar` (null without one)/`saveCalendar`.
- Journal recorder (`src/state/journalRecorder.ts`, started in `DmApp`): diffs consecutive states of the running
  encounter (`notableEvents`: round 0 → 1 starts combat, back to 0 ends it, a combatant reaching 0 HP falls, new log
  entries of kind `xp`, `loot`, `death`) and appends them via `appendToJournal(campaignId, lines, encounterId)`:
  under `## Timeline` of the current session (`currentSession`: newest entry when from today or under 12 hours
  old), else in the next session's new entry; appends run one after another.
- Calendar: `useCalendarStore` (`src/state/calendarStore.ts`, `startCalendarSync` in `DmApp`) holds the running
  encounter's campaign calendar (null without one); the Scene's time of day reads `minuteOfDay(calendar)` and writes
  `setCalendarTimeOfDay(minute)`. `saveCampaignCalendar` keeps the store in step with the Calendar tab.
  Arithmetic: `toMinutes`/`fromMinutes`, `advanceCalendar`, `ADVANCE_STEPS` (short rest 1 h, long rest 8 h).
- Random tables: library kind `table`, Compendium tab Tables (`TableLibrary`/`TableActions`,
  `src/ui/library/TableLibrary.tsx`). `rollTable(tableRef)` (`src/state/randomTables.ts`, by id or name) rolls on
  the library listing, `[name]` references resolve there (8 levels at most, so loops end in an error);
  `useRandomTables()` lists them for pickers.

## LAN player view

- `src-tauri/src/lan.rs`: axum server on `0.0.0.0:<settings.lan.port>`, commands `lan_start(port, links)`,
  `lan_set_links(links)` (token → view, checked like the relay's patterns), `lan_stop()`, `lan_status()` →
  `LanInfo {port, hosts, dmUrl, players}` (`hosts`: base URLs, LAN addresses first, localhost last). Each start
  generates a DM token (in `dmUrl`, accepted from loopback only); player tokens are the links' keys.
- Routes: `/player.html?token=` (sets an `/asset`-scoped cookie with that token so relative `.gltf` resources load),
  `/assets/*` (Vite bundle, public), `/asset/{area}/{path}?token=` (images and models only, path stays inside the
  storage root via `storage::resolve`; the canonical path below the canonical root decides, so case, `./`, trailing
  dots, 8.3 short names and links cannot reach a DM-only file; documents are never served, nor the PNGs inside
  campaign folders (fog masks) except a campaign's `handouts/` and `imported-assets/`, or `terrain.png`, nor anything
  in `history/`; a single `Range: bytes=` request gets 206 or 416 with `Accept-Ranges: bytes` via `byte_range`,
  mirroring the relay's `byteRange`), `/ws?token=` (relay). `lan_stop` waits at most 2 s for open responses, then
  aborts the server task. The DM socket speaks the internet relay's view frames and status frames (see below); a
  player gets only frames of its
  link's view, and only the player messages `rebuild_player_message` accepts pass, rebuilt and at most 10 at once
  then one per 500 ms (more are dropped); any other player message closes its socket. Changed links close the
  sockets of withdrawn tokens with `RELAY_LINK_REVOKED` and of reassigned ones with 1013.
- Bundle files come from `app.asset_resolver()` (`src-tauri/src/frontend.rs`): release builds embed `dist/`; dev
  builds (devUrl set) read `dist/` from disk, so run `pnpm build` before testing the LAN view under `pnpm app:dev`.
  For player-code work, open `http://localhost:1420/player.html?token=<t>&ws=ws://127.0.0.1:<port>/ws` on the Vite
  dev server instead.
- DM side: `useLanStore` (`src/state/lanStore.ts`) holds the DM's `ViewSocketTransport`, takes the player count
  from its status frames and pushes `linkTable` whenever the links change; `DmApp` adds the transport to
  `startDmPublisher`. UI: `LanControls` (`src/ui/shell/LanControls.tsx`) in Settings > Players > LAN and in the
  rail's Players popover (start/stop, address, `PlayerLinks`: view select, link, copy, QR code via `uqr`, New link);
  the port is under Settings > Players > LAN > Advanced.
- Browser client: `player.html?token=` → `src/app/player.tsx` sets `useAppStore`'s repository to a read-only
  `LanStorage` (`src/data/lanStorage.ts`, `assetUrl` → `/asset/...`) before rendering `PlayerApp`.

## Internet relay

- The DM app connects out to a relay on a server the DM controls; the relay only receives what the player filter
  already produced. Contract shared by both sides: `src/sync/relayApi.ts` (`RELAY_API_VERSION` 4, routes, limits,
  file type allowlists, schemas, view frames); player messages are validated and rebuilt by `rebuildPlayerMessage`
  (`protocol.ts`) and rate-limited like on the LAN server, and DM messages pass unparsed behind their view list, so
  sync protocol bumps need no relay redeploy unless players send something new.
- View frames on the DM socket: `<view>[,<view>...]\n<message>`; DM → relay goes to the players of those views,
  relay → DM carries a player's rebuilt message under its view. Status frames `{relay: {players, views}}` (players per
  view) go to the DM on connect and whenever players or links change.
- Relay (`server/`, Node 20+, `ws`): `createRelay({dmKey, dataDir})` (`relayServer.ts`), entry `relay.ts` (env
  `FOGWARDEN_DM_KEY`, `FOGWARDEN_RELAY_PORT`, `FOGWARDEN_RELAY_HOST`, `FOGWARDEN_RELAY_DATA`), bundled by `pnpm build:server`
  (`tools/build-server.ts`, esbuild) into `dist-server/relay.mjs`. Routes: `/health`; `/?t=<token>` and
  `/player.html` (uploaded player page, sets the `/asset` token cookie); `/assets/*` (uploaded bundle, public);
  `/asset/{area}/{path}?token=` (uploaded assets); `/ws` (players with `?token=`, the DM with the subprotocols
  `fogwarden-dm` + DM key, never in a logged URL). Player tokens are the keys of the links table. DM API with
  `Authorization: Bearer <key>`: `GET /api/session` (`{api, players}`), `PUT /api/links` (replaces the token → view
  table, kept in `dataDir/links.json` across restarts; withdrawn tokens' sockets close with `RELAY_LINK_REVOKED`,
  reassigned ones with 1013), `POST /api/missing` (which upload targets differ by SHA-256), `PUT
/api/asset/{area}/{path}` and `PUT /api/bundle/{path}` (hash header checked, 1 GiB limit `RELAY_MAX_UPLOAD_BYTES`,
  nginx `client_max_body_size 1024m`, extension allowlist,
  `containedPath`, atomic rename). The relay pings every 30 s and drops players more than 16 MiB behind.
- Player bundle: `tools/vite-relay-plugin.ts` copies `relay.mjs` into `dist/` (so `pnpm build` fails without
  `build:server`, which `pnpm build` runs first) and writes `dist/player-bundle.json` (every built file except
  `index.html` and source maps, the player page last, with SHA-256). On connect the app reads them through the
  `frontend_file` command and uploads what changed, so app updates never need a relay redeploy.
- DM side: `useRelayStore` (`src/state/relayStore.ts`: `link`, `players`, `baseUrl`, `lastError`, `transport`)
  and `src/sync/relayClient.ts`: `fetchRelaySession` (refuses a relay of another API version with an "update the
  server" or "update the app" message), `pushRelayLinks` (on connect and whenever the links change),
  `RelayUploader` (`ensure(refs)` uploads assets plus glTF/GLB side files found by `modelSideFiles`, remembered per
  connection, and refuses `history/` paths; `uploadBundle`) and `RelayTransport` (a `ViewSocketTransport` whose
  sends wait for the assets `collectAssetRefs` finds anywhere in the payload). `DmApp` adds the transport to
  `startDmPublisher`. Plain `http://` URLs are refused except for loopback (the DM key would travel unencrypted).
- Setup (`src-tauri/src/deploy.rs`, `russh` with `ring`): templates `src-tauri/src/deploy/install.sh` and
  `fogwarden-relay.nginx.conf` filled with the validated domain, email and port; commands `deploy_write_files(folder,
setup)`, `deploy_host_key(host, port)` (`SHA256:` fingerprint, confirmed and stored in
  `settings.remote.knownHosts` by the UI), `deploy_run(request, events)` (uploads to `~/fogwarden-relay-setup/` with
  `cat` over exec, runs the script as root, directly or via `sudo`, streams lines to a `Channel`, returns the DM key
  from the `FOGWARDEN_DM_KEY=` line, which never reaches the log). The script installs Node 22 (NodeSource) when
  needed, user and systemd unit `fogwarden-relay`, `/etc/fogwarden-relay/relay.env` with the DM key (kept on re-runs),
  the nginx site (WebSocket upgrade on `/ws`) and, given an email, a certbot certificate.
- UI: `src/ui/server/OnlineSection.tsx` in Settings > Players (`src/ui/settings/PlayersSection.tsx`): Online (URL,
  DM key, connect, connection test via `/health` + `/api/session`, link + QR) and _Set up a server…_ (dialog with
  domain, email, relay port and `DeployDialog`). Settings `remote` (schema
  v5): `url`, `dmKey`, `setup`, `ssh` (no password), `knownHosts`.

## Player devices

What players do on their own screens (player window, LAN and relay links); all of it reaches the DM through the
transports' `onPlayerRequest`, tagged with the view of the link it came over.

- Player requests (`PlayerRequest` in `protocol.ts`): `roll` (dice text, mode, label), `point` (map point), `move`
  (own combatant id, map point). `playerMessageSchema` bounds every field (dice `PLAYER_DICE_PATTERN`, label 40
  characters, coordinates within ±1,000,000 ft); `rebuildPlayerMessage(text, view)` additionally refuses rolls and
  moves from the party view and moves of another view's token. The LAN server (`rebuild_player_message` in
  `lan.rs`) and the relay apply the same rules and the same rate limit (`RateLimit`, `playerRateLimit`).
- DM side: `startDmPublisher` passes requests to `handlePlayerRequest` (`src/sync/playerRequests.ts`): a roll is
  rolled with `rollDice`, logged ("Thorin rolls Perception 1d20+3: …", no undo step) and answered to that view as
  `rolled`; a point becomes a ping; a move is checked by `checkPlayerMove` (encounter `playersMoveTokens`, own
  visible placed player character, map present), snapped like a DM drag (`snapTokenPoint`, height above the ground
  kept), measured with the diagonal rule and applied as one undo step "Move <name>" with a log line; a refused move
  is a notice for the DM. Errors go to `reportError`.
- Sheet: a character's view gets `PlayerEncounter.sheet` (`playerSheet`: exact hit points, AC, speeds and spell
  slots of the library creature via `creatureResources`, conditions, concentration, death saves at 0 HP) and, while
  the encounter allows moves, `ownMoves` (the diagonal rule). `PlayerSheetPanel` (`src/ui/player/PlayerSheet.tsx`)
  shows it as a side panel, on screens below 700 px as a bottom sheet, with a dice roller that checks the text
  like the DM before sending. `TurnBanner` shows while `activeCombatantId` is the sheet's character and vibrates
  phones (`navigator.vibrate`) once per turn.
- Pings: `usePingStore` (`src/state/pingStore.ts`, 3 s each) on both sides, drawn by `PingLayer`
  (`src/render/pings/`, every mode but the editor). The DM pings with Alt+click on the Play canvas; players hold the
  map 500 ms without moving 8 px (`playerPointer`, `src/ui/player/playerPointer.ts`). The publisher sends every new
  ping to `pingAudience(at, from, views, fogOf)`: the view that pointed and every view whose fog cell there is not
  unknown (no fog: every view).
- Own token moves: with `ownMoves` set, the player drags their token (`usePlayerPointer.drag`, ghost and distance in
  `PlayerDragOverlay`) and the drop is sent as `move`; the token moves when the DM's encounter update arrives. The
  switch is "Players move their own tokens" in Play's Table tab (`PlayerMovesToggle`, undoable).
- Handouts: files in `campaigns/<id>/handouts/` (`src/data/handouts.ts`: `listHandouts`, `importHandout`; kinds by
  extension in `src/core/handouts.ts`). Show to players in Play's Table tab (`ShowPanel` in `ShowMenu.tsx`, rendered
  by `TableTab`) picks one, an audience
  (everyone or one view) and shows or hides it through `useHandoutStore`; videos can also start Atmosphere's
  interlude. The publisher sends `handout` (text inline, pictures and videos as assets, which the relay transport
  uploads) to the audience and null to the other views; `HandoutOverlay` shows it until the player closes it, and a
  new show (new id) opens it again.

## UI registries

- Compendium tabs: `COMPENDIUM_TABS` (`src/ui/pages/CompendiumPage.tsx`: id, label, icon, library kinds for load
  problems, `Body`, optional `Actions` shown after the tab bar, so switching tabs never moves a tab) and the
  `CompendiumTab` union in `appStore.ts`.
- Routes: `Route` union in `src/state/appStore.ts` + `Page` switch in `src/ui/DmApp.tsx`.
- Home (`src/ui/home/HomePage.tsx`, default route): Continue card (`settings.lastEncounter`), recent maps and
  encounters, `FirstSteps` (progress in `settings.onboarding`, `completeOnboardingStep(step)`; step `srdData` opens
  the D&D 5e API import and is done when an import wrote something), drop zone. `openSampleEncounter()`
  (`onboarding.ts`) calls `ensureSampleCampaign(repository)` (`sampleCampaign.ts`). Before building encounters it
  imports the sample's monsters (`SAMPLE_MONSTER_INDEXES`) with `importApiMonsters`, which skips present ones; a
  failed download becomes an error asking to check the internet connection. While campaign `sample-campaign` does
  not exist it creates all of it (notes, journal, quests, people and places, calendar; encounters
  `sample-goblin-ambush`, `sample-night-vigil`, `sample-midnight-rite` built in `sampleContent.ts`; `campaign.json`
  written last so a failed run starts over); afterwards it only recreates a missing `sample-goblin-ambush`. Then it
  opens the goblin ambush. A shipped map's Delete (`MapLibrary.tsx`) turns its pack off after a confirm naming the
  rest of the pack.
- New map wizard: `openNewMapWizard(files?)` (`src/ui/library/NewMapWizard.tsx`, host in `DmApp`); image → grid
  (`calibrateFromSquare` from a drag or two clicks, SVG overlay in image pixels) → `createCalibratedMap`
  (`mapImport.ts`) saves the map already calibrated. A Universal VTT file skips the grid ("Check grid" opens it with
  the file's calibration), takes an optional `.dam` (picked or dropped with it), shows the Objects step when the
  project has objects and summarises walls, doors, windows and lights. File drops use `useFileDrop`
  (`src/ui/library/fileDrop.ts`, `isMapSourceFile`, `isDamFile`).
- Form fields: `src/ui/components/fields.tsx` (`NumberField`, `TextField`, `SelectField`, `CheckboxField`,
  `SliderField`, `ColorField`, `Field`); errors: `useAppStore.getState().reportError(error)`.

## Conventions

See `~/.omp/agent/RULES.md` and `PLAN.md` §11. In short: one `return` per function (error `throw`s allowed), no
`continue`, `break` only in `switch`, lines ≤ 120, `//` comments ≤ 80 columns and explain _why_, no swallowed errors,
no stubs/TODOs. Format with `pnpm format`; check with `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Sound and atmosphere

- Pure rules in `src/core/atmosphere/`: `playlist.ts` (`MusicState`, `activeMood(atmosphere, inCombat)`,
  `followMood`, `nextTrack`, `setPlaying`, `musicPosition`, equal-power `crossfadeGains`), `ambient.ts`
  (`distanceToPolygon`, `ambientGain`: full inside, `(1 - d/radius)^2` beyond, nearest listener;
  `ambientListeners`: the viewing character, or every placed PC for the party), `timeOfDay.ts` (`dayPhase`,
  `daylight`, `sceneLightLevel`: the darker of map and daylight, `sceneMinute`: the calendar wins),
  `soundLibrary.ts`, `media.ts` (`isVideoAsset`, audio and video extensions).
- Scene state per encounter: `encounter.atmosphere` `{mood, combatMood, minute, weather}`; the music follows
  `activeMood` (combat = `round > 0`), so Start/End combat switch it without hooks. DM runtime `startDmSound()`
  (`src/sound/dmSound.ts`, in `DmApp`) loads `useSoundStore` (`src/sound/soundStore.ts`; files via
  `src/data/soundFiles.ts` from `repository.librarySources()`) and plays through `AudioOutput`
  (`src/sound/audioOutput.ts`: media elements, 2.5 s crossfade, effects, ambient loops, blocked autoplay reported
  by `onBlocked`) at `settings.audio.volume * dmVolume`. Interludes: `startInterlude(asset)` / `stopInterlude()`
  (`src/sound/interlude.ts`, used by Show).
- Sync: `startAtmospherePublisher(transports)` (`src/sync/atmospherePublisher.ts`) sends `audio` (track, position
  at sending time, playing, master volume), `sfx`, `scene` (`minute`, `weather`) and `interlude` (with `id`, the
  DM's `startedAtMs`, so a resend of the same interlude does not restart it in `usePlayerStore`) to every view, on
  change and on resend; `view` carries `combatantId`. The player page keeps them in `usePlayerStore`;
  `PlayerSound` plays them at master × the device's own volume (`localStorage`) and computes the ambience from the
  received map, combatants and `viewCombatantId`; `InterludeVideo` shows the interlude fullscreen.
- Light: `MapView` takes `minute` (intensity from `daylight`, color `skyTint`); `startFogTracker` gives the worker
  `sceneLightLevel(minute, map.ambientLight)`. Weather: `WeatherLayer` (`src/render/weather/`) is one full-screen
  shader quad (procedural rain streaks, snow flakes, value-noise fog): one draw call and one uniform update per
  frame whatever the map size; editor views draw none.
- Video battlemaps: `useProjectionUniforms` loads `.mp4`/`.webm` images with `loadVideoTexture` (muted, looping,
  no mipmaps); `AssetImage` shows their first frame. LAN `asset_mime` and `RELAY_ASSET_TYPES` include audio and
  video; LAN (`byte_range`) and relay (`byteRange`) serve single byte ranges.

## Updates

- `tauri-plugin-updater` reads `latest.json` of the latest GitHub release (`plugins.updater` in `tauri.conf.json`:
  endpoint, public key, passive NSIS install); `tauri-plugin-process` restarts. Only the DM window has the
  `updater:default` and `process:allow-restart` permissions.
- `src/core/updates.ts`: `autoCheckDecision(settings.updates, now, playing)` → `check` | `wait` | `skip` (switched
  off or checked within 24 h: skip; Play with combat running: wait).
- `src/state/updateStore.ts`: `useUpdateStore` (`status`, `check()`, `install()`: flushes map and encounter, then
  `downloadAndInstall` and `relaunch`); check and install failures become a `failed` status with a plain message.
  `startAutoUpdateCheck()` (desktop, started in `DmApp`) decides once per app start, stamps
  `settings.updates.lastCheck` and reports a found version or a failure as a notice.
- Release: `tools/package.ts` builds with the signing key (`TAURI_SIGNING_PRIVATE_KEY*` env or
  `data-local/signing/fogwarden.key`) and writes installer, `.sig` and `latest.json` (`tools/updateManifest.ts`:
  notes = the newest `CHANGELOG.md` section, which must be headed `## <version>`, else packaging stops before the
  build; URL = asset of release `v<version>`) to `artifacts/`; release builds ship without source maps.
  `tools/set-version.ts` sets the version in `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`.
