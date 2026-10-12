/**
 * Project icon set: 24x24 outline glyphs drawn with 2px round strokes in `currentColor`.
 * Each entry is a list of SVG path `d` strings; circles are written as two arcs so one primitive suffices.
 */
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICON_PATHS = {
  home: ['M3 11l9-7 9 7', 'M5 10v10h5v-6h4v6h5V10'],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
  book: ['M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z', 'M4 19V5', 'M8 7h7'],
  swords: ['M14 4h6v6L9 21l-3-3z', 'M4 14l6 6', 'M3 21l3-3', 'M10 4H4v6l3 3'],
  play: ['M7 4l13 8-13 8z'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  settings: [
    circle(12, 12, 3),
    'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
  copy: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  undo: ['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', circle(12, 12, 3)],
  eyeOff: [
    'M3 3l18 18',
    'M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6',
    'M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
    'M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17l9 5 9-5'],
  grid: ['M4 4h16v16H4z', 'M4 10h16M4 15h16M10 4v16M15 4v16'],
  cursor: ['M5 3l14 7-6 2-2 6z'],
  calibrate: ['M4 4h6v6H4z', 'M14 14h6v6h-6z', 'M10 10l4 4', 'M17 4v6M14 7h6M4 17h6M7 14v6'],
  raise: ['M3 20h18', 'M6 20c2-6 4-10 6-10s4 4 6 10', 'M12 3v4M10 5l2-2 2 2'],
  lower: ['M3 9h18', 'M6 9c2 6 4 10 6 10s4-4 6-10', 'M12 3v4M10 5l2 2 2-2'],
  smooth: ['M3 12c3-4 6-4 9 0s6 4 9 0', 'M3 18c3-2 6-2 9 0s6 2 9 0'],
  flatten: ['M3 16h18', 'M5 12h14', 'M8 8h8'],
  ramp: ['M3 20h18', 'M3 20L21 8v12'],
  terrace: ['M3 20h18', 'M5 20v-4h4v-4h4V8h4V4h3'],
  noise: ['M3 14l2-4 2 6 2-8 2 7 2-5 2 6 2-3 2 3 2-2'],
  wall: ['M3 5h18v14H3z', 'M3 10h18M3 14h18', 'M9 5v5M15 5v5M6 10v4M12 10v4M18 10v4M9 14v5M15 14v5'],
  door: ['M5 21V4h11v17', 'M3 21h18', 'M16 6l3 1v13l-3 1', 'M13 12h.01'],
  room: ['M3 10l9-6 9 6', 'M5 9v11h14V9', 'M10 20v-6h4v6'],
  region: ['M5 7l7-4 7 5-1 9-8 4-6-6z'],
  light: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'],
  cube: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5', 'M12 12v9', 'M12 12L4 7.5'],
  ruler: ['M3 17L17 3l4 4L7 21z', 'M7 13l2 2M10 10l2 2M13 7l2 2'],
  area: [circle(12, 12, 8), circle(12, 12, 3), 'M12 2v2M12 20v2M2 12h2M20 12h2'],
  dice: ['M4 4h16v16H4z', 'M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01'],
  list: ['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  search: [circle(11, 11, 7), 'M16 16l5 5'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v4h16v-4'],
  folder: ['M3 6h6l2 2h10v11H3z'],
  wifi: ['M2 9a15 15 0 0 1 20 0', 'M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 19.5h.01'],
  camera: ['M3 8h4l2-3h6l2 3h4v11H3z', circle(12, 13, 3.5)],
  fog: ['M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11.5-1.5A4.5 4.5 0 0 0 6 18z', 'M4 21h16'],
  check: ['M5 12l5 5 9-10'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17h.01'],
  info: [circle(12, 12, 9), 'M12 11v5', 'M12 8h.01'],
  help: [circle(12, 12, 9), 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5', 'M12 17h.01'],
  next: ['M5 5l9 7-9 7z', 'M18 5v14'],
  previous: ['M19 5l-9 7 9 7z', 'M6 5v14'],
  heart: ['M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  user: [circle(12, 8, 4), 'M4 21a8 8 0 0 1 16 0'],
  users: [circle(9, 8, 3.5), 'M2 20a7 7 0 0 1 14 0', 'M16 4.5a3.5 3.5 0 0 1 0 7', 'M18 14a6 6 0 0 1 4 6'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  image: ['M3 4h18v16H3z', circle(8.5, 9.5, 1.5), 'M21 16l-5-5-9 9'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICON_PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  /** Accessible name; omit for decorative icons next to a visible label. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 18, title, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
