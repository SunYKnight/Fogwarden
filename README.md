# Fogwarden

Fogwarden is a desktop app for a 5e Dungeon Master: turn 2D battlemaps into 3D scenes, run encounters, and show
players a fog-of-war view on a second screen or in any browser on the local network.

- **Map editor**: calibrate the grid to the battlemap image, sculpt terrain, draw walls with doors and windows, rooms
  with roofs, regions, lights and imported Blender models (`.glb`/`.gltf`). The image is projected from above onto
  every surface, so the top view still looks like the original map. Roofs do not yet block sight or light from above
  in the players' fog.
- **Encounters**: initiative, HP, conditions, attack and dice rolls with a log, tokens on the map, area templates,
  doors, measuring; encounter difficulty, area saves with resistances, timed effects and concentration, monster
  resources (legendary, recharge, slots), death saves, carried torches, XP and loot at the end of combat. Play's
  **Change map…** gives an encounter another map.
- **Libraries**: monsters (stat blocks, also imported from text), player characters, items, spells, area templates,
  maps, random tables (names, loot, rumours as editable text), a picture library and campaigns. The app ships no
  monsters: **Import from the D&D 5e API** in the Compendium brings the SRD 5.1 monsters, spells, items and
  equipment; Aurora Builder characters (and optionally its items, spells and portraits) import into a local pack.
- **Campaigns**: a party, encounters, a session journal that Play fills with combat events, people and places with
  pictures, quests, and an in-game calendar with rests. Put your group's characters into the campaign's **Party**
  tab (Compendium > Players lists them; Import from Aurora Builder fills it); **+ Add > Add party** then adds them
  to each encounter. Campaigns export to one `.zip` with the maps, creatures and pictures of My content they use,
  for another computer or a co-DM; packs they use are named, not copied. "Try the sample encounter" on Home sets
  up a sample campaign around a ruined chapel that shows all of this, including a night encounter with vision,
  light and fog of war; it imports its monsters from the D&D 5e API first, so it needs internet once.
- **Player view**: second window or a browser on the local network; each screen sees through one character's eyes
  or the whole party's (line of sight, light, darkvision, truesight), with explored areas remembered per character.

The left rail follows the order of work: **Home** (dashboard of the current campaign: continue, next session,
recent maps) · **Compendium** (creatures, player characters, items, spells, area templates, tables) ·
**Campaigns** · **Maps** · **Play**, with **Search** (Ctrl+K: every command, creature, spell, item, map, campaign
and encounter by name), **Players** (player window and LAN status with one button each) and **Settings** at the
bottom.

Home's first steps follow a new DM's order: choose the data folder, download the SRD rules content, add the player
characters, create a campaign, create a map from an image; the sample encounter is optional.

Background and design: [`PLAN.md`](PLAN.md). Code layout and module contracts:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Install

