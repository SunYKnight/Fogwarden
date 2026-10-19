# Online play plan

Goal: players use Fogwarden like a virtual tabletop (Roll20-style: own sheet, notes, chat, rolls, handouts) over the
internet relay, while table play (player window, LAN phones) keeps working unchanged. Companion to `PLAN.md` and
`docs/ARCHITECTURE.md` ("Encounters and player view", "Internet relay", "Player devices").

## Decisions

- **The DM app stays the only authority.** Players see what the DM app publishes and change things only through
  requests the DM app checks and applies (`handlePlayerRequest`, `src/sync/playerRequests.ts`). The relay stays a
  forwarder plus asset store; data stays plain files in the DM's data folder.
- **Sessions run while the DM app runs.** Access between sessions (players reading sheets while the DM is offline)
  is phase 5 and needs a separate decision: it makes the relay a stateful server with a database, backups and
  personal data.
- **One code path for table and online.** Every feature goes over `DmTransport` (player window, LAN, relay) and is a
  per-campaign switch, like `playersMoveTokens`. Off by default, so a table group sees no change. The party view (TV
  or second screen) never shows sheets, notes or chat.
- **Identity stays the link.** A character's link token (HMAC, `linkToken`) is the player's login; "New link" in
  `PlayerLinks` revokes it. No accounts.

## Phase 0: relay on a real server (prerequisite)

`ONLINE_PLAY_AVAILABLE = false` (`src/ui/server/OnlineSection.tsx`) hides all of online play until it has run
against a real server (`PLAN.md`, "To do: online play").

1. DNS: `fogwarden.homejj.ch` A `83.228.243.48`, AAAA `2001:1600:18:202::258`.
2. Deploy with the install script (nginx-manager mode, relay port 7718).
3. Turn `ONLINE_PLAY_AVAILABLE` on in a dev build, connect, open a character link on a phone over mobile data.
   Check map, fog, token moves, rolls, handouts, music, reconnect after airplane mode, link rotation.
4. Fix what breaks, switch the flag on, add the search keywords back, release.

Acceptance: the PLAN.md checklist passes from a phone on mobile data; `nginx-manager list` shows the other five
sites unchanged.

## Phase 1: full character sheet, read-only

The sheet today is combat numbers only (`PlayerSheet` in `src/sync/protocol.ts`, `playerSheet` in the publisher).

- Model: `characterSheetSchema` in `src/core/model/character.ts` (schema + version, migration in
  `src/data/migrations.ts`): ability scores, saves, skills with proficiency/expertise, features and traits (name,
  source, Markdown text), spells known/prepared by level, inventory (item refs or free text, quantity, equipped,
  attuned), currency, background, personality, appearance. Stored next to the creature as
  `creatures/<id>.sheet.json` in the Aurora pack or My content (data formats: pretty JSON, readable).
- Import: `runAuroraImport` (`src/data/auroraImport.ts`) already computes the build. Write the sheet alongside the
  creature; keep the creature as the combat summary.
- Sync: `PlayerSheet` gains `details` (the sheet) sent only to that character's view; bump
  `SYNC_PROTOCOL_VERSION` to 3. Big parts (feature texts) only on change, like `map` with `revision`.
- UI: `PlayerSheetPanel` (`src/ui/player/PlayerSheet.tsx`) gets tabs Combat · Skills · Spells · Inventory ·
  Features; skills and saves get roll buttons that send the existing `roll` request with the label.
- DM: Party tab and Compendium > Players show the same sheet (shared component).

Acceptance: an Aurora character shows all tabs on a phone; another view never receives that sheet (test in
`playerFilter.test.ts`); party view shows no sheet.

## Phase 2: chat, shared rolls, private notes

- Requests (`playerMessageSchema`, `rebuildPlayerMessage`, `rebuild_player_message` in `lan.rs`, relay; same rate
  limit):
  - `chat` { text ≤ 500, to: 'all' | 'dm' } → DM appends to `encounter.chat` (bounded, 200 lines), publisher sends
    the lines each view may see. Whispers to the DM only reach the DM.
  - `roll` gains `share: boolean`; shared rolls go to every character view and the chat.
  - `note` { text ≤ 20 000 } → DM saves `campaigns/<id>/players/<view>/notes.md`; sent back only to that view.
    The DM can read them (stated in the UI).
- DM UI: Chat tab in the Inspector next to Log; DM messages to all or one view (reuses the handout audience picker
  of `ShowPanel`).
- Player UI: chat drawer, notes tab on the sheet (`NotesEditor` style, saves 800 ms after typing).
- Switches per campaign: chat, shared rolls, player notes.

Acceptance: a whisper never reaches another view (filter test); notes survive DM app restart; table group with
switches off sees no change.

## Phase 3: players edit their sheet

- Request `sheetEdit` { field path from an allowlist, value } for HP (current, temp), spell slots used, hit dice,
  inventory quantity/equipped, currency, death saves, conditions the player may set (none by default).
- DM side: `applySheetEdit` checks the field, the view owns the character, ranges; applies as one undo step with a
  log line ("Thorin: HP 12 → 7"). Per-campaign switch: apply at once, or queue for DM approval (approval list in
  the Party tab).
- Conflicts: last write wins; the DM's own change during a pending approval discards the request with a notice.

Acceptance: a player sets HP from the phone, the DM sees it and can undo; edits to another character's fields are
refused by the relay and the DM app (tests on both sides).

## Phase 4: player uploads

- Relay and LAN routes `PUT /api/player-asset/{view}/{name}?token=` for portraits and handout replies: images only
  (PNG, JPEG, WebP, sniffed, not by extension), ≤ 10 MB, 20 files per view, stored apart from DM assets.
- The relay announces uploads to the DM; the DM app downloads them into
  `campaigns/<id>/players/<view>/uploads/` and only then may publish them. Nothing a player uploads reaches another
  player without passing the DM app.
- Character import: a player uploads an Aurora `.dnd5e`; the DM confirms, `runAuroraImport` maps it.

Acceptance: oversize, wrong type and path tricks are refused (relay tests next to `relayServer.test.ts`); a player
portrait shows on their token after DM confirmation.

## Phase 5 (decide later): between sessions

Relay keeps the last published state per view (sheet, notes, handouts) so players can read them offline from the
DM; edits wait in a relay queue the DM app applies on connect. Needs: encrypted storage on the relay, retention,
export/delete per player, conflict rules. Only after phases 1–4 are used.

## Out of scope

Voice/video (use Discord), accounts, marketplace, automated spell resolution (`PLAN.md` non-goals).

## Order and size

| Phase | Depends on | Rough size |
| ----- | ---------- | ---------- |
| 0     | DNS record | 1–2 days   |
| 1     | 0          | 1–2 weeks  |
| 2     | 0          | 1 week     |
| 3     | 1          | 1 week     |
| 4     | 0          | 1 week     |
| 5     | 1–4        | open       |

`PLAN.md` "Non-goals" lists online multiplayer and character sheet management; update it when phase 1 starts.
