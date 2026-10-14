import {
  Color,
  DataTexture,
  Matrix3,
  MeshStandardMaterial,
  RedFormat,
  UnsignedByteType,
  Vector2,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { SideMaterial } from '@/core/model';
import { FOG_VISIBLE } from '@/core/vision/fog';
import { sideTexture } from './sideTextures';

export type FogMode = 'off' | 'dm' | 'player';
export const FOG_MODE_VALUE: Record<FogMode, number> = { off: 0, dm: 1, player: 2 };

/**
 * Uniforms shared by every surface of one map (terrain, walls, roofs, props), so changing the image,
 * calibration, grid or fog updates all materials without recompiling shaders.
 */
export interface ProjectionUniforms {
  uMap: { value: Texture | null };
  uHasMap: { value: number };
  uWorldToUv: { value: Matrix3 };
  uBaseColor: { value: Color };
  uGridShow: { value: number };
  uGridSize: { value: number };
  uGridCount: { value: Vector2 };
  uGridColor: { value: Color };
  uGridOpacity: { value: number };
  uFog: { value: DataTexture };
  uFogMode: { value: number };
  /** Map size in feet; fog texels cover the whole map. */
  uMapSizeFt: { value: Vector2 };
}

export function createProjectionUniforms(): ProjectionUniforms {
  const fog = new DataTexture(new Uint8Array([FOG_VISIBLE]), 1, 1, RedFormat, UnsignedByteType);
  fog.needsUpdate = true;
  return {
    uMap: { value: null },
    uHasMap: { value: 0 },
    uWorldToUv: { value: new Matrix3() },
    uBaseColor: { value: new Color('#5d6b3a') },
    uGridShow: { value: 1 },
    uGridSize: { value: 5 },
    uGridCount: { value: new Vector2(1, 1) },
    uGridColor: { value: new Color('#000000') },
    uGridOpacity: { value: 0.35 },
    uFog: { value: fog },
    uFogMode: { value: 0 },
    uMapSizeFt: { value: new Vector2(5, 5) },
  };
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vProjWorld;
varying vec3 vProjNormal;
`;

const VERTEX_BODY = /* glsl */ `
vProjWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vProjNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vProjWorld;
varying vec3 vProjNormal;
uniform sampler2D uMap;
uniform float uHasMap;
uniform mat3 uWorldToUv;
uniform vec3 uBaseColor;
uniform float uGridShow;
uniform float uGridSize;
uniform vec2 uGridCount;
uniform vec3 uGridColor;
uniform float uGridOpacity;
uniform sampler2D uFog;
uniform float uFogMode;
uniform vec2 uMapSizeFt;
uniform sampler2D uSideTex;
uniform float uUseSide;
uniform float uSideCos;
uniform float uSideTint;

vec3 projTriplanar(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 x = texture2D(uSideTex, p.zy).rgb;
  vec3 y = texture2D(uSideTex, p.xz).rgb;
  vec3 z = texture2D(uSideTex, p.xy).rgb;
  return x * w.x + y * w.y + z * w.z;
}
`;

// Replaces <map_fragment>: uses the battlemap pixel straight below.
const FRAGMENT_BODY = /* glsl */ `
{
  vec2 projUv = (uWorldToUv * vec3(vProjWorld.x, vProjWorld.z, 1.0)).xy;
  bool insideImage = all(greaterThanEqual(projUv, vec2(0.0))) && all(lessThanEqual(projUv, vec2(1.0)));
  vec3 projected = uHasMap > 0.5 && insideImage ? texture2D(uMap, projUv).rgb : uBaseColor;
  vec3 n = normalize(vProjNormal);
  float upness = abs(n.y);
  float sideAmount = uUseSide * (1.0 - smoothstep(uSideCos - 0.04, uSideCos + 0.04, upness));
  vec3 sideColor = projTriplanar(vProjWorld / 5.0, n) * mix(vec3(1.0), projected * 1.6, uSideTint);
  vec3 surface = mix(projected, sideColor, sideAmount);

  vec2 g = vProjWorld.xz / uGridSize;
  vec2 gd = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
  float line = 1.0 - min(min(gd.x, gd.y), 1.0);
  float inGrid = step(0.0, g.x) * step(0.0, g.y) * step(g.x, uGridCount.x) * step(g.y, uGridCount.y);
  surface = mix(surface, uGridColor, line * uGridOpacity * uGridShow * inGrid * (1.0 - sideAmount));

  if (uFogMode > 0.5) {
    float fog = texture2D(uFog, vProjWorld.xz / uMapSizeFt).r;
    float gray = dot(surface, vec3(0.299, 0.587, 0.114));
    vec3 explored = mix(vec3(gray), surface, 0.35) * 0.45;
    vec3 unknown = uFogMode > 1.5 ? vec3(0.0) : surface * 0.35;
    vec3 hidden = fog > 0.25 ? explored : unknown;
    surface = fog > 0.75 ? surface : hidden;
  }
  diffuseColor.rgb *= surface;
}
`;

export interface ProjectedMaterialOptions {
  side: SideMaterial;
  /** Faces whose |normal.y| is below cos(this angle) use the side material. */
  sideFromSlopeDeg: number;
  /** How much the projected battlemap color tints the side texture (0..1). */
  sideTint?: number;
}

/** Lit material that shows the battlemap from above and a tileable texture on steep faces. */
export function createProjectedMaterial(
  shared: ProjectionUniforms,
  options: ProjectedMaterialOptions,
): MeshStandardMaterial {
  const local = {
    uSideTex: { value: sideTexture(options.side) },
    uUseSide: { value: options.side === 'projected' ? 0 : 1 },
    uSideCos: { value: Math.cos((options.sideFromSlopeDeg * Math.PI) / 180) },
    uSideTint: { value: options.sideTint ?? 0.35 },
  };
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, shared, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
      .replace('#include <map_fragment>', FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => 'projected-map-v1';
  material.userData.projection = local;
  return material;
}