1. Download from the [latest release](https://github.com/SunYKnight/Fogwarden/releases/latest):
   - **Windows 10/11** (with WebView2): `Fogwarden_<version>_x64-setup-<revision>.exe`, run it; it installs for your
     Windows user. The installer has no code-signing certificate, so Windows SmartScreen may say "Windows protected
     your PC": choose _More info > Run anyway_.
   - **Linux** (x86_64, glibc 2.35 or newer, e.g. Ubuntu 22.04+, Debian 12+, Fedora 36+):
     `Fogwarden_<version>_amd64-<revision>.AppImage`, make it executable (`chmod +x Fogwarden_*.AppImage`) and start
     it; it updates itself. On Debian and Ubuntu, `Fogwarden_<version>_amd64-<revision>.deb` installs it system-wide
     instead (`sudo apt install ./Fogwarden_*.deb`); its updates ask for your password.
2. Follow Home's first steps. Your data goes to `%APPDATA%/io.github.sunyknight.fogwarden/` (Windows) or
   `~/.local/share/io.github.sunyknight.fogwarden/` (Linux) unless you pick another folder in Settings > Data.
3. For players on phones or tablets in your network, start LAN in the rail's **Players** popover and allow Fogwarden
   through the Windows firewall when Windows asks. On Linux with a firewall such as `ufw`, allow the TCP port from
   Settings > Players > LAN.
4. Updates: Settings > About checks for a new version (also once a day on start) and installs it.

On Linux under Wayland, apps cannot place their windows, so the player window opens where the desktop puts it; start
Fogwarden with `GDK_BACKEND=x11` to have it open on the monitor chosen in Settings. An empty white window on some
NVIDIA drivers goes away with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

## Requirements for development

- Node 24+, pnpm 10
- Windows 10/11 with WebView2; Rust (MSVC toolchain), Visual Studio Build Tools with the C++ workload and a Windows
  10/11 SDK
- Or Linux (Ubuntu 22.04+ or Debian 12+ for WebKitGTK 4.1) with Rust ([rustup](https://rustup.rs)) and:

  ```sh
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev patchelf \
    gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav
  ```

  The GStreamer plugins play music, sounds and videos and go into the AppImage `pnpm package` builds.

## Develop

```sh
pnpm install
pnpm app:dev        # desktop app with hot reload
pnpm dev            # UI only in a browser (IndexedDB storage, no LAN server)
pnpm typecheck && pnpm lint && pnpm test
pnpm format
```

GUI smoke tests can drive the real WebView2 over its DevTools port:
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm app:dev`.

## Build

```sh
pnpm package        # signed release build for this OS: installers, their .sig files and latest.json in artifacts/
pnpm build:server   # internet relay only: dist-server/relay.mjs (part of pnpm build)
```

Release builds sign the installer for the auto-updater, so `pnpm package` (and `pnpm app:build`) need the updater's
private key, see below.

## Release

The desktop app looks for updates at
`https://github.com/SunYKnight/Fogwarden/releases/latest/download/latest.json` (Settings > About, and once a day on
start unless switched off there) and installs only installers signed with the key whose public half is
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

Branches: `main` holds releases only; daily work goes to `develop`, larger changes to `feature/<name>` branches merged
into `develop`. A release merges `develop` into `main` and is built from `main`.

1. On `develop`: `pnpm set-version 0.2.0` sets the version in `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
2. In `CHANGELOG.md`, rename `## Unreleased` to `## 0.2.0`: the newest section becomes the release notes the app
   shows, and `pnpm package` stops unless the newest `## ` heading is exactly `## <version>`. Commit, merge `develop`
   into `main` (`git checkout main && git merge --no-ff develop`) and tag it `v0.2.0`, so the installer's revision is
   the release commit without `-dirty`.
3. Push `main` and the tag (`git push origin main v0.2.0`). The workflow _Release_ (`.github/workflows/release.yml`)
   runs `pnpm package` on Windows and Linux, merges their manifests into one `latest.json` (`pnpm release:manifest`)
   and creates the published GitHub release `v0.2.0` with the changelog section as notes and these assets:
   - `Fogwarden_0.2.0_x64-setup-<revision>.exe` (Windows installer)
   - `Fogwarden_0.2.0_amd64-<revision>.AppImage` and `Fogwarden_0.2.0_amd64-<revision>.deb` (Linux)
   - a `.sig` file next to each, and `latest.json` (version, notes, date, and signature and download URL per
     platform: `windows-x86_64`, `linux-x86_64` for the AppImage, `linux-x86_64-deb` for the .deb)

   _Actions > Release > Run workflow_ builds the same assets from any branch as the workflow artifact `release`
   (a leading `## Unreleased` changelog section is headed with the version for that run, so the revision ends in
   `-dirty`); with **publish** ticked it builds the branch as it is and creates the release `v<version>` (version
   from `package.json`), tagging the run's commit if the tag does not exist yet. GitHub offers the button once the
   workflow is on the default branch.

Without the workflow, `pnpm package` on one OS writes that OS's installers, their `.sig` files,
`latest-<platform>.json` and a `latest.json` for that platform alone, which is enough for a release of that OS
(`gh release create v0.2.0 artifacts/Fogwarden_0.2.0_*-<revision>.* artifacts/latest.json`). For both OSes, copy
the other OS's `artifacts/` files into the same folder and run `pnpm release:manifest`: it merges every
`latest-*.json` there into `latest.json` and stops if their versions or notes differ.

### The signing key

`pnpm package` takes the private key from `TAURI_SIGNING_PRIVATE_KEY` (key text) or else from
`data-local/signing/fogwarden.key`, and its password from `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if unset).
`data-local/` is gitignored; the key never goes into the repository. The release workflow reads both from the
repository secrets of the same names (_Settings > Secrets and variables > Actions_).

- **Back up** `fogwarden.key` (and its password) outside the repository, e.g. in a password manager or on an
  encrypted drive. Installed apps accept only updates signed with this key: if it is lost, the next version needs a
  new key pair, and every user has to download and install that version by hand.
- **Keep it private**: whoever holds it can sign installers the app accepts. If it leaks, make a new pair and ship it
  the same way.
- New pair (asks for a password; add `--ci` for none):
  `pnpm tauri signer generate -w data-local/signing/fogwarden.key`, then put the content of
  `data-local/signing/fogwarden.key.pub` into `plugins.updater.pubkey`.

## Play over the internet

> Hidden in the app for now: online play has not been tested against a real server yet (see `PLAN.md`), so the
> Online settings and the Players popover's Online line are switched off. The steps below describe it once enabled.

Players outside your network connect through a relay on a server you control; the app connects out to it, so
nothing at home needs to be reachable. You need an Ubuntu 22.04/24.04 server with root or sudo SSH access and a DNS
name pointing to it (ports 80 and 443 open).

1. **Settings > Players > Online > Set up a server…**: enter the domain, an email for the Let's Encrypt certificate
   and the relay port (default 7718, only nginx talks to it).
2. Either **Deploy via SSH** (host, user, key file or password; the password is never stored, the host key is shown
   for confirmation on first connect) or **Download install script** and run `sudo bash install.sh` in the copied
   folder on the server. The script installs Node.js 22, nginx, the `fogwarden-relay` systemd service and the
   certificate; it is safe to run again and keeps the DM key. It prints the DM key as `FOGWARDEN_DM_KEY=…`.
3. _Online_: the URL (`https://<domain>`) and DM key are filled in after an SSH deploy; otherwise paste the key.
   **Connect** (also in the rail's Players popover) uploads the player page and shows the player links with a QR
   code.

Only filtered player data, map images, token images and models reach the server. App updates upload the new player
page on the next connect; the server only needs a redeploy for relay changes (see the changelog). The app refuses
an outdated relay and asks you to run the setup again.

## Player links

In Settings > Players > LAN and in the rail's Players popover, _Link for_ picks a view: **Party** shows what all
characters see and have explored, each player character's link only what that character sees and remembers. Every
party member of the open campaign has a link, also when the character is not in the open encounter; it stays the
same for the whole campaign and across restarts, so hand each player their link or QR code once. Characters added by
hand in an encounter get a link for that encounter only. **New link** replaces a view's link and disconnects
everyone still using the old one. The player window picks its view under Settings > Players > _Shows_; Esc closes
it.

On a character's link players see their sheet (hit points, AC, speed, conditions, death saves, spell slots) with
dice you roll and log for them, a "Your turn" banner (phones vibrate), and can hold the map to ping a spot; you ping
with Alt+click on the Play canvas. In Play's **Table** tab, **Players move their own tokens** lets them drag their
own token (undo with Ctrl+Z), and **Show to players** shows a picture, video or text from the campaign's
`handouts/` folder to everyone or one view; the tab also holds Sound, Scene (time of day, weather) and whether your
camera and the turn order go to the players.

## Where things live

| What                    | Where                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Source                  | `src/`, `src-tauri/`, `server/` (internet relay), `tools/`                                  |
| Shipped content (packs) | `content/packs/` (five SRD 5.1 area templates, CC0 models, sample map)                      |
| Build output            | `dist/`, `dist-server/`, `src-tauri/target/`, `artifacts/` (all gitignored)                 |
| Your data               | the app data folder (see Install) by default; change it in Settings (e.g. a Dropbox folder) |

## Import stat blocks

Developers can import raw stat block text from the project folder:

```sh
# raw stat block text files (one creature per file); --pack <id> puts them into the pack packs/<id>/
pnpm tsx tools/import-statblocks.ts <folder> [--data-root <path>] [--source <name>] [--pack <id>]
```

Imports write into your data folder, never into the repo. Monster Manual text is copyrighted and stays out of git.

## Your data

Everything the app stores is plain files you can read and edit with a text editor and an image viewer. The app
reads them when a page lists them and overwrites a document when it saves it, so edit documents that are not open in
the app. Settings > Data shows and changes the folder.

| What              | File                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Creatures         | `library/creatures/<id>.txt`: a stat block as printed in the books, after a short header                |
| Creature pictures | `library/creatures/<id>.png` (or `.jpg`, `.jpeg`, `.webp`), token picture `<id>.token.png`              |
| Area templates    | `library/markers/<id>.json`                                                                             |
| Maps              | `library/maps/<id>/`: `map.json`, `terrain.png` (heights), `assets/` (image, 3D models)                 |
| Campaigns         | `campaigns/<id>/campaign.json` (name and party), `notes.md`                                             |
| Encounters        | `campaigns/<id>/encounters/<id>/encounter.json`, `fog/` (explored areas as black/white PNG)             |
| Session journal   | `campaigns/<id>/journal/<date>-session-<n>.md`: a short header, then your notes (Markdown)              |
| People and places | `campaigns/<id>/people-and-places/<id>.md` (header: name, kind, picture, tags) and the picture file     |
| Quests            | `campaigns/<id>/quests/<id>.md` (header: name, status `open`/`done`/`failed`)                           |
| Handouts          | `campaigns/<id>/handouts/`: pictures (`.png`, `.jpg`, `.webp`), videos (`.mp4`, `.webm`), `.md`, `.txt` |
| Calendar          | `campaigns/<id>/calendar.json`: months, current date and time, events                                   |
| Random tables     | `library/tables/<id>.txt`: one entry per line                                                           |
| Items, spells     | `library/items/<id>.md`, `library/spells/<id>.md`: header (type, rarity … / level, school …) + Markdown |
| Picture library   | `library/portraits/` and `portraits/` of each pack: pictures to pick for creatures and characters       |
| Content packs     | `packs/<id>/`: `pack.json` and the same folders as `library/` (see Content packs below)                 |
| Settings          | `settings.json`                                                                                         |
| Object models     | `library/dungeon-alchemist-objects.json` (model per object kind), `library/dungeon-alchemist-models/`   |
| Version history   | `history/<YYYY-MM-DD>/<path>`: earlier versions of changed and deleted files (see below)                |

- File names are the ids. A new `.txt` stat block in `library/creatures/` shows up in the Compendium; a picture named
  after a creature id pictures it, also creatures of packs (`srd-goblin.jpg` for the imported SRD goblin).
- A new document's id comes from its name when it is created: "Goblin Boss" becomes `goblin-boss`, a second one
  `goblin-boss-2`. Renaming a document in the app keeps its id, so its file or folder name stays. Documents created
  by older versions keep their 26-character ids.
- `terrain.png` is a 16-bit grayscale heightmap: height in feet = `baseFt + value * feetPerUnit` from `map.json`.
- Fog masks have one pixel per fog cell: white = explored (or revealed/hidden by you in `revealed.png`/`hidden.png`).
- `settings.json` holds secrets: the relay DM key and the player link secret. Don't share it.
- Random tables: `3: text` weighs an entry 3 (plain lines weigh 1); `1-3: text` and `4: text` are dice ranges
  (`96-00` ends at 100; a `dice: 2d6` header line for tables that do not start at 1). `[Other table]` rolls on that
  table, `[2d6]` rolls dice, lines starting with `#` are comments.
- Play adds combat start and end, fallen combatants, XP and loot to the newest journal entry when it is from today
  (or less than 12 hours old); otherwise it starts the next session's entry.

Data folders of older versions are converted on first start; a file that cannot be converted safely stays as it
was and is listed as a load problem. Format details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#data-formats).

### Version history

Before the desktop app changes or deletes a file in the data folder, it keeps the previous version in
`history/<YYYY-MM-DD>/` under the file's own path, so `history/2026-10-11/library/maps/cave/map.json` is the cave map
as it was before its first change on 11 October. Each file is kept once per day; an unchanged save keeps nothing.
The history keeps 30 days and at most 2 GB (oldest days go first on start, today's always stay); identical
contents are stored once in `history/.objects/` and the dated files are hard links to them (file systems without
hard links, such as FAT drives, get copies).

**Settings > Data > Version history…** lists the days with the documents changed on them. _Restore this version_ brings a
document back to how it was before that day's changes; what it replaces is kept in
`history/<YYYY-MM-DD> <HH-MM-SS> before restore/`, listed there too, so a restore can be restored away again.
_Open history folder_ shows the files, the size readout and _Clean up older than…_ free space. You can also copy a
file back by hand while the app does not have its document open. The history is never sent to players (LAN or
relay). Command-line tools keep replaced versions in the history as well and never write into `history/`.

## Content packs

A content pack is a folder (or a `.zip` of it) with a `pack.json` and the usual library folders: `creatures/`,
`markers/`, `maps/<id>/`, `tables/`, `items/`, `spells/`, `portraits/`, `models/`. **Settings > Content** lists the
installed packs with their counts, switches each on or off, exports any pack (also your own content) to a `.zip`,
removes imported packs and imports new ones (**Import pack…** for a `.zip`, **Import folder…** in the desktop app,
**Import from Aurora Builder…**, see below).

```json
{
  "id": "monster-manual",
  "name": "Monster Manual",
  "version": "1",
  "author": "",
  "license": "",
  "description": "",
  "url": ""
}
```

- Your own content (`library/`) always wins. Among packs, the one higher in the list wins when two hold an entry with
  the same id; drag a pack to change the order. Each pack row says what is overridden by whom.
- Switched-off packs disappear from the Compendium, the Maps page and the Add dialog. Running encounters keep their
  combatants (hit points, armor class, conditions); a creature's stat block and a map from a switched-off pack show
  a notice naming the pack until you switch it on again. Untick a kind on a pack (e.g. its spells) to hide just that
  kind the same way.
- **Hide duplicates** (on by default) keeps one creature, area template, item or spell per name across packs: the
  one from the pack higher up (My content always wins). With both the D&D 5e API and Aurora installed, drag Aurora
  above the API to keep the book versions of shared items and spells.
- Shipped packs (SRD 5.1 area templates, CC0 models, sample map) are read-only; editing one of their entries creates
  your copy. Imported packs live in your data folder under `packs/<id>/`.

### D&D 5e API

**Compendium > Creatures > Import ▾ > Everything from the D&D 5e API…** (also on the Items and Spells tabs and on
Home's first steps) imports from the D&D 5e API (dnd5eapi.co, SRD 5.1, CC-BY-4.0): monsters, monster pictures,
spells, spell area templates, magic items and equipment into the pack `dnd5e-api`. Needs internet; about 1250 small
requests (≈ 45 s) plus 580 MB for pictures. Item pictures are not imported (items have no picture). Each part has
its own checkbox; importing again overwrites the pack.

### Aurora Builder

**Settings > Content > Import from Aurora Builder…** (desktop app; also **Compendium > Players**, the campaign's
**Party** tab and **Add combatants > Player character > From Aurora…**) reads Aurora's documents folder
(`Documents/5e Character Builder`: `custom/`, `portraits/`, `*.dnd5e`), shows what it found and writes the parts you
tick into the pack "Aurora Builder" in your data folder (only Player characters is ticked by default; unticked parts
keep what an earlier import put into the pack):

- **Player characters** (`creatures/<file name>.txt` with `kind: player` and `level`): AC, hit points, speed,
  ability scores, saves, skills, passive Perception, darkvision, attacks, spell slots and the portrait, computed from
  the build the way Aurora computes its sheet, with only the portraits they use. Compendium > Players and the Player
  character tab of the Add combatants dialog list them.
- **Items and magic items** (`items/<id>.md`) and **Spells** (`spells/<id>.md`) for the Compendium tabs Items and
  Spells and for loot at the end of combat; the boxes say how many books they come from;
- the **Portrait library** (`portraits/`, all race portraits) as the picture library (**Library…** next to a
  creature's image or token).

Import again after a level-up: the import replaces the ticked parts (ids come from Aurora's element ids and the
file names). The pack holds book content: it stays on your computer; export and share it only where the books allow.

## Battlemaps from map makers

Besides plain images (PNG, JPEG, WebP), the New map wizard, Home (drop a file or **Import…**) and the Maps page take
exports that bring the grid, walls, doors, windows and lights along:

| Format                                                      | Made by                                                           | What comes along                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Universal VTT (`.dd2vtt`, `.df2vtt`, `.uvtt`)               | Dungeon Alchemist, Dungeondraft, DungeonFog, Arkenforge, MapForge | image, grid, walls, doors, windows, lights, ambient light                  |
| Foundry export folder (`<map>_NN.json` + picture per floor) | Dungeon Alchemist                                                 | one map per floor with walls, doors, lights                                |
| Project file (`.dam`, with one of the above)                | Dungeon Alchemist                                                 | ground heights, buildings (rooms, walls, doors, windows), object positions |

- **Dungeon Alchemist**: _Export_ > format _Universal VTT_ gives a `.dd2vtt`. Drop it on Home or Maps (together with
  the saved `.dam` project for hills and objects) or pick it in _New map_. For several floors, export with format
  _Foundry VTT_ into an empty folder and use **Maps > Import Dungeon Alchemist folder…** (desktop app); a copy of the
  `.dam` in that folder whose name starts the export's adds terrain and objects to the lowest floor.
- **Dungeondraft**: _File > Export_, export mode _Universal VTT_, gives a `.dd2vtt`. Portals with _Block light_ off
  arrive as windows.
- **DungeonFog**: export with file type _Universal VTT_ (`.df2vtt`).

With a `.dam`, the buildings of its ground level replace the export's wall lines: walls stand on the true room
outlines at Dungeon Alchemist's storey height (12 ft), rooms get floors (tick _Roof_ on a room to add one), doors and
windows sit where the project has them. Dungeon Alchemist draws its picture in perspective, so the export's lines
trace the wall tops a little outside the true walls; the import works this out. Upper floors are not imported yet.

The grid comes from the file, so the wizard skips the grid step; _Check grid_ shows it over the image first. Walls are
10 ft high, sight-blocking objects 6 ft; lights reach their full range, half of it bright. When the export says the
lighting is baked into the picture, the ambient light is set one level brighter and the map notes say so.

Dungeon Alchemist's own 3D models stay in Dungeon Alchemist. On import with a `.dam`, every object kind is listed once
with its count; pick a stand-in per kind: a shipped CC0 model, a downloaded Poly Haven model, your own
`.glb`/`.gltf`, a file from a folder (for example the custom models you added under
`Dungeon Alchemist_Data/StreamingAssets/Models/`), or _Skip_. The choices are kept for later imports.

- **Names and sizes**: when Dungeon Alchemist is installed (found through Steam, or **Locate Dungeon Alchemist…**),
  the kinds get its names ("Fern", "Evergreen Tree") and a picked model is sized to fit the kind's box from its
  database (`StreamingAssets/Database/BuildingBlocks.json`, `ModelStaticData.json`; read only).
- **Auto-assign stand-ins** picks a model for every kind whose name or keywords match a tree, plant, rock or piece of
  furniture, and sizes it; kinds seen for the first time get one on import already. Food, cutlery and other clutter
  stay skipped.
- **Get realistic models…** downloads 23 CC0 models from [Poly Haven](https://polyhaven.com): fir trees, a broadleaf
  tree, plants, flowers, rocks and furniture (about 170 MB with 1k textures). They go into the pack "Poly Haven
  models" in the data folder, about 65 MB after the download: sets are split into one model per variant and scanned
  trees are simplified to 30,000 triangles. Auto-assign prefers them over the shipped Kenney models; models already
  downloaded are kept, so the button only fetches what is missing. Remove the pack under **Settings > Content**.

## Exporting maps

Right-click a map on the Maps page, or use **⋯ > Export…** in the map editor's header, and pick a format; the save
dialog asks where the file goes (outside the app's data and content folders).

| Format                    | Opens in                                           | What it holds                                                                                                                |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 3D model (`.glb`)         | Blender, other 3D tools, glTF viewers              | terrain with the battlemap, walls with their materials, closed doors and windows, roofs, props, lights (optional), in meters |
| Universal VTT (`.dd2vtt`) | Foundry (Universal Battlemap Importer), other VTTs | picture, grid, sight-blocking walls, doors and windows as portals, lights, ambient light                                     |
| Image (`.png`)            | any image viewer                                   | the battlemap cut and turned to the grid, grid lines optional                                                                |

Pictures are cut to the map's squares and reduced to 4096 px on the long edge, as the 3D view shows them. A video
battlemap exports its first frame. Universal VTT has no magical darkness: a map with magical darkness as ambient
light reads back as darkness.

## Creature pictures and standees

Tokens show the creature picture: a disc in the top view, an upright standee in the 3D view (Settings > Rules
switches standees off for you and your players). Monsters come from **Compendium > Creatures > Import ▾ >
Everything from the D&D 5e API…**; tick "Monster pictures" there for the paintings, or add them later with
**Import ▾ > Pictures from the D&D 5e API…** (painted pictures for the SRD monsters, downloaded and saved in your
data folder). **Import ▾ > Pictures from a folder…** takes a folder of PNG/JPEG/WebP files named after the creatures
(`goblin.jpg`, `Adult Red Dragon.png`, `homebrew--werewolf.jpg`; case, accents, punctuation and `source--` prefixes
don't matter). The preview lists matched and unmatched files before anything is copied into your data folder under
the creatures' ids; existing pictures are only replaced when you tick the box. One picture per creature also works
in the creature editor's Image/Token fields (the file is copied at once); for pack creatures that keeps the pack's
creature untouched.

## Graphics quality

A slow 3D view (integrated graphics such as Intel UHD) gets faster in **Settings > Graphics**: fewer lights with
shadows (each costs six extra render passes), a lower resolution, props without shadows, smaller textures
(battlemaps, token pictures and 3D model textures at most 1024/2048/4096 px; exports keep full size), smaller shadow
maps, no antialiasing and a frame limit (30 or 15 fps). The section names the graphics card and suggests a preset
(Low for integrated graphics, else High); the presets only fill in these values, which sit under _Advanced_ with the
graphics memory a smaller texture size saves. Low: no shadows, 50 % resolution, 1024 px textures, no antialiasing,
15 fps.
Medium: 2 shadowed lights, 75 %, prop shadows, 2048 px, 512 px shadow maps, antialiasing, 30 fps. High: 8 shadowed
lights, full resolution, 4096 px, 512 px shadow maps, antialiasing, no frame limit. Changes apply at once to the
DM's views (a new texture size reloads the textures, antialiasing restarts the 3D view); the player window on the
same computer takes them when it opens, LAN/relay players use the defaults (4 lights, full resolution, prop
shadows, 4096 px textures, 512 px shadow maps, antialiasing, no frame limit).

## License of shipped content

The shipped packs live in `content/packs/`, each with its `LICENSE.md`: `srd/` contains five area templates from the
System Reference Document 5.1 under CC-BY-4.0 ([`LICENSE.md`](content/packs/srd/LICENSE.md)); monsters, spells,
items and equipment come from the D&D 5e API import into the data folder's pack `dnd5e-api` (attribution in its
`LICENSE.md`); the sample map in `sample-map/` is generated by `tools/build-sample.ts` and released under CC0
([`LICENSE.md`](content/packs/sample-map/LICENSE.md)); the stand-in models in `cc0-models/` are Kenney's (CC0;
sources in [`LICENSE.md`](content/packs/cc0-models/LICENSE.md)).

## License

Fogwarden is released under the MIT License ([`LICENSE`](LICENSE)). Shipped content, icons and the licenses of the
libraries it uses are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Fogwarden uses the SRD 5.1 and
is not affiliated with or endorsed by Wizards of the Coast.
