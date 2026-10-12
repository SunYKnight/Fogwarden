import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Texture,
} from 'three';
import type { Side } from '@/core/model';
import { cardHeightRatio, coverWindow } from './standee';

/**
 * Geometry and materials shared by every token: thirty tokens on the map need a handful of GPU buffers
 * and shader states, not a set per token.
 */

export const SIDE_COLORS: Record<Side, string> = {
  player: '#3d8bfd',
  ally: '#46b45a',
  enemy: '#e04040',
  neutral: '#e0c040',
};

export const CURRENT_COLOR = '#ffc940';
export const SELECTED_COLOR = '#ffffff';
const PLAIN_TOP_COLOR = '#2a2d35';
const GHOST_OPACITY = 0.4;
// Unlit enough to stay recognisable in dark maps, lit enough to sit in them.
const CARD_GLOW = 0.35;

/** Material of a token part in normal and ghost (hidden from players, drag preview) look. */
export interface Looks<M> {
  solid: M;
  ghost: M;
}

function looks<M extends MeshBasicMaterial | MeshStandardMaterial>(create: (ghost: boolean) => M): Looks<M> {
  return { solid: create(false), ghost: create(true) };
}

function ghostParams(ghost: boolean) {
  return { transparent: ghost, opacity: ghost ? GHOST_OPACITY : 1, depthWrite: !ghost };
}

function solidColor(color: string): Looks<MeshStandardMaterial> {
  return looks((ghost) => new MeshStandardMaterial({ color, roughness: 0.8, ...ghostParams(ghost) }));
}

/** Unit shapes standing on y = 0 (flat ones lying in it); meshes scale them to the token size. */
export const TOKEN_GEOMETRY = {
  cylinder: new CylinderGeometry(1, 1, 1, 40).translate(0, 0.5, 0),
  circle: new CircleGeometry(1, 40).rotateX(-Math.PI / 2),
  box: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  plane: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
};

export const SIDE_MATERIALS: Record<Side, Looks<MeshStandardMaterial>> = {
  player: solidColor(SIDE_COLORS.player),
  ally: solidColor(SIDE_COLORS.ally),
  enemy: solidColor(SIDE_COLORS.enemy),
  neutral: solidColor(SIDE_COLORS.neutral),
};

export const FRAME_MATERIALS = { current: solidColor(CURRENT_COLOR), selected: solidColor(SELECTED_COLOR) };

export const PLAIN_TOP_MATERIALS = looks(
  (ghost) => new MeshBasicMaterial({ color: PLAIN_TOP_COLOR, ...ghostParams(ghost) }),
);

export const RING_MATERIALS = {
  current: new MeshBasicMaterial({ color: CURRENT_COLOR }),
  selected: new MeshBasicMaterial({ color: SELECTED_COLOR }),
};

const rings = new Map<string, BufferGeometry>();

/** Flat ring around a token; a few radii per creature size exist, so they are built once each. */
export function ringGeometry(inner: number, outer: number): BufferGeometry {
  const key = `${inner}:${outer}`;
  const ring = rings.get(key) ?? new RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2);
  rings.set(key, ring);
  return ring;
}

function cardMaterials(map: Texture): Looks<MeshStandardMaterial> {
  return looks(
    (ghost) =>
      new MeshStandardMaterial({
        map,
        emissive: '#ffffff',
        emissiveMap: map,
        emissiveIntensity: CARD_GLOW,
        roughness: 0.9,
        // Transparent parts of PNG art show the card behind them.
        alphaTest: 0.5,
        // Billboards turn either face to a light; both must cast.
        shadowSide: DoubleSide,
        ...ghostParams(ghost),
      }),
  );
}

/** Picture materials of one texture: cropped to a circle on the disc and to the card on the standee. */
export interface PortraitLook {
  disc: Looks<MeshBasicMaterial>;
  card: Looks<MeshStandardMaterial>;
  /** Card height divided by card width. */
  cardRatio: number;
}

const portraitLooks = new WeakMap<Texture, PortraitLook>();

function croppedCopy(texture: Texture, imageAspect: number, frameAspect: number): Texture {
  const copy = texture.clone();
  const crop = coverWindow(imageAspect, frameAspect);
  copy.repeat.set(crop.repeatX, crop.repeatY);
  copy.offset.set(crop.offsetX, crop.offsetY);
  return copy;
}

function createPortraitLook(texture: Texture): PortraitLook {
  const { width, height } = texture.image as { width: number; height: number };
  const aspect = width / height;
  const cardRatio = cardHeightRatio(aspect);
  // Copies share the decoded image (three.js Source), so the GPU holds it once.
  const discMap = croppedCopy(texture, aspect, 1);
  const cardMap = croppedCopy(texture, aspect, 1 / cardRatio);
  const look: PortraitLook = {
    disc: looks((ghost) => new MeshBasicMaterial({ map: discMap, ...ghostParams(ghost) })),
    card: cardMaterials(cardMap),
    cardRatio,
  };
  texture.addEventListener('dispose', () => {
    for (const material of [look.disc.solid, look.disc.ghost, look.card.solid, look.card.ghost]) {
      material.dispose();
    }
    discMap.dispose();
    cardMap.dispose();
  });
  return look;
}

/** Shared materials for a token texture; they are disposed together with the texture. */
export function portraitLook(texture: Texture): PortraitLook {
  const look = portraitLooks.get(texture) ?? createPortraitLook(texture);
  portraitLooks.set(texture, look);
  return look;
}

const INITIALS_WIDTH_PX = 256;

/** Card picture for a token without image: initials in white on the side color. */
export function initialsCard(
  initials: string,
  color: string,
): { texture: Texture; materials: Looks<MeshStandardMaterial> } {
  const canvas = document.createElement('canvas');
  canvas.width = INITIALS_WIDTH_PX;
  canvas.height = Math.round(INITIALS_WIDTH_PX * cardHeightRatio(null));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas is unavailable');
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontPx = Math.min(120, Math.floor((canvas.width * 0.85) / Math.max(1, initials.length * 0.62)));
  ctx.font = `700 ${fontPx}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillText(initials, canvas.width / 2, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, materials: cardMaterials(texture) };
}

const ICON_CARD_PX = 256;
/** Icon edge per card edge with and without a number below it. */
const ICON_SCALE = { numbered: 0.56, plain: 0.72 };

/**
 * Square picture for a token without image: the creature type icon (`iconPath` in a `iconView` square) in the
 * side color on the plain token color, with the combatant's number below it. Disc and card use it like a portrait.
 */
export function typeIconTexture(iconPath: string, iconView: number, color: string, number: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_CARD_PX;
  canvas.height = ICON_CARD_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas is unavailable');
  }
  ctx.fillStyle = PLAIN_TOP_COLOR;
  ctx.fillRect(0, 0, ICON_CARD_PX, ICON_CARD_PX);
  const iconPx = ICON_CARD_PX * (number ? ICON_SCALE.numbered : ICON_SCALE.plain);
  // The disc crops the square to a circle: icon and number stay inside it.
  const top = number ? ICON_CARD_PX * 0.1 : (ICON_CARD_PX - iconPx) / 2;
  ctx.save();
  ctx.translate((ICON_CARD_PX - iconPx) / 2, top);
  ctx.scale(iconPx / iconView, iconPx / iconView);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(iconPath));
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(ICON_CARD_PX * 0.2)}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillText(number, ICON_CARD_PX / 2, top + iconPx + ICON_CARD_PX * 0.13);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
