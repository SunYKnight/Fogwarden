import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { DoubleSide, MeshBasicMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import type { Region, RegionKind } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import type { ProjectionUniforms } from '../materials/projectedMaterial';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { drapedPath, drapedPolygonGeometry } from './drape';
import { noRaycast, useDisposable, useLayerVisible } from './hooks';

const REGION_LIFT_FT = 0.2;
const REGION_OPACITY = 0.3;

/** Region kinds players see; the others only change rules (movement), lighting or sound. */
const PLAYER_VISIBLE: Record<RegionKind, boolean> = {
  light: false,
  difficult: false,
  water: false,
  hazard: true,
  note: true,
  sound: false,
};

// Players must not learn about regions in cells they have never seen.
const FOG_DISCARD = /* glsl */ `
if (uFogMode > 1.5 && texture2D(uFog, vRegionWorld.xz / uMapSizeFt).r < 0.25) discard;
#include <opaque_fragment>
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vRegionWorld;
uniform sampler2D uFog;
uniform float uFogMode;
uniform vec2 uMapSizeFt;
`;

function createRegionMaterial(uniforms: ProjectionUniforms, color: string): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: REGION_OPACITY,
    depthWrite: false,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, {
      uFog: uniforms.uFog,
      uFogMode: uniforms.uFogMode,
      uMapSizeFt: uniforms.uMapSizeFt,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRegionWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvRegionWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAGMENT_DECL}`)
      .replace('#include <opaque_fragment>', FOG_DISCARD);
  };
  material.customProgramCacheKey = () => 'region-fog-v1';
  return material;
}

interface RegionViewProps {
  region: Region;
  terrain: HeightField;
  terrainVersion: number;
  uniforms: ProjectionUniforms;
  /** Outlines ignore fog, so player views draw the fogged fill only. */
  outline: boolean;
}

function RegionView({ region, terrain, terrainVersion, uniforms, outline }: RegionViewProps) {
  const geometry = useDisposable(
    () => drapedPolygonGeometry(region.polygon, terrain, REGION_LIFT_FT),
    [region.polygon, terrain, terrainVersion],
  );
  const material = useDisposable(() => createRegionMaterial(uniforms, region.color), [uniforms, region.color]);
  const outlinePoints = useMemo(
    () => drapedPath(region.polygon, true, terrain, REGION_LIFT_FT + 0.05),
    // terrainVersion: the field is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region.polygon, terrain, terrainVersion],
  );
  const hit: HitTag = { kind: 'region', id: region.id };
  return (
    <group>
      <mesh geometry={geometry} material={material} userData={{ hit }} renderOrder={1} />
      {outline && <Line points={outlinePoints} color={region.color} lineWidth={2} raycast={noRaycast} />}
    </group>
  );
}

/**
 * Translucent region polygons draped over the terrain. Editor and DM see all of them; players only
 * see visual kinds that are not hidden.
 */
export function RegionLayer() {
  const { map, terrain, settledTerrainVersion, uniforms, mode } = useMapRender();
  const visible = useLayerVisible('regions');
  const shown = map.regions.filter((r) => mode !== 'player' || (!r.hiddenFromPlayers && PLAYER_VISIBLE[r.kind]));
  return visible ? (
    <group>
      {shown.map((region) => (
        <RegionView
          key={region.id}
          region={region}
          terrain={terrain}
          terrainVersion={settledTerrainVersion}
          uniforms={uniforms}
          outline={mode !== 'player'}
        />
      ))}
    </group>
  ) : null;
}
