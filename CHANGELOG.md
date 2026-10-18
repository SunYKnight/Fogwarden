# Changelog

## 0.1.3

### Added

- Linux: Fogwarden runs on x86_64 Linux (glibc 2.35+, e.g. Ubuntu 22.04) as a self-updating AppImage or a `.deb`.
  Dungeon Alchemist is also found in Linux Steam libraries (native, `~/.local/share/Steam` and Flatpak).
- Releases are built and published by GitHub Actions for Windows and Linux; every push and pull request to
  `develop` and `main` runs the type check, lint and tests.

### Fixed

- Journal timeline times are always written as 24-hour `HH:MM`; they followed the system language before
  (e.g. `05:10 PM`).

## 0.1.2

### Fixed

- A settings.json the app cannot read (damaged, or written by a newer Fogwarden, e.g. after going back to an older
  version) is no longer replaced by default settings on the next change, which lost the player link secret, pack
  order and graphics choices. Changes are refused with a notice until the file is fixed or restored under Settings
  › Data › Version history.

## 0.1.1

### Added

- Play › Encounter tab: **Notes** for the encounter (setup, tactics, treasure; Markdown with Write/Preview), seen
  only by the DM. Encounter notes were stored before but not shown anywhere.
- Settings › Graphics › Advanced: **texture size** (1024/2048/4096 px for battlemaps, token pictures and 3D model
  textures; exports keep full size, with the graphics memory it saves), **shadow quality** (256/512/1024 px shadow
  maps), **antialiasing** on/off and a **frame rate limit** (15 or 30 fps). Low uses 15 fps, no antialiasing and
  1024 px textures; Medium 30 fps and 2048 px.

## 0.1.0

First release. Fogwarden is a Windows desktop app for a 5e Dungeon Master:

- Turn a 2D battlemap into a 3D scene: calibrate the grid, sculpt terrain, draw walls, doors, windows, rooms and
  lights, place 3D models; the picture stays projected onto every surface.
- Import maps from Dungeon Alchemist, Dungeondraft, DungeonFog and other Universal VTT tools with their walls, doors
  and lights; export maps for Blender or other VTTs.
- Run encounters: initiative, hit points, conditions, attacks and dice with a log, area templates with saves, timed
  effects, concentration, death saves, difficulty, XP and loot.
- Show players a fog-of-war view on a second screen or in browsers on the local network, one view per character,
  with their sheet, dice, pings, handouts, music and weather.
- Keep campaigns: party, a session journal that Play fills in, people and places, quests and an in-game calendar.
- Look up creatures, player characters, items, spells, area templates and random tables; get the SRD 5.1 from the
  D&D 5e API and your characters and books from Aurora Builder.
- Everything is plain files in a data folder you choose, with a 30-day version history; the app updates itself from
  GitHub Releases.

### Added

- **Home and navigation**: Home is the current campaign's dashboard (Continue, Next session with unfinished
  encounters, open quests and a quick journal note, Recent maps; Import… or drop files anywhere). Its first steps
  follow a new DM's order: data folder, SRD rules content, player characters, campaign, map from an image; the
  sample encounter is optional. Rail: Home · Compendium · Campaigns · Maps · Play, with Search, Players and Settings
  at the bottom. Ctrl+K finds every command, creature, spell, item, map, campaign and encounter by name.
- **Map editor**: step tabs Ground · Walls · Areas · Light & objects with labelled tools; terrain sculpting (raise,
  lower, smooth, flatten, ramp, terrace, noise); walls with doors, windows, portcullises and arrow slits; rooms with
  floors and roofs that peel away in play; regions (hazards, notes, light, sound); lights with shadows; glTF/GLB
  props (drop them on the canvas). Map settings: grid, lighting, ground, and replacing the battlemap with another
  picture or a looping MP4/WebM video. Undo/redo, autosave, status bar, `?` lists the keys.
- **New map wizard**: image → grid (drag one square or click two corners) → done, from Home, the Maps page or a
  dropped image. Battlemaps above 4096 px are stored reduced, calibration scaled along; the original stays untouched.
- **Map imports**: Universal VTT (`.dd2vtt`, `.df2vtt`, `.uvtt` from Dungeon Alchemist, Dungeondraft, DungeonFog,
  Arkenforge, MapForge) with walls, doors, windows, lights and ambient light; Dungeon Alchemist Foundry export
  folders as one map per floor. A Dungeon Alchemist project (`.dam`) adds ground heights, the ground level's
  buildings (rooms, storey-high walls on the true outlines, doors, windows, pillars) and its objects as props with a
  model chosen per object kind. With Dungeon Alchemist installed, kinds get its names and sizes; **Auto-assign
  stand-ins** picks shipped CC0 models, **Get realistic models…** downloads 23 CC0 models from Poly Haven. Upper
  floors are not imported.
