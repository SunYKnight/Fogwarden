import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { SideMaterial } from '@/core/model';

const SIZE = 256;

// Deterministic noise keeps textures identical across sessions and windows.
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function speckle(ctx: CanvasRenderingContext2D, seed: number, count: number, alpha: number, light: boolean): void {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const shade = light ? 255 : 0;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha * rand()})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1 + rand() * 3, 1 + rand() * 3);
  }
}

function drawBricks(ctx: CanvasRenderingContext2D, base: string, mortar: string, rows: number, cols: number): void {
  const rand = rng(7);
  const bh = SIZE / rows;
  const bw = SIZE / cols;
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 === 0 ? 0 : bw / 2;
    for (let c = -1; c <= cols; c++) {
      ctx.fillStyle = base;
      ctx.globalAlpha = 0.75 + rand() * 0.25;
      ctx.fillRect(c * bw + shift + 2, r * bh + 2, bw - 4, bh - 4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawStone(ctx: CanvasRenderingContext2D): void {
  const rand = rng(11);
  ctx.fillStyle = '#5c5a55';
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 46; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 18 + rand() * 26;
    const g = 110 + Math.floor(rand() * 50);
    ctx.fillStyle = `rgb(${g},${g - 4},${g - 10})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWood(ctx: CanvasRenderingContext2D): void {
  const rand = rng(23);
  for (let x = 0; x < SIZE; x += 32) {
    ctx.fillStyle = `rgb(${110 + rand() * 30},${72 + rand() * 20},${40 + rand() * 12})`;
    ctx.fillRect(x, 0, 32, SIZE);
    ctx.fillStyle = 'rgba(40,24,10,0.6)';
    ctx.fillRect(x, 0, 2, SIZE);
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = 'rgba(60,35,15,0.25)';
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1, 20 + rand() * 60);
  }
}

function fill(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

function paint(material: SideMaterial, ctx: CanvasRenderingContext2D): void {
  switch (material) {
    case 'brick':
      drawBricks(ctx, '#9a4b34', '#c9bfae', 8, 4);
      speckle(ctx, 3, 900, 0.25, false);
      break;
    case 'stone':
      drawStone(ctx);
      speckle(ctx, 5, 1200, 0.2, false);
      break;
    case 'wood':
      drawWood(ctx);
      break;
    case 'plaster':
      fill(ctx, '#d8d0c0');
      speckle(ctx, 13, 1500, 0.12, false);
      break;
    case 'hedge':
      fill(ctx, '#2f5a26');
      speckle(ctx, 17, 2500, 0.5, false);
      speckle(ctx, 19, 1500, 0.25, true);
      break;
    case 'rock':
      fill(ctx, '#77736b');
      speckle(ctx, 29, 3000, 0.35, false);
      speckle(ctx, 31, 1500, 0.2, true);
      break;
    case 'metal':
      fill(ctx, '#8c9196');
      speckle(ctx, 37, 600, 0.15, true);
      break;
    case 'projected':
      fill(ctx, '#ffffff');
      break;
  }
}

const cache = new Map<SideMaterial, CanvasTexture>();

/** Tileable texture for wall sides and cliffs; one repeat covers 5 ft. */
export function sideTexture(material: SideMaterial): CanvasTexture {
  let texture = cache.get(material);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas is unavailable');
    }
    paint(material, ctx);
    texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    cache.set(material, texture);
  }
  return texture;
}
