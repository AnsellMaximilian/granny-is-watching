import earcut from 'earcut';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ROWS, STORES } from './congklak.js';
import { grain, material, sphere } from './geometry.js';
import { TABLE_HEIGHT } from './room.js';

export const BOARD_TOP = TABLE_HEIGHT + 0.136;
const SEGMENTS = 20;
const centers = Array(16);
for (const [side, row] of ROWS.entries()) {
  for (const [column, pit] of row.entries()) {
    centers[pit] = { x: (column - 3) * 0.246, z: side === 0 ? 0.155 : -0.155, rx: 0.106, rz: 0.108 };
  }
}
for (const [side, pit] of STORES.entries()) {
  centers[pit] = { x: side === 0 ? -1.024 : 1.024, z: 0, rx: 0.141, rz: 0.231 };
}
export const PITS = centers;

function ellipse(x, z, rx, rz, count = SEGMENTS) {
  return Array.from({ length: count }, (_, i) => {
    const theta = 2 * Math.PI * i / count;
    return [x + rx * Math.cos(theta), z + rz * Math.sin(theta)];
  });
}

function makeMesh(name, scene, parent, surface, positions, indices, uvs) {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.normals = [];
  VertexData.ComputeNormals(positions, indices, data.normals, { useRightHandedSystem: true });
  data.applyToMesh(mesh);
  mesh.parent = parent;
  mesh.material = surface;
  mesh.isPickable = false;
  return mesh;
}

function band(name, scene, parent, surface, profiles, { woodUvs = false, inward = false } = {}) {
  const positions = [];
  const indices = [];
  const uvs = [];
  const size = profiles[0].points.length;
  for (const [row, { points, y }] of profiles.entries()) {
    for (const [i, [x, z]] of points.entries()) {
      positions.push(x, y, z);
      uvs.push(woodUvs ? (x + 1.23) / 2.46 : i / size, woodUvs ? (z + 0.34) / 0.68 : row / (profiles.length - 1));
      if (row === 0) continue;
      const a = (row - 1) * size + i;
      const b = (row - 1) * size + (i + 1) % size;
      if (inward) {
        indices.push(a, b + size, b, a, a + size, b + size);
      } else {
        indices.push(a, b, b + size, a, b + size, a + size);
      }
    }
  }
  return makeMesh(name, scene, parent, surface, positions, indices, uvs);
}

function outline(scale) {
  const points = [];
  for (const side of [1, -1]) {
    for (let i = 0; i <= 12; i++) {
      const theta = -Math.PI / 2 + Math.PI * i / 12 + (side === 1 ? 0 : Math.PI);
      const x = (0.85 * side + 0.37 * Math.cos(theta)) * scale;
      const z = 0.328 * Math.sin(theta) * scale;
      points.push([x, z]);
    }
  }
  return points;
}

function buildWood(scene, root) {
  const wood = grain(scene, 'Carved board grain', 'board');
  const face = material(scene, 'Polished jackfruit wood', '#ae744e', wood);
  face.emissiveColor = new Color3(0.05, 0.025, 0.013);
  const bevel = material(scene, 'Worn lip of the board', '#ba865e', wood);
  const side = material(scene, 'Dark carved edge', '#77472d', wood);
  const cavity = material(scene, 'Oil-darkened pit interiors', '#794b32', wood);
  for (const surface of [face, bevel, side, cavity]) surface.backFaceCulling = false;

  const holes = [];
  const points = outline(1);
  for (const pit of PITS) {
    holes.push(points.length);
    points.push(...ellipse(pit.x, pit.z, pit.rx, pit.rz));
  }
  const indices = earcut(points.flat(), holes);
  // Earcut winds counterclockwise in X/Z, so reverse it for the upward face.
  for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 1]] = [indices[i + 1], indices[i]];
  const positions = points.flatMap(([x, z]) => [x, BOARD_TOP, z]);
  const uvs = points.flatMap(([x, z]) => [(x + 1.23) / 2.46, (z + 0.34) / 0.68]);
  makeMesh('Carved top with sixteen openings', scene, root, face, positions, indices, uvs);
  band('Beveled outer edge', scene, root, bevel, [
    { points: outline(1), y: BOARD_TOP },
    { points: outline(1.014), y: BOARD_TOP - 0.020 },
  ], { woodUvs: true });
  band('Board base', scene, root, side, [
    { points: outline(1.014), y: BOARD_TOP - 0.020 },
    { points: outline(1.005), y: TABLE_HEIGHT + 0.022 },
    { points: outline(0.982), y: TABLE_HEIGHT + 0.002 },
  ], { woodUvs: true });

  for (const [i, { x, z, rx, rz }] of PITS.entries()) {
    const ring = (scale, depth) => ({ points: ellipse(x, z, rx * scale, rz * scale), y: BOARD_TOP - depth });
    band('Rounded pit lip ' + i, scene, root, bevel, [ring(1, 0), ring(0.94, 0.010)], { woodUvs: true, inward: true });
    band('Scooped wooden pit ' + i, scene, root, cavity, [
      ring(0.94, 0.010), ring(0.83, 0.038), ring(0.61, 0.073), ring(0.36, 0.089), ring(0.0001, 0.091),
    ], { woodUvs: true, inward: true });
  }
}

