import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';

export function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function material(scene, name, color, texture) {
  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = Color3.FromHexString(color);
  surface.specularColor = new Color3(0.08, 0.062, 0.043);
  surface.specularPower = 24;
  if (texture) surface.diffuseTexture = texture;
  return surface;
}

export function grain(scene, name, type) {
  const texture = new DynamicTexture(name, { width: 256, height: 256 }, scene, true);
  const ctx = texture.getContext();
  const random = randomFrom(type === 'dirt' ? 788 : 62);
  const colors = {
    wall: [135, 108, 86], table: [156, 114, 82], board: [173, 124, 82],
    dirt: [115, 93, 76], bamboo: [166, 137, 96],
  };
  const [r, g, b] = colors[type];
  ctx.fillStyle = 'rgb(' + [r, g, b].join(',') + ')';
  ctx.fillRect(0, 0, 256, 256);
  if (type === 'bamboo') {
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 16; col++) {
        const vertical = (row + col) % 4 < 2;
        ctx.fillStyle = random() > 0.45 ? '#ae905f' : '#90744c';
        ctx.fillRect(col * 16, row * 16, 16, 16);
        ctx.fillStyle = '#43301970';
        ctx.fillRect(col * 16, row * 16, vertical ? 2 : 16, vertical ? 16 : 2);
        ctx.fillStyle = '#e0bb7970';
        ctx.fillRect(col * 16 + 3, row * 16 + 3, vertical ? 2 : 13, vertical ? 13 : 2);
      }
    }
  } else {
    const dirt = type === 'dirt';
    for (let i = 0; i < 3600; i++) {
      ctx.fillStyle = random() > 0.53 ? '#100a07' : '#ffdbb2';
      ctx.globalAlpha = 0.025 + random() * 0.19;
      ctx.fillRect(
        Math.floor(random() * 128) * 2, Math.floor(random() * 128) * 2,
        dirt ? 2 + random() * 9 : 8 + random() * 73, 1 + random() * (dirt ? 10 : 4),
      );
    }
    ctx.globalAlpha = 1;
  }
  texture.update();
  return texture;
}

function place(mesh, parent, surface, x, y, z) {
  mesh.parent = parent;
  mesh.material = surface;
  mesh.position.set(x, y, z);
  mesh.isPickable = false;
  return mesh;
}

export function box(scene, parent, name, surface, x, y, z, w, h, d) {
  return place(CreateBox(name, { width: w, height: h, depth: d }, scene), parent, surface, x, y, z);
}

export function sphere(scene, parent, name, surface, x, y, z, w, h, d, segments = 8) {
  return place(CreateSphere(name, { diameterX: w, diameterY: h, diameterZ: d, segments }, scene), parent, surface, x, y, z);
}

export function cylinder(scene, parent, name, surface, x, y, z, top, bottom, h, facets = 10) {
  return place(CreateCylinder(name, { diameterTop: top, diameterBottom: bottom, height: h, tessellation: facets }, scene), parent, surface, x, y, z);
}

export function beam(scene, parent, name, surface, start, end, thickness, depth = thickness) {
  const from = Vector3.FromArray(start);
  const to = Vector3.FromArray(end);
  const center = from.add(to).scaleInPlace(0.5);
  const mesh = box(scene, parent, name, surface, center.x, center.y, center.z, thickness, from.subtract(to).length(), depth);
  mesh.rotationQuaternion = null;
  const direction = to.subtract(from);
  const horizontal = Math.hypot(direction.x, direction.y);
  mesh.rotation.z = Math.atan2(-direction.x, direction.y);
  mesh.rotation.x = Math.atan2(direction.z, horizontal);
  return mesh;
}
