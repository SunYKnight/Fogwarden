# UI Concept

Status: **approved** · Applies to the DM window, the map editor and the player view.

## 1. Goal

A DM opens the app before or during a session and finds the next step without reading a manual:
prepare a map, prepare an encounter, run it, show it to the players. Every screen answers three questions at a glance:
_Where am I? What can I do here? What happens if I click?_

### Principles

1. **Workflow over features.** The UI follows the DM's order of work: _Prepare → Play → Show_, not the code's modules.
2. **The map is the stage.** Map screens give the canvas the most space; panels are narrow, collapsible and contextual.
3. **One place per thing.** Each setting or action lives in exactly one obvious place (no "Player view" button in three
   spots, no map settings under the tool options).
4. **Show, then tell.** Labels next to icons, a live hint line for the active tool, previews before commit.
5. **Forgiving.** Everything undoable; destructive actions confirmed in-app with what will be lost; nothing modal unless
   it must be.
6. **Same gesture, same meaning** in editor, play view and player view.

## 2. What is unintuitive today (from the smoke run)

| Area              | Observation                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation        | Only _Library / Settings_ on top; editor and encounter replace the whole window with a "← Library" button. Encounters are only reachable via _Library → Campaigns → click campaign → Open_. |
| Editor tools      | 15 icon-only buttons with glyphs (`▲ ▼ ≈ ▬ ⟋ ≡ ∿ ▥ ⊓ ⌂ ⬡ ✶ ◈`); meaning only via hover tooltip. No grouping visible.                                                                        |
| Editor side panel | Tool options, selection inspector and _Map_ properties stacked in one scrolling column; the panel grows to 3+ screens.                                                                      |
| Calibration       | A tool among sculpt brushes, although every new map needs it first; a new map opens uncalibrated (grid guessed at 70 px).                                                                   |
| Encounter page    | Three dense columns; right column stacks combatant, dice, area markers, log, player view, LAN (~4 screens of scrolling). Add-combatant form permanently occupies half the left column.      |
| Player view       | Open/LAN/fog controls hidden at the bottom of the encounter's right column; no visible status whether players are connected or what they see.                                               |
| Feedback          | `window.confirm` for deletes (7 places), errors as toasts only, no success feedback for saves/imports, no shortcut overview.                                                                |
| Settings          | Data folder must be typed as a path; monitor list without preview or test.                                                                                                                  |
| First run         | Empty library with one button; no hint to import old data, set the data folder or try a sample map.                                                                                         |

## 3. Information architecture

A slim **left navigation rail** is always visible (also in editor and play view), so leaving a screen is one click and
work in progress is never hidden behind "back".

```
┌───┬───────────────────────────────────────────────────────────────┐
│ H │  Home        dashboard: continue, recent, first steps          │
│ M │  Maps        map library → map editor                          │
│ C │  Compendium  creatures · area templates (tabs)                 │
│ K │  Campaigns   campaigns → encounters → Play                     │
│ ▶ │  Play        the running encounter (badge when active)         │
│───│                                                               │
│ P │  Players     status chip: off · window · LAN (n) → popover     │
│ S │  Settings                                                      │
└───┴───────────────────────────────────────────────────────────────┘
```

- **Play** is a top-level destination, not a sub-page of a campaign: the running encounter stays one click away while
  the DM looks up a creature in the Compendium or tweaks a map.
- **Players** is a global control (not encounter-local): one popover to open the player window, pick the monitor,
  start LAN and show the QR code, push the camera, and see "2 players connected".
- Breadcrumb in each header: `Campaigns › Dragon Heist › Ambush on the road`.

## 4. Screens

### 4.1 Home

- **Continue** card: last encounter (map thumbnail, round, whose turn) → _Resume_.
- **Recent**: last 6 maps / encounters.
- **First steps** (shown until done, dismissible): _Choose data folder_ · _Create a map from an image_ ·
  _Open the sample encounter_ (shipped SRD content + a sample map).
- Big drop zone: dropping an image creates a map (→ 4.2 wizard); dropping a `.txt` stat block opens the creature import.

### 4.2 New map wizard (instead of "uncalibrated map + find the tool")

Three steps in a dialog over the image:

1. **Image** – drop or pick; name from file name; grid guess from "52x49" in the name.
2. **Grid** – image shown with live grid overlay; _drag a square_ or _click two corners_; sliders for size/offset;
   squares count follows; "Looks right" checklist (lines on walls/tiles). Skip possible.
