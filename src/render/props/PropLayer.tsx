import { useCallback, useEffect } from 'react';
import { Mesh, type Material, type Object3D } from 'three';
import type { Prop, SideMaterial } from '@/core/model';
import { createProjectedMaterial, type ProjectionUniforms } from '../materials/projectedMaterial';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { useLayerVisible } from '../structures/hooks';
import { usePropObjects } from './propObjects';
import { useModel } from './useModel';

const DEG = Math.PI / 180;

interface PropViewProps {
  prop: Prop;
  uniforms: ProjectionUniforms;
  cliffMaterial: SideMaterial;
  cliffSlopeDeg: number;
}

function PropView({ prop, uniforms, cliffMaterial, cliffSlopeDeg }: PropViewProps) {
  const model = useModel(prop.asset);
  const register = usePropObjects((s) => s.register);
  const { id, projectMap } = prop;

  // Projected props drape the battlemap; steep faces look like cliffs.
  useEffect(() => {
    const material =
      projectMap && model
        ? createProjectedMaterial(uniforms, { side: cliffMaterial, sideFromSlopeDeg: cliffSlopeDeg })
        : null;
    const originals: [Mesh, Material | Material[]][] = [];
    model?.traverse((child) => {
      if (material && child instanceof Mesh) {
        originals.push([child, child.material]);
        child.material = material;
      }
    });
    return () => {
      for (const [mesh, original] of originals) {
        mesh.material = original;
      }
      material?.dispose();
    };
  }, [model, projectMap, uniforms, cliffMaterial, cliffSlopeDeg]);

  const ref = useCallback(
    (object: Object3D | null) => {
      register(id, object);
      return () => register(id, null);
    },
    [id, register],
  );

  const hit: HitTag = { kind: 'prop', id };
  return (
    <group
      ref={ref}
      position={prop.position}
      rotation={[prop.rotationDeg[0] * DEG, prop.rotationDeg[1] * DEG, prop.rotationDeg[2] * DEG]}
      scale={prop.scale}
      userData={{ hit }}
    >
      {model && <primitive object={model} />}
    </group>
  );
}

/** Imported glTF/GLB models placed on the map, optionally with the battlemap projected onto them. */
export function PropLayer() {
  const { map, uniforms } = useMapRender();
  const visible = useLayerVisible('props');
  return visible ? (
    <group>
      {map.props.map((prop) => (
        <PropView
          key={prop.id}
          prop={prop}
          uniforms={uniforms}
          cliffMaterial={map.terrain.cliffMaterial}
          cliffSlopeDeg={map.terrain.cliffSlopeDeg}
        />
      ))}
    </group>
  ) : null;
}
