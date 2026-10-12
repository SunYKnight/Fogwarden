# DnD DM Tool

Desktop app for a 5e Dungeon Master: turn 2D battlemaps into 3D scenes, run encounters, and show players a
fog-of-war view on a second screen or in any browser on the local network or the internet.

- **Map editor**: calibrate the grid to the battlemap image, sculpt terrain, draw walls with doors and windows, rooms
  with roofs, regions, lights and imported Blender models (`.glb`/`.gltf`). The image is projected from above onto
  every surface, so the top view still looks like the original map.
- **Encounters**: initiative, HP, conditions, attack and dice rolls with a log, tokens on the map, area templates,
  doors, measuring.
- **Libraries**: creatures (334 SRD 5.1 monsters shipped, stat block import from text), area markers, maps,
  campaigns.
- **Player view**: second window, LAN browser or any browser on the internet through a small relay server; each
  screen sees through one character's eyes or the whole party's (line of sight, light, darkvision, truesight), with
  explored areas remembered per character.

Background and design: [`PLAN.md`](PLAN.md). Code layout and module contracts:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requirements

- Windows 10/11 with WebView2
- Node 24+, pnpm 10
- Rust (MSVC toolchain), Visual Studio Build Tools with the C++ workload and a Windows 10/11 SDK

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
pnpm package        # release build; installer copied to artifacts/
pnpm build:server   # internet relay only: dist-server/relay.mjs (part of pnpm build)
```

## Play over the internet

Players outside your network connect through a relay on a server you control; the app connects out to it, so
nothing at home needs to be reachable. You need an Ubuntu 22.04/24.04 server with root or sudo SSH access and a DNS
name pointing to it (ports 80 and 443 open).

1. **Server** page > _Set up a server_: enter the domain, an email for the Let's Encrypt certificate and the relay
   port (default 7718, only nginx talks to it).
2. Either **Deploy via SSH** (host, user, key file or password; the password is never stored, the host key is shown
   for confirmation on first connect) or **Download install script** and run `sudo bash install.sh` in the copied
   folder on the server. The script installs Node.js 22, nginx, the `dmtool-relay` systemd service and the
   certificate; it is safe to run again and keeps the DM key. It prints the DM key as `DMTOOL_DM_KEY=…`.
3. _Remote server_: the URL (`https://<domain>`) and DM key are filled in after an SSH deploy; otherwise paste the
   key. **Connect** uploads the player page and shows the player links with a QR code.

Only filtered player data, map images, token images and models reach the server. App updates upload the new player
page on the next connect; the server only needs a redeploy for relay changes (see the changelog). The app refuses
an outdated relay and asks you to run the setup again.

## Player links

On the Server page and in the rail's Players popover (LAN), _Link for_ picks a view: **Party** shows what all
characters see and have explored, each player character's link only what that character sees and remembers. The
links stay valid across restarts and work for LAN and relay alike (with the respective address); **New link**
replaces a view's link and disconnects everyone still using the old one. Characters' links belong to the open
encounter. The player window picks its view under Players > _Shows_.

## Where things live

| What                       | Where                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Source                     | `src/`, `src-tauri/`, `server/` (internet relay), `tools/`                                  |
| Shipped content (SRD only) | `content/`                                                                                  |
| Build output               | `dist/`, `dist-server/`, `src-tauri/target/`, `artifacts/` (all gitignored)                 |
| Your data                  | `%APPDATA%/de.dnddmtool.desktop/` by default; change it in Settings (e.g. a Dropbox folder) |

## Import from the old WPF tool

```sh
# creatures, maps (images, tile heights, walls) and markers from the legacy data folder
pnpm tsx tools/import-legacy.ts "<path>/240722_DnD_DMTool_Data" [--data-root <path>]
# raw stat block text files (one creature per file)
pnpm tsx tools/import-statblocks.ts <folder> [--data-root <path>] [--source <name>]
```

Imports write into your data folder, never into the repo. Monster Manual text is copyrighted and stays out of git.

## Your data

Everything the app stores is plain files you can read and edit with a text editor and an image viewer. The app
reads them when a page lists them and overwrites a document when it saves it, so edit documents that are not open in
the app. Settings > Data shows and changes the folder.