3. **Done** – _Open in editor_ or _Use in a new encounter_.

The calibration tool remains in the editor for later corrections, but under _Map settings → Grid_.

### 4.3 Map editor

```
┌──┬──────────────────────────────────────────────────────────┬──────────────┐
│  │ Tavern › editor   ① Ground ② Walls ③ Areas ④ Light & objects │ ↶ ↷  Saved ✓ │
│  ├──────────────────────────────────────────────────────────┤ Inspector    │
│ N│ [Raise][Lower][Smooth][Flatten][Ramp][Terrace][Noise]      │ (selection   │
│ A│ Radius ━━●━━ 15 ft  Strength ━●━━  Falloff ▾   ← tool bar │  or tool     │
│ V│                                                          │  details)    │
│  │                      CANVAS                              │              │
│  │                                                          │ Layers  ▾    │
│  │                                     [Top|3D] [Player look]│ Map settings │
│  ├──────────────────────────────────────────────────────────┤              │
│  │ Drag to raise terrain · Alt+click picks height · x 32 ft y 14 ft h 3.5 ft │
└──┴──────────────────────────────────────────────────────────┴──────────────┘
```

- **Steps instead of a flat palette.** Tools are grouped into four labelled steps that match the work order:
  ① _Ground_ (sculpt brushes), ② _Walls_ (wall, door/window), ③ _Areas_ (room, region), ④ _Light & objects_
  (light, prop). The active step shows its tools **with icon + text label** in a horizontal tool bar; steps can be
  visited in any order (they are tabs, not a forced wizard). _Select_ is always available (V / Esc).
- **Tool options in the tool bar**, directly under the tools (radius, strength, presets) – not in the side panel.
- **Inspector** (right) shows only the selection (wall, door, light …) or, with nothing selected, a short
  "what to do in this step" card. _Map settings_ (name, grid, ambient light, ground color, cliff material) move to a
  dialog opened from the header; _Layers_ become a collapsible section.
- **Status bar** (bottom): active tool hint, cursor position and terrain height, snapping state, save state.
- **Direct manipulation:** hover highlights the object that a click would select; selected walls show vertex handles;
  Del deletes the selection; drag-and-drop of `.glb` onto the canvas places a prop.
- **Preview as player** becomes an eye toggle on the canvas (shows player lighting/fog look).

### 4.4 Play (encounter)

```
┌──┬────────────────────────────────────────────────────────────┬────────────┐
│  │ Campaigns › Dragon Heist › Ambush       Round 2 · Goblin 1 ▶ │ Players: 2 │
│  ├───────────┬────────────────────────────────────────────────┼────────────┤
│ N│ Initiative│                                                │ [Creature] │
│ A│ ▶ Goblin 1│                                                │  Goblin 1  │
│ V│   Thorin  │              CANVAS                            │  HP 3/7 ▓▓░│
│  │   Goblin 2│                                                │  −[  ]+    │
│  │   Goblin 3│                                                │  Conditions│
│  │ [+ Add]   │                                                │  Stat block│
│  │           │  [Select|Measure|Area ▾]  [Top|3D]  [Fog ▾]     │            │
│  ├───────────┴────────────────────────────────────────────────┤ tabs:      │
│  │ [Scimitar +4 · 1d6+2]  [Shortbow +4 · 1d6+2]    [Next turn ▶]│ Creature · │
│  │ Log: Goblin 1 hits Thorin for 5 …                (▲ expand)  │ Dice · Log │
└──┴────────────────────────────────────────────────────────────┴────────────┘
```

- **Initiative strip** (left, narrow): the turn order only; _+ Add_ opens a dialog/drawer with library search,
  count, HP mode and the PC form – not a permanently open form.
- **Turn bar** (bottom): the current combatant's actions as big buttons (roll to-hit + damage in one click; result
  appears inline and in the log), _Next turn_ always in the same place (also Space).
- **Inspector tabs** (right): _Creature_ (selected combatant: HP −/+, conditions, notes, stat block),
  _Dice_ (roller), _Log_, _Areas_ (templates + placed markers). One tab visible at a time – no 4-screen scroll.
- **Canvas toolbar**: Select · Measure · Area template picker · camera · fog brush (reveal/hide) – everything that
  is a pointer mode lives on the canvas, where the pointer is.
