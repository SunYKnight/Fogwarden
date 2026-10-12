# Changelog

## Unreleased

- Renamed to Fogwarden (package `fogwarden`, app id `io.github.sunyknight.fogwarden`, so the default data folder
  is now `%APPDATA%/io.github.sunyknight.fogwarden/`; relay service `fogwarden-relay` with `FOGWARDEN_*` variables,
  a relay set up before needs the setup run again). Licensed under MIT (`LICENSE`); `THIRD_PARTY_NOTICES.md` lists
  shipped content and dependency licenses and is shown under Settings > About > Licenses.
- Content packs (settings schema v7): a pack is a folder or `.zip` with `pack.json` (id, name, version, author,
  license, description, url) and the library folders. Compendium tab **Packs** lists My content and every pack with
  its counts and "overridden by …", switches packs on and off, reorders them by drag (or Alt+Up/Down), exports any
  pack (also My content) to `.zip`, removes imported packs and imports new ones (Import pack… for a `.zip`, Import
  folder… in the desktop app). My content always wins, then the packs in the shown order. Switched-off packs vanish
  from the Compendium, Maps and the Add dialog; running encounters keep their combatants and the inspector names the
  switched-off pack holding a stat block. Shipped content now comes as packs in `content/packs/` (SRD 5.1, CC0
  models, Sample map); the legacy import writes into the pack "Legacy DM Tool" and `import-statblocks.ts` takes
  `--pack <id>`. On first start, legacy imports move from `library/` into that pack and references to shipped files
  follow them (each file compared before the old one is deleted). ZIP support is built in (no new dependency).
- Compendium: the tab bar stays put on the left; each tab's actions follow it.
- Sound and atmosphere (encounter schema v4, map schema v3, settings schema v8): Play canvas toolbar **Sound**
  plays music by mood (Exploration, Tavern, Combat, Boss and your own) with crossfades, Play/Pause and Next, adds
  MP3/OGG/WAV/M4A files to a mood and one-shot effects to a sound board; Start combat switches to the encounter's
  combat mood ("In combat"), End combat back. Players hear music, effects and ambience in the player window, over
  the LAN and the relay at the DM's master volume times their own (slider in the player page corner; "Tap to
  enable sound" when the browser blocks autoplay). Editor step Areas: region kind **Sound** loops a file at full
  volume inside and fading to silence a set distance beyond, judged by the party's nearest character (in a
  character's link by that character). Map settings › Battlemap replaces the picture with another or with a
  looping MP4/WebM video (grid kept). Toolbar **Scene**: time of day (slider, Dawn/Day/Dusk/Night; follows the
  campaign calendar) dims and tints the light and darkens open maps for vision at night; weather Rain, Snow or Fog
  over DM and player views. Interlude videos play fullscreen for players (from Show). Settings › Audio holds the
  master and this window's volume. Moods and effects live in `library/sounds/sounds.json`; the relay and LAN
  serve audio and video (relay: byte ranges, uploads up to 1 GiB; run Set up a server again for the nginx limit).
