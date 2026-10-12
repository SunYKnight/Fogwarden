# Changelog

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