- **On-map interaction:** click token = select (inspector + highlight in strip), drag = move with distance label,
  right-click token = context menu (damage, condition, hide, remove), click door = open/close, Shift = lock.
- **Unplaced combatants** appear as a tray chip "3 not on map" → click to place one after another.

### 4.5 Compendium

- Two tabs: _Creatures_, _Area templates_. List left (search, filters: type, CR range, source, "mine only"),
  stat block preview right. Edit opens the full editor (as page, not modal over a modal); the stat block preview
  updates live beside the form.
- Shipped entries show a lock badge; editing one creates "your copy" with an explicit hint and a _Revert_ action.

### 4.6 Campaigns

- Campaign cards → campaign page with encounter list (status: not started / round n / finished, map thumbnail,
  last played) and notes. _New encounter_ asks for name + map (thumbnail picker) and opens Play directly.

### 4.7 Settings

- Sections: _Data_ (folder picker dialog, "open folder", "copy my data to new folder", version history with
  "restore this version"), _Player view_ (monitor thumbnails with "identify" flash and "test window"), _LAN_ (port),
  _Rules_ (diagonals), _About_ (version, revision, updates, licenses).

### 4.8 Player window

- Unchanged principle (shows only what the DM sends) plus: a small unobtrusive status corner with the view's name
  ("Party" or the character) and, when disconnected, waiting or the link was replaced, the reason; a big readable
  initiative ribbon optional (DM toggle); no DM controls ever, no view picker for players (the link decides the
  view; the DM picks the player window's view in the Players popover).

## 5. Interaction model (all map views)

| Input                       | Meaning                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| Left click / drag           | Use the active tool; in Select: select / move                            |
| Right drag                  | Pan · Right click (no drag): context menu of the object under the cursor |
| Middle drag / Alt+left drag | Rotate (3D)                                                              |
| Wheel                       | Zoom to cursor                                                           |
| Esc                         | Cancel current drawing, then deselect, then back to Select               |
| Del / Backspace             | Delete selection (undoable)                                              |
| Ctrl+Z / Ctrl+Y             | Undo / redo (editor and play)                                            |
| Space                       | Next turn (Play)                                                         |
| ?                           | Shortcut overlay for the current screen                                  |
| 1–4                         | Editor step; letter keys: tools shown on their buttons                   |

Pointer feedback: cursor shape per tool (crosshair, brush ring, move), hover outline for clickable objects,
ghost preview before every placement, snapping indicator (dot on the snapped point).

## 6. Visual language and components

- **Icons:** one consistent outline icon set drawn for this project (`src/ui/kit/icons.tsx`), always with text labels.
- **Color semantics:** accent = primary action / active; red = destructive / enemy; blue = players; green = allies /
  healthy; yellow = current turn. Same colors on tokens, initiative strip and log.
- **Components:** `Panel` with collapsible `Section`s, `Tabs`, `Toolbar` + `ToolButton` (icon, label, shortcut
  badge), `Inspector`, `StatusBar`, `Dialog`, `ConfirmDialog` (names what gets deleted, offers undo where possible),
  `Popover`, `ContextMenu`, `Toast` (errors and successes like "Saved", "Imported 12 creatures"), `EmptyState`
  (illustration-free: one sentence + the next action button).
- **Density:** 14 px base, 32 px controls, 8 px grid; panels min/max width; long forms split into sections.
- **Accessibility:** visible keyboard focus, all icon buttons with `aria-label`, contrast ≥ 4.5:1, no color-only
  meaning (icons/text accompany color).

## 7. Key flows (target click counts)

| Flow                                            | Today                                                                            | Target                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| Image → calibrated map in editor                | import, open, find calibrate tool, click corners (5+ steps, discoverability low) | drop image → wizard (3 steps)                  |
| Start an encounter on a map                     | Library → Campaigns → campaign → name + map → create → Open                      | Campaign → _New encounter_ (name + map) → Play |
| Add 3 goblins                                   | type search, click, set count, find "Add 3 × Goblin" in a long column            | _+ Add_ → search → count → Add                 |
| Roll a goblin attack                            | select → scroll to stat block → dice icon                                        | select → turn bar button                       |
| Show players the map                            | find panel at the bottom of the right column                                     | Players chip → _Open window_ / _Start LAN_     |
| Return to the running fight from the Compendium | Library → Campaigns → … → Open                                                   | Play in the rail                               |

## 8. Implementation phases

| #   | Phase                                                                                                                                                                                                                                                           | Acceptance                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| U1  | **Foundation**: navigation rail + header/breadcrumb, component kit (Panel/Section, Tabs, Toolbar/ToolButton, Dialog, ConfirmDialog, Popover, ContextMenu, Toast incl. success, EmptyState, StatusBar), icon set, shortcut overlay, replace all `window.confirm` | Every screen reachable from the rail; no browser dialogs left; `?` lists shortcuts                              |
| U2  | **Editor**: step tabs with labelled tools, tool options bar, inspector-only side panel, map settings dialog, status bar, hover highlight, Del, drop `.glb`                                                                                                      | New user finds sculpt/wall/door tools without tooltips; side panel never longer than one screen for a selection |
| U3  | **New map wizard + Home**: drop zone, grid step with live overlay, first-steps card, sample encounter                                                                                                                                                           | Image → calibrated map in ≤ 3 steps; first run shows next actions                                               |
| U4  | **Play**: initiative strip, add dialog, turn bar with attack buttons, inspector tabs, canvas toolbar, token context menu, unplaced tray chip                                                                                                                    | A full round needs no scrolling at 1600×900                                                                     |
| U5  | **Players + Settings**: global players popover (window, monitor, LAN + QR, push camera, status), settings sections with folder picker and monitor test                                                                                                          | Player status visible on every screen; data folder changed without typing a path                                |
| U6  | **Polish**: cursors, snapping indicator, success toasts, focus/aria pass, contrast check                                                                                                                                                                        | Keyboard-only path through Play; contrast ≥ 4.5:1                                                               |

Verification per phase: GUI smoke in the running app over the WebView2 DevTools port with screenshots of each screen at
1600×900 and 1280×720, plus the flows in §7 timed by click count.

## 9. Decisions

- **Icon set:** own SVG icons in the repo (`src/ui/kit/icons.tsx`), no icon dependency.
- **Folder picker:** native folder dialog via `tauri-plugin-dialog`.
- **Sample content:** a generated, license-free sample battlemap and a sample encounter built from SRD creatures.
- **Editor steps:** tabs in the recommended order (Ground → Walls → Areas → Light & objects), free to switch.

## 10. Declutter (order of work)

Screens follow the DM's order: set up once → prepare a session → at the table → wrap up.

- **Rail:** Home · Campaigns · Maps · Compendium · Play; Search (Ctrl+K), Players, Settings at the bottom. No Server
  entry: online play lives in Settings > Players.
- **One accent button per screen state:** only the next step of the flow is accent; everything else is default or
  ghost. Rarely changed fields sit in collapsed _Advanced_ sections.
- **Home** is the current campaign's dashboard: Continue, Next session (open encounters, open quests, quick journal
  note), Recent maps. Campaign notes live in the Journal tab.
