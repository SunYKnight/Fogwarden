import { createMap, type BattleMap } from '@/core/model';
import type { Repository } from '@/data/repository';

/** Battlemap exports commonly use 70 px per square when the file name gives no grid size. */
const DEFAULT_PX_PER_SQUARE = 70;

/** Grid size from names like "52x49_tavern.jpg" (squares wide x squares high). */
export function gridFromFileName(name: string): { squaresX: number; squaresY: number } | null {
  const match = /(\d{1,3})\s*x\s*(\d{1,3})/i.exec(name);
  return match ? { squaresX: Number(match[1]), squaresY: Number(match[2]) } : null;
}

export async function createMapFromImage(repository: Repository, file: File): Promise<BattleMap> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  const fromName = gridFromFileName(file.name);
  const squaresX = fromName?.squaresX ?? Math.max(1, Math.round(width / DEFAULT_PX_PER_SQUARE));
  const squaresY = fromName?.squaresY ?? Math.max(1, Math.round(height / DEFAULT_PX_PER_SQUARE));
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const map = createMap({ name, image: null, squaresX, squaresY, pxPerSquare: width / squaresX });
  const asset = await repository.importMapAsset(map.id, file.name, new Uint8Array(await file.arrayBuffer()));
  return repository.save('map', { ...map, image: { asset, widthPx: width, heightPx: height } });
}
