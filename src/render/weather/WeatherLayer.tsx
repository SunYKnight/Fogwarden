import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { PlaneGeometry, ShaderMaterial } from 'three';
import type { Weather } from '@/core/model';
import { useDmScene } from '@/state/scene';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender } from '../mapRenderContext';

const KIND: Record<Weather, number> = { none: 0, rain: 1, snow: 2, fog: 3 };

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Procedural screen-space layers: cost is a few hash lookups per pixel and
// one draw call, independent of map size and particle count.
const FRAGMENT = /* glsl */ `
precision mediump float;
uniform float uTime;
uniform float uAspect;
uniform int uKind;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float bottom = mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x);
  float top = mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x);
  return mix(bottom, top, u.y);
}

float rain(vec2 uv, float scale, float speed) {
  vec2 p = vec2((uv.x + uv.y * 0.15) * scale * uAspect, uv.y * scale * 0.2 + uTime * speed);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float x = 0.2 + 0.6 * hash(cell);
  float streak = smoothstep(0.07, 0.0, abs(f.x - x)) * smoothstep(0.0, 0.35, f.y) * smoothstep(1.0, 0.6, f.y);
  return streak * step(0.55, hash(cell + 7.1));
}

float snow(vec2 uv, float scale, float speed) {
  vec2 p = vec2(uv.x * scale * uAspect + sin(uTime * 0.6 + uv.y * 5.0) * 0.35, uv.y * scale + uTime * speed);
  vec2 cell = floor(p);
  vec2 offset = vec2(hash(cell), hash(cell + 3.3)) - 0.5;
  float flake = smoothstep(0.09, 0.0, length(fract(p) - 0.5 - offset * 0.6));
  return flake * step(0.45, hash(cell + 9.7));
}

float mist(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, uv.y) * 2.5 + vec2(uTime * 0.03, uTime * 0.01);
  return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 5.2) + 0.15 * noise(p * 4.3 + 1.7);
}

void main() {
  vec4 color = vec4(0.0);
  if (uKind == 1) {
    float a = rain(vUv, 18.0, 2.6) + rain(vUv, 30.0, 3.4) * 0.7 + rain(vUv, 46.0, 4.2) * 0.5;
    color = vec4(0.75, 0.82, 0.95, min(1.0, a) * 0.45);
  } else if (uKind == 2) {
    float a = snow(vUv, 9.0, 0.35) + snow(vUv, 15.0, 0.25) * 0.8 + snow(vUv, 24.0, 0.18) * 0.6;
    color = vec4(1.0, 1.0, 1.0, min(1.0, a) * 0.85);
  } else if (uKind == 3) {
    color = vec4(0.78, 0.8, 0.84, smoothstep(0.25, 0.85, mist(vUv)) * 0.6);
  }
  gl_FragColor = color;
}
`;

/** Rain, snow or fog of the scene drawn over the map in DM and player views (not in the editor). */
export function WeatherLayer() {
  const { mode } = useMapRender();
  const dmWeather = useDmScene()?.weather ?? 'none';
  const playerWeather = usePlayerStore((s) => s.scene?.weather ?? 'none');
  const weather = mode === 'dm' ? dmWeather : mode === 'player' ? playerWeather : 'none';
  const size = useThree((s) => s.size);
  const geometry = useMemo(() => new PlaneGeometry(2, 2), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uKind: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    material.uniforms.uKind!.value = KIND[weather];
    material.uniforms.uAspect!.value = size.width / Math.max(1, size.height);
  }, [material, weather, size]);

  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
  });

  return (
    weather !== 'none' && (
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={1000} raycast={() => null} />
    )
  );
}