- **Players popover** is status plus one button per channel (player window, LAN, online); the details are in
  Settings > Players. **Settings** shows one section at a time (Data · Players · Graphics · Audio · Rules · Content ·
  About); version history opens as a dialog; content packs moved from the Compendium to Settings > Content.
- **Map editor:** the canvas uses the full width unless something is selected; step help is an ⓘ popover (shown
  once per step), layers a button on the canvas, light rings only in step 4 or for the selected light; Map settings
  has Map · Grid · Lighting & ground tabs; Export is in the header's ⋯ menu.
- **Compendium:** one split button per tab (New creature ▾ with the imports), filters behind a Filters button with
  removable chips.
- **Play** follows the combat state (Set up · Combat · Wrap up). Turn buttons (Previous / Next turn, before combat
  Roll initiative / Start combat) sit at the top of the initiative list. One **creature dock** under the map shows
  the selected creature (during combat otherwise the current one): HP, AC, Damage / Heal / Temp and conditions on
  the left, tabs Actions · Effects · Token · Stats · Notes on the right; it keeps a fixed height so rolls never move
  the layout, and folds to one line. The right panel holds Encounter (overview) · Table · Dice · Log · Areas. The
  map toolbar holds only map tools plus Help; the hint line only shows context hints.
- **Command search (Ctrl+K):** every destination, create action, player action, play action and library item by
  name, so rare actions don't need permanent buttons.