- Map export: _Export…_ in a map card's menu (Maps page) and in the map editor's header saves the map, through the
  save dialog, as a 3D model (`.glb` in meters: terrain with the battlemap, walls with their materials, closed doors,
  windows and bars, room floors and roofs, props, lights optional; opens in Blender), as Universal VTT (`.dd2vtt`:
  picture, grid, sight-blocking walls, doors and windows as portals, lights, ambient light; reads back through the
  app's own importer) or as an image (`.png` cut to the grid, grid lines optional). Files go outside the app's data
  and content folders only.
- Players' devices (encounter schema v6, relay API 3: update the relay with Set up a server): a character's player
  link shows that character's sheet (hit points with temporary ones, AC, speed, conditions, concentration, death
  saves, spell slots) as a side panel, on phones as a bottom sheet, with dice the DM rolls and logs ("Thorin rolls
  Perception 1d20+3: …"); the result comes back to the sheet. When that character's turn starts the player page
  shows "Your turn" and phones vibrate. Holding the map (players) or Alt+click on the Play canvas (DM) pings the
  spot for 3 s for the DM and every view whose fog shows it. Play canvas toolbar Show: pictures, videos and text
  files from the campaign's `handouts/` folder (Add files) shown to everyone or one view, hidden again with Hide,
  closable by players; videos also play as interludes. Play header "Players move" lets players drag their own
  token: the move is snapped and measured like the DM's, logged and undoable. The LAN server and the relay accept
  these player messages only validated, for the link's own character, and at most 10 at once then 2 per second.
- Combat rules (encounter schema v5): the Add combatants dialog and the Play header rate the encounter Trivial, Easy,
  Medium, Hard or Deadly for the party (DMG 2014 thresholds and monster-count multipliers; numbers in the tooltip);
  player characters have a level (PC form, Creature tab). Area templates may carry a saving throw (ability, DC,
  damage, type, half on success); after placing one, the Areas tab lists every token inside it, rolls their saves
  with their own bonuses and applies one damage roll with resistances, immunities and vulnerabilities from the stat
  blocks as one undo step. Creature tab: timed effects (rounds, until the start or end of someone's next turn) that
  expire on Next turn with a log line, concentration with a CON save prompt (DC 10 or half the damage) on damage
  and an automatic end at 0 HP; legendary actions (reset at the creature's turn), recharge abilities (d6 rolled at
  turn start), spell slots and per-day uses read from the stat block, a lair action reminder on initiative 20;
  death saves for player characters at 0 HP (pips, roll with natural 1 and 20 rules, Stabilize, damage at 0 HP
  fails one); "Carries light" (candle, torch, lantern, Light) follows the token, lights the fog for players and is
  sent to their view. End combat opens a dialog: XP of the defeated enemies split among the player characters, and
  loot typed in or rolled on a random table, written to the log and the session journal.
- Campaign tools: the campaign page has tabs Encounters · Journal · People & places · Quests · Calendar. Journal:
  one Markdown entry per session (`journal/<date>-session-<n>.md`, Write/Preview, linked encounters with Play);
  Play appends combat start and end, fallen combatants, XP, loot and deaths to the current session under
  "## Timeline". People & places: NPCs and locations with picture, kind, tags, notes and the encounters they appear
  in (linked or named in the encounter). Quests: open, done or failed, with notes. Calendar (`calendar.json`):
  Harptos or Gregorian months, editable month names and lengths, current date and time with +10 min, +1 h, Short
  rest, Long rest, +1 day and Undo, events; the Scene's time of day follows it. All as readable files in the
  campaign folder.
- Random tables: Compendium tab Tables with plain text tables (`library/tables/<id>.txt`, one entry per line,
  `weight: text` or dice ranges like `1-3: text`, `[other table]` and `[2d6]` inside entries); Roll shows the result
  with Add to log and Add to journal. `rollTable(tableRef)` rolls for other features (End combat loot).
- Compendium images: creatures without a picture show an icon of their creature type (14 types plus swarms; icons
  by Lorc and Delapouite from game-icons.net, CC BY 3.0, credited in Settings > About) in the Compendium list and
  preview and in the Add combatants dialog; tokens without a picture show that icon in the side color with the
  combatant's number (players get it too; ad-hoc combatants keep initials). Area template rows show their shape.
- New map wizard: `.dd2vtt` exports get a separate "Dungeon Alchemist project (optional)" step to pick or drop the
  matching `.dam` (terrain and 3D objects), with Skip and Continue; a `.dam` dropped with the export is preselected.
- Map maker imports: Universal VTT files (`.dd2vtt`, `.df2vtt`, `.uvtt` from Dungeon Alchemist, Dungeondraft,
  DungeonFog, Arkenforge, MapForge) become calibrated maps with walls (joined across doors, closed loops kept),
  doors, windows, lights and ambient light, from the New map wizard (grid step skipped, "Check grid" optional,
  summary of what came along), the Home drop zone and the Maps page. Dungeon Alchemist's Foundry export imports
  per folder (Maps > Import Dungeon Alchemist folder…, desktop) as one map per floor. A Dungeon Alchemist project
  (`.dam`, version 11) adds its ground heights as terrain and places its objects as props with a model the DM picks
  per object kind (shipped CC0 stand-ins from Kenney in `content/models/cc0/`, own `.glb`/`.gltf`, or a model
  folder; kept in `library/dungeon-alchemist-objects.json`); Dungeon Alchemist's own models are never read. Errors
  name the file and the field. New desktop command `storage_read_file_text` for picked files.
- Open data formats: creatures are stat block text files (`library/creatures/<id>.txt`, a short header plus the
  stat block; any pasted stat block loads), pictures are files named after the creature id (`<id>.png`,
  `<id>.token.png`), also for shipped creatures; the portrait index `library/portraits.json` is gone. Maps keep
  their heights in a 16-bit grayscale `terrain.png` (scale in `map.json`, map schema v2), encounters live in
  folders with explored/revealed/hidden fog as black-and-white PNG masks (encounter schema v3), campaign notes in
  `notes.md` (campaign schema v2); no base64 left in the data root. Existing data folders are converted on start:
  every document is written anew, read back and compared before the old file goes; a document that fails keeps its
  old file and shows as a load problem. Shipped SRD creatures and the sample map are regenerated in the new
  formats. PNG encoder/decoder `src/core/png.ts` (no dependency) shared by app and tools. The LAN server no longer
  serves PNGs inside campaign folders or `terrain.png`.
- Player views per character: every player screen shows either one player character's sight or the party's
  (union of all vision sources). Each vision source keeps its own explored fog (encounter schema v2; the shared
  explored area of older encounters goes to every player character and vision source); the Fog menu's "Reset
  explored" asks for one character or all. Player links: one per view (Party plus each player character of the open
  encounter) with copy, QR code and "New link", on the Server page and in the Players popover; tokens are HMAC-derived
  from a secret in the settings (schema v6, also the player window's view, picked under Players > Shows), stay valid
  across restarts and work on LAN and relay. A replaced or removed link disconnects its players at once and their
  page says so. Both relays route each DM message only to the players of its views (sync protocol 2, relay API 2:
  `PUT /api/links`, view-prefixed frames, per-view player counts); **the internet relay must be updated** (run the
  server setup again), and the app refuses an older relay. The player page shows its view's name. LAN links no
  longer change on every start. `tools/bench-visibility.ts` measures the visibility and per-view costs.
- Map editor: step tabs (Ground, Walls, Areas, Light & objects) with labelled tools and their options in one tool
  bar; inspector shows only the selection or step help and layers; map settings dialog (name, grid calibration with
  pick on the map, lighting, ground); status bar with cursor position, terrain height, snapping and save state;
  hover highlight in Select, Del deletes the selection, Esc cancels/deselects, `.glb` drop places a prop; new tool
  keys (1-4 steps, letters per tool, T camera) listed in the `?` overlay.
- Play: initiative strip (turn marker, HP bars, inline initiative, drag to reorder) with an "Add combatants" dialog;
  canvas toolbar (Select, Measure, area templates, Top/3D, Fog menu with brush, radius and reset explored); turn bar
  with one-click attack rolls of the current combatant, quick damage/heal and Next turn (Space); inspector tabs
  Creature, Dice, Log, Areas; token right-click menu (damage, heal, conditions, hide, remove); "n not on map" chip
  places unplaced combatants one after another; undo/redo (Ctrl+Z/Ctrl+Y) for moves, HP, conditions, initiative,
  areas and doors.
- Home page (start screen): Continue card for the last encounter, the 6 most recent maps and encounters, first
  steps (data folder, legacy import, map from an image, sample encounter) and a drop zone for battlemap
  images and `.txt` stat blocks.
- New map wizard (image, grid, done): live grid overlay, drag one square or click two corners, sliders for size,
  offset and rotation; maps are saved calibrated. Opens from Home, the Maps page's "New map" and image drops.
- Maps page: search, map cards with shipped/edited badges, Edit/Duplicate/Delete buttons and context menu.
- Shipped sample map "ruined chapel" (generated by `tools/build-sample.ts`, CC0) and a sample encounter with four
  SRD goblins and two example PCs. Settings schema v3 stores the first steps progress.
- Remote play over the internet: new **Server** page (rail, below Play) with the LAN controls, a relay connection
  (URL, DM key, connect/disconnect, connection test, player count, player link with copy and QR code) and server
  setup (download `install.sh` + nginx site + `relay.mjs`, or deploy via SSH with key or password, host key
  confirmed on first connect, streamed log). The relay (`server/`, built to `dist-server/relay.mjs` by
  `pnpm build:server`, part of `pnpm build`) is a Node 20+ service behind nginx; the app uploads the player page,
  map images, token images and models (glTF side files included) and publishes filtered player data to it. The
  Players popover shows the remote player count. Settings schema v5 stores the relay URL, DM key, setup inputs, SSH
  login (no password) and trusted host keys. New dependencies: `ws` (MIT), `esbuild` (MIT, build only),
  `@types/ws` (MIT, types), Rust `russh` 0.64 (Apache-2.0, `ring` backend); Rust minimum version 1.89.
- Token visuals: in the 3D view tokens stand upright as cardboard-style standees (picture cropped onto a card in a
  side-colored frame, yellow for the current turn and white when selected, on a side-colored base, height by
  creature size, turned towards the camera); tokens without a picture show initials. Same look in the DM view,
  player window and LAN/remote players; Settings > Rules switches back to discs (settings schema v4). Tokens of one
  picture share one texture (scaled to at most 1024 px); geometry and materials are shared by all tokens.
- Creature portraits: shipped creatures get pictures through the portrait index `library/portraits.json`
  (creature editor Image/Token fields store there when nothing else changed); tokens pick them up live (combatant
  token > creature token > creature image > portrait index), also for combatants already in an encounter.
  Compendium action "Attach portraits from folder…" matches pictures to creatures by name or id (case, accents,
  punctuation, `legacy--` prefixes ignored; `-hotd` suffixes stay distinct; "Werewolf" fits all werewolf forms),
  previews matched and unmatched files, copies the pictures into the data root and replaces existing images only
  when ticked. The compendium shows portraits as list thumbnails and above the stat block.
- Readable ids: new creatures, maps, area templates, campaigns and encounters (created, duplicated or imported)
  get their id, and so their file or folder name, from their name (`goblin-boss`, then `goblin-boss-2`; at most 60
  characters; Windows device names such as `con` get a number). Renaming keeps the id; existing documents keep
  their ULID ids.
- Map imports store battlemaps larger than the 3D view's 4096 px texture limit reduced to it (aspect kept, grid
  calibration scaled along; JPEG, PNG when the picture has transparency), in the New map wizard (also Universal VTT)
  and the Dungeon Alchemist folder import; the wizard names both sizes. A 15600 × 14700 px export no longer makes
  every player download and decode 37 MB. The original file stays untouched. New desktop command
  `storage_read_file_bytes` for picked files.
- Dungeon Alchemist objects step: a map picture beside the table marks every object of the hovered or selected
  kind; clicking a row selects it. Columns "ft/unit" and "Turn" are now "Size" (tooltip explains the scale) and
  "Rotate". The folder import checks up front that each project fits its lowest floor.
- Stat block import parses while typing (300 ms after the last key) and shows the stat block or the failing line
  live; the "Check" button is gone.
- Import from the old WPF tool runs in the app (First steps "Import…", Settings > Data "Import from the old WPF
  tool…", desktop): pick the `240722_DnD_DMTool_Data` folder, see the counts of creatures, maps, area templates and
  pictures found plus what is skipped, then import with progress and a summary of skipped files and problems by
  file name. A wrong folder says which folders are missing. Pictures are found regardless of case. App and
  `tools/import-legacy.ts` share one importer (`src/data/legacyImport.ts`); the terminal instructions are gone.

## 0.1.0

First version of the TypeScript/Tauri app replacing the WPF proof of concept `240722_DnD_DMTool`.

- Map editor: grid calibration, terrain sculpting (raise, lower, smooth, flatten, ramp, terrace, noise), vector
  walls with doors, windows, portcullises and arrow slits, rooms with peeling roofs, regions, lights with shadows,
  glTF props; battlemap projected onto all surfaces; undo/redo and autosave.
- Encounters: initiative tracker, HP/temp HP, conditions, attack and dice rolls with log, tokens, area templates,
  door states, measuring.
- Libraries: maps, creatures (editor, stat block, text import), marker templates, campaigns.
- Player view with fog of war (line of sight, light levels, darkvision, blindsight, tremorsense, truesight, magical
  darkness, DM reveal/hide) in a second window or in a LAN browser with a per-session token.
- Shipped SRD 5.1 creatures and area templates; importers for the legacy data folder and raw stat block text.