- **Map export** (Maps page or the editor's ⋯ menu): 3D model (`.glb` in meters, opens in Blender), Universal VTT
  (`.dd2vtt`) or image (`.png`, grid optional).
- **Play**: initiative list with Previous / Next turn, Roll initiative and Start combat; Add combatants (library,
  Add party, player characters, by hand) rates the encounter Trivial to Deadly (DMG 2014). A creature dock under the
  map shows the selected creature: HP, AC, Damage / Heal / Temp, conditions and tabs Actions · Effects · Token ·
  Stats · Notes. Attack rolls show every die and modifier and ask for the target ("vs AC 15: hit"). Timed effects,
  concentration saves, legendary actions, recharge abilities, spell slots and daily uses from the stat block, lair
  action reminder, death saves, carried lights, movement this turn by the diagonal rule. Area templates may carry a
  saving throw; the Areas tab rolls the saves and applies damage with resistances. End combat splits XP and logs
  loot (typed, rolled on a table or a random item). Monsters get random numbers ("Goblin 37"). **Change map…** gives
  an encounter another map. Undo/redo for moves, HP, conditions, initiative, areas and doors.
- **Doors and tokens**: doors and windows are outlined on the DM's map; click opens or closes, Shift+click locks.
  Tokens are discs in the top view and upright standees in 3D (Settings > Rules switches); creatures without a
  picture show a creature type icon with their number. Players see health as the name tag's colour, not as HP bars.
- **Player view**: player window on a second screen (Esc closes it) and browsers on the local network (link and QR
  code). Each link shows the party's view or one character's: line of sight, light levels, darkvision, blindsight,
  tremorsense, truesight, magical darkness, explored areas per character, DM reveal and hide. Links stay valid
  across restarts; party members keep theirs for the whole campaign. A character's link shows its sheet (HP, AC,
  conditions, death saves, spell slots) with dice the DM rolls and logs, a "Your turn" banner, pings (hold the map;
  the DM Alt+clicks), dragging the own token when allowed, and handouts (pictures, videos, text).
- **Sound and atmosphere**: music by mood with crossfades (combat mood on Start combat), a sound board, sound regions
  that fade with distance, time of day following the campaign calendar, weather (rain, snow, fog) and fullscreen
  interlude videos. Players hear it at their own volume.
- **Campaigns**: tabs Encounters · Party · Journal · People & places · Quests · Calendar. Play writes combat start
  and end, fallen combatants, XP, loot and deaths into the session journal. Harptos or Gregorian calendar with
  rests and events. A campaign exports to one `.zip` with the My content maps, creatures and pictures it uses (packs
  are named, not copied) and imports as a replacement or a copy. "Try the sample encounter" builds the sample
  campaign "The chapel in the woods".
- **Compendium**: tabs Creatures, Players, Items, Spells, Area templates and Tables, with filters, source badges and
  pictures. Creature editor and stat block; stat block import from text, checked while typing; pictures from the D&D
  5e API or from a folder, matched by name. Random tables are text files with weights, dice ranges and rolls on
  other tables.
- **D&D 5e API import**: monsters, spells, spell area templates, magic items, equipment and, optionally, the
  monster pictures from dnd5eapi.co (SRD 5.1) into the pack "D&D 5e API (SRD 5.1)"; each part has a checkbox,
  progress and Cancel.
- **Aurora Builder import** (desktop): player characters with AC, HP, saves, skills, attacks, spell slots and
  portrait computed like Aurora, items, spells and the portrait library into the pack "Aurora Builder"; only ticked
  parts are replaced. Import again after a level-up.
- **Content packs** (Settings > Content): folders or `.zip` files with `pack.json`; switch packs or single kinds
  on and off, order them, export, import and remove. **Hide duplicates** keeps one entry per name from the highest
  pack. Shipped packs: five SRD 5.1 area templates, CC0 stand-in models, the sample map.
- **Data folder**: plain files (stat block text, Markdown, JSON, PNG heightmaps and fog masks) named after the
  document (`goblin-boss.txt`) in a folder you choose, e.g. a synced one. Before the app changes or deletes a file it
  keeps the previous version for 30 days (at most 2 GB); Settings > Data > Version history… restores it.
