import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { box, beam, cylinder, grain, material, randomFrom, sphere } from './geometry.js';

export const TABLE_HEIGHT = 0.76;

function mergeByMaterial(parent) {
  const batches = Map.groupBy(parent.getChildMeshes(true), (mesh) => mesh.material);
  for (const [surface, parts] of batches) {
    if (parts.length < 2) continue;
    const merged = Mesh.MergeMeshes(parts, true, true);
    merged.name = parent.name + ' · ' + surface.name;
    merged.parent = parent;
    merged.isPickable = false;
  }
}

export function buildRoom(scene) {
  const hut = new TransformNode('Timber house', scene);
  const furnishings = new TransformNode('Table and seats', scene);
  const random = randomFrom(81);
  const wallGrain = grain(scene, 'Wood grain', 'wall');
  const wall = ['#9a765f', '#896b58', '#7c6558', '#a17a5b', '#79634c'].map((tone, i) => material(scene, 'Wall plank ' + i, tone, wallGrain));
  const frame = material(scene, 'Structural timber', '#77604e', wallGrain);
  const tableGrain = grain(scene, 'Table saw marks', 'table');
  const boards = ['#a47454', '#936346', '#a57b58', '#8b5a3c'].map((tone, i) => material(scene, 'Table plank ' + i, tone, tableGrain));
  const earth = material(scene, 'Packed earth', '#aa876d', grain(scene, 'Packed earth grain', 'dirt'));
  const woven = material(scene, 'Woven bamboo', '#b4a082', grain(scene, 'Bamboo weave', 'bamboo'));
  const dark = material(scene, 'Doorway darkness', '#17181b');
  const roof = material(scene, 'Dried roof thatch', '#6b5944', wallGrain);
  box(scene, hut, 'Dirt floor', earth, 0, -0.09, -0.45, 7.4, 0.18, 10.2);

  for (let i = 0; i < 28; i++) {
    const x = -3.43 + i * 0.25;
    if (x < -1.23 || x > 0.53) {
      box(scene, hut, 'Rear wall plank', wall[i % wall.length], x, 1.38, -3.78 - random() * 0.03, 0.244, 2.76, 0.12);
    } else {
      box(scene, hut, 'Door lintel infill', wall[i % wall.length], x, 2.51, -3.78, 0.244, 0.50, 0.12);
    }
    const gable = 3.62 - Math.abs(x) * 0.28 - 2.71;
    if (gable > 0) box(scene, hut, 'Gable infill', wall[i % wall.length], x, 2.71 + gable / 2, -3.78, 0.244, gable, 0.12);
  }
  for (const x of [-3.53, 3.53]) {
    for (let i = 0; i < 33; i++) {
      const z = -3.75 + i * 0.255;
      const panel = z > -2.48 && z < -0.32;
      const sideBoard = box(scene, hut, 'Side wall plank', wall[i % wall.length], x, panel ? 0.45 : 1.38, z, 0.13, panel ? 0.9 : 2.76, 0.247);
      sideBoard.rotation.z = (random() - 0.5) * 0.012;
    }
    box(scene, hut, 'Woven bamboo infill', woven, x, 1.80, -1.41, 0.15, 1.81, 2.20);
    for (const z of [-3.70, -2.53, -0.31, 2.1, 4.18]) {
      box(scene, hut, 'Wall post', frame, x * 0.96, 1.38, z, 0.20, 2.76, 0.16);
    }
    for (const y of [0.85, 2.68]) box(scene, hut, 'Wall rail', frame, x * 0.96, y, 0.20, 0.15, 0.13, 8.11);
  }
  for (const x of [-1.32, 0.68]) box(scene, hut, 'Door jamb', frame, x, 1.14, -3.67, 0.20, 2.28, 0.21);
  box(scene, hut, 'Door lintel', frame, -0.32, 2.26, -3.67, 2.17, 0.21, 0.21);
  box(scene, hut, 'Unlit inner room', dark, -0.32, 1.30, -5.07, 3.6, 2.60, 0.18);
  for (const side of [-1, 1]) {
    const slope = box(scene, hut, 'Thatch pitch', roof, side * 1.78, 3.14, 0.15, 3.75, 0.14, 8.28);
    slope.rotation.z = -side * 0.28;
    for (let i = 0; i < 10; i++) {
      const x = i * 0.385;
      box(scene, hut, 'Roof lath', frame, side * x, 3.61 - 0.285 * x, 0.15, 0.085, 0.082, 8.24);
    }
  }
  for (const z of [-3.61, -2.38, -1.05, 0.29, 1.62, 2.95, 4.13]) {
    beam(scene, hut, 'Cross tie', frame, [-3.49, 2.71, z], [3.49, 2.71, z], 0.14, 0.16);
    for (const side of [-1, 1]) {
      beam(scene, hut, 'Rafter', frame, [0, 3.65, z], [side * 3.55, 2.64, z], 0.12, 0.12);
    }
  }

  const mat = cylinder(scene, hut, 'Rolled sleeping mat', woven, -2.48, 0.16, 2.28, 0.32, 0.32, 1.40, 18);
  mat.rotation.z = 1.48;
  mat.rotation.y = -0.21;
  const matCore = cylinder(scene, hut, 'Mat roll core', frame, -1.79, 0.22, 2.29, 0.22, 0.22, 0.03, 12);
  matCore.rotation.z = 1.48;

  for (let i = 0; i < 6; i++) {
    box(scene, furnishings, 'Table surface plank', boards[i % boards.length], 0, TABLE_HEIGHT - 0.049, -0.662 + i * 0.265, 2.82, 0.098, 0.263);
  }
  for (const x of [-1.22, 1.22]) {
    for (const z of [-0.62, 0.62]) box(scene, furnishings, 'Table leg', frame, x, 0.35, z, 0.13, 0.70, 0.13);
    box(scene, furnishings, 'Side apron', frame, x, 0.64, 0, 0.10, 0.13, 1.31);
  }
  for (const z of [-0.62, 0.62]) box(scene, furnishings, 'Table apron', boards[2], 0, 0.62, z, 2.51, 0.16, 0.09);

  const seats = [
    { name: 'Granny’s chair', x: 0, z: -1.39, back: true },
    { name: 'Player’s stool', x: -0.60, z: 1.32, back: false },
  ];
  for (const { name, x, z, back } of seats) {
    box(scene, furnishings, name, boards[2], x, 0.432, z, 0.51, 0.074, 0.47);
    for (const dx of [-0.199, 0.199]) {
      for (const dz of [-0.181, 0.181]) box(scene, furnishings, 'Seat leg', frame, x + dx, 0.21, z + dz, 0.067, 0.42, 0.071);
      if (back) box(scene, furnishings, 'Chair upright', frame, x + dx, 0.73, z - 0.20, 0.077, 0.61, 0.068);
    }
    if (back) {
      for (const y of [0.74, 0.97]) box(scene, furnishings, 'Chair back rail', boards[1], x, y, z - 0.20, 0.48, 0.08, 0.065);
    }
  }
  mergeByMaterial(hut);
  mergeByMaterial(furnishings);

  const fill = new HemisphericLight('Reflected moonlight', new Vector3(-0.4, 1, -0.3), scene);
  fill.intensity = 0.39;
  fill.diffuse = new Color3(0.61, 0.66, 0.81);
  fill.groundColor = new Color3(0.31, 0.22, 0.17);
  fill.specular = Color3.Black();
  const firelight = new StandardFire(scene);
  const candles = [
    firelight.place(hut, -1.65, 0.0, -2.94, 0.17, 1.45),
    firelight.place(hut, 2.54, 0.0, 1.18, 0.19, 1.50),
    firelight.place(furnishings, 1.13, TABLE_HEIGHT, -0.54, 0.21, 1.75),
  ];
  const faceLight = new PointLight('Warm light on Granny', new Vector3(-0.55, 1.49, 0.10), scene);
  faceLight.diffuse = new Color3(1, 0.66, 0.44);
  faceLight.intensity = 0.47;
  faceLight.range = 4.3;
  const boardLight = new PointLight('Reflected light over the table', new Vector3(0, 2.38, 0.16), scene);
  boardLight.diffuse = new Color3(1, 0.78, 0.59);
  boardLight.intensity = 0;

  return {
    flames: candles.flatMap(({ flame, ember }) => [flame, ember]),
    update(time, overhead) {
      for (let i = 0; i < candles.length; i++) {
        const { flame, ember, light, strength } = candles[i];
        const sway = Math.sin(time * 11.9 + i) * 0.095 + Math.sin(time * 19.1 + i) * 0.044;
        flame.rotation.z = sway;
        ember.rotation.z = sway;
        flame.scaling.y = 1 + 1.3 * sway;
        light.intensity = strength * (1 + sway * 0.35);
      }
      boardLight.intensity = overhead * 0.62;
    },
  };
}

