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

export function buildBoard(scene, initialCounts, reducedMotion) {
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
  const hand = [];
  const cowries = Array.from({ length: total }, (_, index) => {
    const parts = [shell.createInstance('Cowrie ' + index), seam.createInstance('Cowrie seam ' + index)];
    for (const part of parts) {
      part.parent = root;
      part.isPickable = false;
    }
    return parts;
  });

  function pitPose(pit, index) {
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

  function handPose(pit, index) {
    const { x, z } = PITS[pit];
    const angle = index * 2.399963;
    const radius = 0.026 * Math.sqrt(index + 0.25);
    return {
      x: Math.max(-0.95, Math.min(0.95, x)) + Math.cos(angle) * radius,
      y: BOARD_TOP + 0.165,
      z: z * 0.11 + Math.sin(angle) * radius * 0.9,
      angle: angle * 1.87,
    };
  }

  function placeShell(parts, { x, y, z, angle }) {
    for (const [index, part] of parts.entries()) {
      part.position.set(x, y + index * 0.0085, z);
      part.rotation.y = angle;
    }
  }

  function reset(counts) {
    hand.length = 0;
    let index = 0;
    for (const [pit, count] of counts.entries()) {
      const contents = shells[pit];
      contents.length = 0;
      for (let slot = 0; slot < count; slot++) {
        const parts = cowries[index++];
        placeShell(parts, pitPose(pit, slot));
        contents.push(parts);
      }
    }
  }

  function moveShells(pile, destination, ms, height = 0) {
    const paths = pile.map((parts, index) => {
      const { x, y, z } = parts[0].position;
      const angle = parts[0].rotation.y;
      const end = destination(index);
      const rotation = end.angle - angle;
      return { parts, x, y, z, angle, end, turn: Math.atan2(Math.sin(rotation), Math.cos(rotation)) };
    });
    if (reducedMotion) {
      return new Promise((resolve) => setTimeout(() => {
        for (const { parts, end } of paths) placeShell(parts, end);
        resolve();
      }, ms));
    }
    const start = performance.now();
    return new Promise((resolve) => {
      const flight = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const travel = t * t * (3 - 2 * t);
        const arc = height * 4 * t * (1 - t);
        for (const { parts, x, y, z, angle, end, turn } of paths) {
          placeShell(parts, {
            x: x + (end.x - x) * travel,
            y: y + (end.y - y) * travel + arc,
            z: z + (end.z - z) * travel,
            angle: angle + turn * travel,
          });
        }
        if (t === 1) {
          scene.onBeforeRenderObservable.remove(flight);
          resolve();
        }
      });
    });
  }

  reset(initialCounts);
  return {
    reset,
    lift(pit, ms) {
      hand.push(...shells[pit].splice(0));
      return moveShells(hand, (index) => handPose(pit, index), ms, 0.035);
    },
    async drop(pit, ms) {
      await moveShells(hand, (index) => handPose(pit, index), ms * 0.55);
      const seed = hand.pop();
      const contents = shells[pit];
      await moveShells([seed], () => pitPose(pit, contents.length), ms * 0.45);
      contents.push(seed);
    },
    async transfer(sources, pit, ms) {
      const pile = sources.flatMap((source) => shells[source].splice(0));
      const contents = shells[pit];
      await moveShells(pile, (index) => pitPose(pit, contents.length + index), ms, 0.23);
      contents.push(...pile);
    },
    mark(pits) {
      for (const [index, marker] of markers.entries()) marker.setEnabled(pits.includes(index));
    },
  };
}