| What              | File                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Creatures         | `library/creatures/<id>.txt`: a stat block as printed in the books, after a short header              |
| Creature pictures | `library/creatures/<id>.png` (or `.jpg`, `.jpeg`, `.webp`), token picture `<id>.token.png`            |
| Area templates    | `library/markers/<id>.json`                                                                           |
| Maps              | `library/maps/<id>/`: `map.json`, `terrain.png` (heights), `assets/` (image, 3D models)               |
| Campaigns         | `campaigns/<id>/campaign.json`, `notes.md`                                                            |
| Encounters        | `campaigns/<id>/encounters/<id>/encounter.json`, `fog/` (explored areas as black/white PNG)           |
| Settings          | `settings.json`                                                                                       |
| Object models     | `library/dungeon-alchemist-objects.json` (model per object kind), `library/dungeon-alchemist-models/` |

- File names are the ids. A new `.txt` stat block in `library/creatures/` shows up in the Compendium; a picture named
  after a creature id pictures it, shipped ones too (`srd-goblin.jpg` for the SRD goblin).
- `terrain.png` is a 16-bit grayscale heightmap: height in feet = `baseFt + value * feetPerUnit` from `map.json`.
- Fog masks have one pixel per fog cell: white = explored (or revealed/hidden by you in `revealed.png`/`hidden.png`).
- `settings.json` holds secrets: the relay DM key and the player link secret. Don't share it.

Data folders of older versions are converted on first start; a file that cannot be converted safely stays as it
was and is listed as a load problem. Format details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#data-formats).

## Battlemaps from map makers

Besides plain images (PNG, JPEG, WebP), the New map wizard, the Home drop zone and the Maps page take exports that
bring the grid, walls, doors, windows and lights along:

| Format                                                      | Made by                                                           | What comes along                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Universal VTT (`.dd2vtt`, `.df2vtt`, `.uvtt`)               | Dungeon Alchemist, Dungeondraft, DungeonFog, Arkenforge, MapForge | image, grid, walls, doors, windows, lights, ambient light |
| Foundry export folder (`<map>_NN.json` + picture per floor) | Dungeon Alchemist                                                 | one map per floor with walls, doors, lights               |
| Project file (`.dam`, with one of the above)                | Dungeon Alchemist                                                 | ground heights, object positions                          |

- **Dungeon Alchemist**: _Export_ > format _Universal VTT_ gives a `.dd2vtt`. Drop it on Home or Maps (together with
  the saved `.dam` project for hills and objects) or pick it in _New map_. For several floors, export with format
  _Foundry VTT_ into an empty folder and use **Maps > Import Dungeon Alchemist folder…** (desktop app); a copy of the
  `.dam` in that folder whose name starts the export's adds terrain and objects to the lowest floor.
- **Dungeondraft**: _File > Export_, export mode _Universal VTT_, gives a `.dd2vtt`. Portals with _Block light_ off
  arrive as windows.
- **DungeonFog**: export with file type _Universal VTT_ (`.df2vtt`).

The grid comes from the file, so the wizard skips the grid step; _Check grid_ shows it over the image first. Walls are
10 ft high, sight-blocking objects 6 ft; lights reach their full range, half of it bright. When the export says the
lighting is baked into the picture, the ambient light is set one level brighter and the map notes say so.

Dungeon Alchemist's own 3D models stay in Dungeon Alchemist. On import with a `.dam`, every object kind is listed once
with its count; pick a stand-in per kind: a shipped CC0 model, your own `.glb`/`.gltf`, a file from a folder (for
example the custom models you added under `Dungeon Alchemist_Data/StreamingAssets/Models/`), or _Skip_. The choices
are kept for later imports.

## Creature pictures and standees

Tokens show the creature picture: a disc in the top view, an upright standee in the 3D view (Settings > Rules
switches standees off for you and your players). To give the shipped SRD creatures pictures, use **Compendium >
Attach portraits from folder…** and pick a folder of PNG/JPEG/WebP files named after the creatures (`goblin.jpg`,
`Adult Red Dragon.png`, `legacy--werewolf.jpg`; case, accents, punctuation and `legacy--` prefixes don't matter). The
preview lists matched and unmatched files before anything is copied into your data folder under the creatures' ids;
existing pictures are only replaced when you tick the box. One picture per creature also works in the creature
editor's Image/Token fields (the file is copied at once); for shipped creatures that keeps the creature shipped.

## License of shipped content

`content/` contains material from the System Reference Document 5.1 under CC-BY-4.0; see
[`content/LICENSE-SRD.md`](content/LICENSE-SRD.md). The sample map `content/maps/sample-chapel` is generated by
`tools/build-sample.ts` and released under CC0; see [`content/LICENSE-SAMPLE.md`](content/LICENSE-SAMPLE.md). The
stand-in models in `content/models/cc0/` are Kenney's (CC0); sources in
[`content/models/cc0/LICENSE.md`](content/models/cc0/LICENSE.md).