export function buildBoard(scene, initialCounts) {
  const root = new TransformNode('Congklak board', scene);
  buildWood(scene, root);
  const shellMaterial = material(scene, 'Ivory cowrie shell', '#edd1a0');
  const seamMaterial = material(scene, 'Brown shell seam', '#805439');
  const glow = material(scene, 'Seed landing highlight', '#e7ab60');
  glow.emissiveColor = new Color3(0.70, 0.26, 0.058);
  glow.disableLighting = true;
  glow.backFaceCulling = false;
  const rim = (pit, inset) => ({ points: ellipse(pit.x, pit.z, pit.rx - inset, pit.rz - inset), y: BOARD_TOP + 0.002 });
  const markers = PITS.map((pit, i) => {
    const marker = band('Active pit ' + i, scene, root, glow, [rim(pit, 0.004), rim(pit, 0.010)]);
    marker.setEnabled(false);
    return marker;
  });
  const shell = sphere(scene, root, 'Cowrie source', shellMaterial, 0, -5, 0, 0.036, 0.018, 0.024, 7);
  const seam = sphere(scene, root, 'Seam source', seamMaterial, 0, -5, 0, 0.024, 0.002, 0.004, 5);
  const total = initialCounts.reduce((sum, count) => sum + count, 0);
  const shells = PITS.map(() => []);
  const available = Array.from({ length: total }, (_, index) => {
    const parts = [shell.createInstance('Cowrie ' + index), seam.createInstance('Cowrie seam ' + index)];
    for (const part of parts) {
      part.parent = root;
      part.isPickable = false;
      part.setEnabled(false);
    }
    return parts;
  });

  function shellPose(pit, index) {
    const { x, z, rx, rz } = PITS[pit];
    const layerSize = STORES.includes(pit) ? 32 : 18;
    const angle = index * 2.399963 + pit * 0.71;
    const radius = Math.sqrt((index % layerSize + 0.5) / layerSize) * 0.76;
    return {
      x: x + Math.cos(angle) * radius * rx,
      y: BOARD_TOP - 0.077 + radius * radius * 0.095 + Math.floor(index / layerSize) * 0.016,
      z: z + Math.sin(angle) * radius * rz,
      angle: angle * 1.87,
    };
  }

  function placeShell(parts, { x, y, z, angle }, scale = 1) {
    for (const [index, part] of parts.entries()) {
      part.position.set(x, y + index * 0.0085 * scale, z);
      part.rotation.y = angle;
      part.scaling.setAll(scale);
      part.setEnabled(true);
    }
  }

  function setCount(pit, count) {
    const contents = shells[pit];
    while (contents.length > count) {
      const parts = contents.pop();
      for (const part of parts) part.setEnabled(false);
      available.push(parts);
    }
    while (contents.length < count) {
      const parts = available.pop();
      placeShell(parts, shellPose(pit, contents.length));
      contents.push(parts);
    }
  }

  function flySeed(from, to, ms, fromBowl) {
    const landing = shellPose(to, shells[to].length);
    const source = fromBowl ? shellPose(from, 0)
      : { ...PITS[from], y: BOARD_TOP + 0.046, angle: landing.angle - Math.PI };
    const height = Math.max(0.21, BOARD_TOP + 0.19 - (source.y + landing.y) / 2);
    const angleDifference = landing.angle - source.angle;
    const turn = Math.atan2(Math.sin(angleDifference), Math.cos(angleDifference));
    // setCount takes this same cowrie from the pool when it lands.
    const parts = available.at(-1);
    const start = performance.now();
    return new Promise((resolve) => {
      const flight = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const travel = t * t * (3 - 2 * t);
        const arc = 4 * t * (1 - t);
        placeShell(parts, {
          x: source.x + (landing.x - source.x) * travel,
          y: source.y + (landing.y - source.y) * t + height * arc,
          z: source.z + (landing.z - source.z) * travel,
          angle: source.angle + turn * travel,
        }, 1 + 0.25 * arc);
        if (t === 1) {
          scene.onBeforeRenderObservable.remove(flight);
          resolve();
        }
      });
    });
  }

  initialCounts.forEach((count, pit) => setCount(pit, count));
  let selected = -1;
  return {
    flySeed,
    setCount,
    clear() {
      for (const pit of PITS.keys()) setCount(pit, 0);
    },
    mark(pit) {
      if (selected === pit) return;
      markers[selected]?.setEnabled(false);
      markers[pit]?.setEnabled(true);
      selected = pit;
    },
  };
}