- **Settings**: one section at a time (Data · Players · Graphics · Audio · Rules · Content · About). Graphics presets
  (lights with shadows, resolution, prop shadows) for slow graphics cards.
- **Updates**: Settings > About checks GitHub Releases (also once a day on start, waiting while combat runs) and
  installs signed updates after saving open work.
- **Online play** over the internet through a relay on your own server (set up over SSH) is built but hidden in this
  release until it has been tested against a real server.

### Changed

- Replaces the WPF proof of concept `240722_DnD_DMTool`; its data folder is not imported.
- Release tooling: `pnpm package` refuses a changelog whose newest section is not the released version,
  `pnpm set-version` also bumps `src-tauri/Cargo.lock`, and release builds ship without source maps.

### Fixed

- Closing the DM window saves pending map and encounter edits first; a failed save or a declined "discard changes?"
  keeps the window open. Leaving the map editor after a failed save keeps the map open.
- Autosaves no longer overlap or mark the next map's or encounter's edits as saved; explored fog is no longer lost.
- Campaign notes, journal, people and places, quests, party and campaign name no longer lose an edit to another
  field's save; failed note saves are retried. Calendar Undo, Set date, Rest and double clicks behave.
- Clicking Create, New session, Duplicate, New template or "Save and edit" twice no longer creates two of anything.
- Fields edited while a creature saves are kept; invalid damage dice no longer crash the creature editor.
- A broken `settings.json` or `library/portraits.json` shows an error and uses defaults instead of hanging on
  "Loading…"; a map or encounter that fails to load offers a way back.
- If the chosen data folder is missing or `bootstrap.json` is broken, the app starts with the default data folder
  and says so.
- Saved files are flushed to disk before they replace the old version; saving, history and data folder copies no
  longer freeze the windows; "Copy data root" keeps the history's shared contents shared. Command-line tools keep
  replaced versions in the history and refuse to write into `history/`. Interrupted file layout conversions are
  redone; failed pack or campaign imports keep their verified staging copy.
- Pack and campaign archives that unpack larger than stated, overlap, exceed 2 GiB or have names Windows cannot
  store are refused.
- LAN: DM-only files (fog masks, heightmaps, version history) can no longer be fetched through other spellings of
  their path; imported campaign pictures and models reach players; audio and video play on iPhone and iPad;
  stopping the server no longer hangs.
- The player window can only read the data folder; it cannot call the DM's storage, history, LAN or deploy
  commands.
- Every party member has a working player link, also outside the open encounter and after a restart. Reconnecting
  devices no longer restart interlude videos or make other devices download the map again. A player's unreadable
  dice become a notice to the DM. Link tables pushed to the LAN server and the relay always end with the newest.
- Relay: oversized or malformed player frames no longer crash it; withdrawn links can no longer act while closing;
  disconnecting while connecting really cancels.
- The players' map no longer flashes blank when the DM opens a secret door or hides a combatant.
- Keyboard shortcuts no longer act behind dialogs and menus, and a held key no longer repeats them; dialogs keep
  focus inside, Enter confirms, Esc closes only the innermost one.
- Stat block import, calendar editor, random tables, glTF, Aurora and heightmap imports report bad input instead
  of misreading it or crashing; glTF files needing Draco, meshopt or KTX2 decoders are refused with a message.
- Roofs no longer peel away in top view unless the camera or a token is inside; token name labels no longer
  overlap; a light with no range no longer lights its own square. Sculpting no longer rebuilds walls, rooms and
  lights on every dab; oversized grids are refused instead of exhausting memory; a video battlemap that cannot play
  releases its decoder.
- Dragging across one grid square calibrates the grid; sliders and colour pickers make one undo step per drag.
- Combat: removing the combatant whose turn it is, when last in the order, starts the next round at the top;
  spawned combatants follow creature picture changes; ended fights show "Ended · N rounds".
- Imports: the Dungeon Alchemist folder import waits for its object choices and keeps maps imported before a
  failing floor; an interrupted Poly Haven download is fetched again; a WebP replacement battlemap works.
- Lists no longer show an older listing that finished loading late; random table Revert shows the pack's entries.
- Wording and singular counts ("1 player"), one accent button per screen, list rows selectable with Enter or
  Space, and screen reader labels throughout; underscores inside words no longer turn into italics; a crashing
  dialog shows its error instead of blanking the window.
