import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

export function createUpsideDownGranny(scene, camera, sourceHead, reducedMotion) {
  const anchor = new TransformNode('Upside-down Granny encounter', scene);
  anchor.parent = camera;
  anchor.rotation.z = Math.PI;
  const head = sourceHead.clone('Upside-down Granny head', anchor, false);
  head.position.set(0, -0.13, 0);
  head.rotationQuaternion = null;
  head.rotation.set(0, 0, 0);
  head.scaling.setAll(1);
  const black = new StandardMaterial('Upside-down Granny black eyes', scene);
  black.diffuseColor = Color3.Black();
  black.specularColor = Color3.Black();
  black.emissiveColor = Color3.Black();
  black.disableLighting = true;
  for (const mesh of head.getChildMeshes()) {
    mesh.isPickable = false;
    mesh.renderingGroupId = 2;
    if (/(?:Eye|Iris) -?1$/.test(mesh.name)) mesh.material = black;
  }
  let state = 'hidden';
  let started = 0;
  let amount = 0;
  let exitFrom = 0;
  anchor.setEnabled(false);
  const ease = (value) => value * value * (3 - 2 * value);
  return {
    show(now) {
      state = 'entering'; started = now; amount = 0;
      anchor.setEnabled(true);
    },
    dismiss(now) {
      if (state === 'hidden') return;
      state = 'leaving'; started = now; exitFrom = amount;
    },
    hide() { state = 'hidden'; anchor.setEnabled(false); },
    update(now, pressure = 0) {
      if (state === 'hidden') return;
      if (state === 'entering') amount = reducedMotion ? 1 : ease(Math.min(1, (now - started) / 600));
      else if (state === 'leaving') {
        amount = reducedMotion ? 0 : exitFrom * (1 - ease(Math.min(1, (now - started) / 350)));
        if (amount === 0) { state = 'hidden'; anchor.setEnabled(false); return; }
      }
      // Camera-space sizing confines the isolated head to the upper part of the
      // viewport at every aspect ratio. The near row stays clear and clickable.
      const depth = 1.05;
      const halfHeight = depth * Math.tan(camera.fov / 2);
      anchor.position.set(0, halfHeight * (0.48 + 1.45 * (1 - amount)), -depth);
      anchor.scaling.setAll(0.34 * 2 * halfHeight / 0.30 * (1 + pressure * 0.025));
    },
  };
}
