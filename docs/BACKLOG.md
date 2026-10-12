# Backlog

Features agreed for implementation (effort S = hours, M = a day or two). Larger ideas live in `IDEAS.md`.
Every feature follows `UI_CONCEPT.md`: it lives where the DM already looks for it, uses the kit components, labelled
icons, one primary action per screen, undo where possible, and a success or error notice.

**Status: all items below are implemented.** Content, sound, players, combat, campaign and maps landed in
`c4449b7`; Aurora import, version history and auto-update in `2047818`; Dungeon Alchemist rooms (P7) in
`1d5998e`. Follow-up work goes into new rows here; larger ideas into `IDEAS.md`.

## Where new features live

| Place                            | New content                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Compendium tabs                  | Creatures · Items · Spells · Area templates · Tables · Packs (tab bar stays put; actions follow)                 |
| Campaign page tabs               | Encounters · Journal · People & places · Quests · Calendar                                                       |
| Play canvas toolbar              | Select · Measure · Area · Top/3D · Fog · **Sound** · **Show** (handouts, interludes) · **Scene** (time, weather) |
| Play inspector, Creature tab     | resources (legendary/lair/recharge/slots), durations, concentration, death saves, carried light                  |
| Add combatants dialog            | encounter difficulty for the party                                                                               |
| End combat                       | dialog: XP split and loot                                                                                        |
| Map editor, step 3 Areas         | region kind "Sound" (ambient loop with radius)                                                                   |
| Map settings                     | battlemap may be a video (MP4/WebM)                                                                              |
| Maps page card menu              | Export as 3D model (GLB), Universal VTT, image                                                                   |
| Player page (window, LAN, relay) | music and sounds, handouts, own sheet, dice, ping, turn notice, own token moves                                  |
| Settings                         | Audio (output, volumes) · Data (history) · About (updates)                                                       |

## Items

### Content and packs

| #   | Item                    | Effort | Notes                                                                                                                                                                       |
| --- | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Content packs           | M      | Aurora-style packs: a folder (or `.zip`) with `pack.json` and the usual library folders; enable, disable, import, export, remove. SRD, CC0 models and imports become packs. |
| P2  | Compendium images       | M      | Every entry shows a picture: creatures fall back to an icon by type (CC BY game-icons.net with attribution), area templates to their shape.                                 |
| P3  | Compendium tab bar      | S      | Tabs keep their position when switching; tab-specific actions sit after them.                                                                                               |
| P4  | Aurora characters       | M      | `.dnd5e` → player characters (AC, HP, speed, senses, portrait); re-import updates.                                                                                          |
| P5  | Aurora items and spells | M      | Into a local pack as readable files; Items and Spells tabs in the Compendium.                                                                                               |
| P6  | Aurora portraits        | S      | Portraits folder as a picture library for PCs and NPCs.                                                                                                                     |
| P7  | Dungeon Alchemist rooms | M      | Rooms, walls, floors from `.dam` (needs a test map with buildings).                                                                                                         |
| P8  | `.dd2vtt` + `.dam` step | S      | Importing a `.dd2vtt` asks for its `.dam` (terrain and objects) as a clear step.                                                                                            |

### Sound and atmosphere

| #   | Item              | Effort | Notes                                                                                   |
| --- | ----------------- | ------ | --------------------------------------------------------------------------------------- |
| A1  | Scene playlists   | M      | Moods (exploration, tavern, combat, boss); auto switch on Start/End combat, crossfade.  |
| A2  | Players hear it   | M      | Synced playback in player window, LAN and relay; DM master volume, players' own volume. |
| A3  | Sound board       | S      | One-shot effects everyone hears.                                                        |
| A4  | Ambient regions   | M      | Sound regions on maps, volume by distance to the party.                                 |
| A5  | Video backgrounds | M      | Animated battlemaps (MP4/WebM) and fullscreen interludes.                               |
| A6  | Weather and time  | M      | Rain, snow, fog particles; day/night slider driving ambient light.                      |

### Players' devices

| #   | Item            | Effort | Notes                                                              |
| --- | --------------- | ------ | ------------------------------------------------------------------ |
| D1  | Own sheet       | M      | HP, conditions, slots; dice rolls into the shared log.             |
| D2  | Your turn       | S      | Notice (and vibration on phones) when the character's turn starts. |
| D3  | Ping            | S      | Tap the map to point; everyone sees it briefly.                    |
| D4  | Handouts        | S      | Image, text or video to all or one player.                         |
| D5  | Own token moves | M      | Optional per encounter; DM sees and can undo.                      |

### Combat

| #   | Item              | Effort | Notes                                                                       |
| --- | ----------------- | ------ | --------------------------------------------------------------------------- |
| C1  | Encounter builder | S      | XP budget and difficulty while adding monsters.                             |
| C2  | Areas hit targets | M      | Targets inside an area, saves rolled, damage with resistances applied.      |
| C3  | Durations         | M      | Conditions/effects with rounds that expire; concentration checks on damage. |
| C4  | Monster resources | M      | Legendary and lair actions, recharge, spell slots.                          |
| C5  | Death saves       | S      | For PCs at 0 HP; shown to that player.                                      |
| C6  | Carried light     | S      | Torch or lantern moving with a token.                                       |
| C7  | Loot and XP       | S      | At End combat: XP split, loot from tables or items.                         |

### Campaign

| #   | Item              | Effort | Notes                                                      |
| --- | ----------------- | ------ | ---------------------------------------------------------- |
| K1  | Session journal   | M      | Notes per session with a timeline from the combat log.     |
| K2  | People and places | M      | NPCs and locations with picture, notes, linked encounters. |
| K3  | Quests, calendar  | M      | Open quests, in-game date and time, rests.                 |
| K4  | Random tables     | S      | Names, loot, encounters, rumours as editable text tables.  |

### Maps

| #   | Item          | Effort | Notes                                                                  |
| --- | ------------- | ------ | ---------------------------------------------------------------------- |
| M1  | 3D export     | M      | Whole map as GLB: terrain with battlemap texture, walls, roofs, props. |
| M2  | Universal VTT | S      | Export walls, doors, lights and image as `.dd2vtt` for other VTTs.     |

### Data and app

| #   | Item            | Effort | Notes                                                              |
| --- | --------------- | ------ | ------------------------------------------------------------------ |
| T1  | Version history | M      | Readable snapshots of changed files; restore from Settings > Data. |
| T2  | Auto-update     | M      | Signed updates; check and install from Settings > About.           |