class StandardFire {
  constructor(scene) {
    this.scene = scene;
    this.wax = material(scene, 'Beeswax', '#d6ae70');
    this.plate = material(scene, 'Candle saucer', '#825737');
    this.wick = material(scene, 'Charred wick', '#211914');
    this.outer = material(scene, 'Amber flame', '#ffab46');
    this.outer.emissiveColor = new Color3(1, 0.42, 0.065);
    this.outer.disableLighting = true;
    this.inner = material(scene, 'Flame heart', '#ffdf9b');
    this.inner.emissiveColor = new Color3(1, 0.78, 0.30);
    this.inner.disableLighting = true;
  }

  place(parent, x, y, z, height, strength) {
    const scene = this.scene;
    cylinder(scene, parent, 'Wooden candle plate', this.plate, x, y + 0.023, z, 0.34, 0.29, 0.046, 16);
    cylinder(scene, parent, 'Burned candle', this.wax, x, y + 0.044 + height / 2, z, 0.094, 0.113, height, 11);
    for (const [dx, dz, length] of [[0.041, 0.017, 0.10], [-0.032, 0.027, 0.068], [0.01, -0.043, 0.058]]) {
      sphere(scene, parent, 'Wax drip', this.wax, x + dx, y + height + 0.027 - length / 2, z + dz, 0.021, length, 0.021);
    }
    cylinder(scene, parent, 'Wick', this.wick, x, y + height + 0.054, z, 0.012, 0.012, 0.034);
    const flame = sphere(scene, parent, 'Flickering flame', this.outer, x, y + height + 0.106, z, 0.047, 0.113, 0.048, 7);
    const ember = sphere(scene, parent, 'Bright flame base', this.inner, x, y + height + 0.086, z, 0.036, 0.067, 0.036, 6);
    const light = new PointLight('Candlelight', new Vector3(x, y + height + 0.18, z), scene);
    light.diffuse = new Color3(1, 0.62, 0.31);
    light.specular = new Color3(1, 0.67, 0.37);
    light.range = 5;
    return { flame, ember, light, strength };
  }
}
