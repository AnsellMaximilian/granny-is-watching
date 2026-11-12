import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ESCAPE_PATTERN, GRANNY, PLAYER, ROWS } from './congklak.js';
import { box, material, randomFrom } from './geometry.js';
import { TABLE_HEIGHT } from './room.js';

const PAGE_WIDTH = 0.24;
const PAGE_HEIGHT = 0.33;
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 704;
const INK = '#302016';
const PAPER_SPREADS = [
  [
    { title: 'Set the board', paragraphs: [
      'Six small pits on each side. Four seeds in every playable pit.',
      'Leave both stores empty. You play first.',
    ], illustration: 'board' },
    { title: 'Sow the seeds', paragraphs: [
      'Take all the seeds from one occupied pit on your side.',
      'Drop one into each next pit, clockwise. Include your store.',
      'Skip Granny’s store and every burned pit.',
    ], illustration: 'shells' },
  ],
  [
    { title: 'The last seed', paragraphs: [
      'Occupied pit: lift the whole handful and keep sowing.',
      'Your store: choose again if both rows still have seeds.',
      'Empty pit: finish the move. On your side, check the pit opposite for a capture.',
    ] },
    { title: 'Capture and score', paragraphs: [
      'Move the opposite seeds to your landing pit, then take the whole pile to your store.',
      'After a move, an empty row ends the round. Sweep remaining seeds into their owner’s store.',
      'Most seeds wins. Equal scores replay the round.',
    ] },
  ],
  [
    { title: 'The four scars', paragraphs: [
      'A winning hand may burn one patch of earth.',
      'Read the marks from your seat. Her row lies above yours.',
      'Burn the four marked patches. Leave the rest to seed.',
    ], illustration: 'shells' },
    { pattern: true },
  ],
];

const patternRows = [GRANNY, PLAYER].map((side) =>
  ROWS[side].flatMap((pit, column) => ESCAPE_PATTERN.includes(pit) ? [column] : []),
);

function paper(ctx, seed, cover) {
  const random = randomFrom(seed);
  const gradient = ctx.createRadialGradient(226, 315, 25, 256, 350, 415);
  gradient.addColorStop(0, cover ? '#ac7e4e' : '#e5be87');
  gradient.addColorStop(0.72, cover ? '#8b5633' : '#d6a76d');
  gradient.addColorStop(1, cover ? '#503021' : '#86522f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  for (let i = 0; i < 9500; i++) {
    const x = random() * TEXTURE_WIDTH;
    const y = random() * TEXTURE_HEIGHT;
    ctx.fillStyle = random() < 0.6 ? '#442112' : '#ffe1ae';
    ctx.globalAlpha = random() * 0.16;
    ctx.fillRect(x, y, 1 + random() * 7, 1 + random() * 4);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cover ? '#54351f' : '#986138';
  ctx.lineWidth = 2;
  ctx.strokeRect(15, 16, TEXTURE_WIDTH - 30, TEXTURE_HEIGHT - 32);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
}

function textLines(ctx, paragraph, x, y, width) {
  let line = '';
  for (const word of paragraph.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > width) {
      ctx.fillText(line, x, y);
      y += 37;
      line = word;
    } else {
      line = next;
    }
  }
  ctx.fillText(line, x, y);
  return y + 62;
}

function shellInk(ctx, x, y, tilt, size = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(size, size);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 45, 24, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-36, 1);
  ctx.quadraticCurveTo(0, -12, 36, 0);
  for (let x = -30; x <= 30; x += 7) {
    ctx.moveTo(x, -6);
    ctx.lineTo(x + 4, 4);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBoard(ctx) {
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(52, 476, 408, 127, 54);
  ctx.stroke();
  for (const x of [92, 420]) {
    ctx.beginPath();
    ctx.ellipse(x, 539, 21, 42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < ROWS[PLAYER].length; i++) {
    for (const y of [516, 562]) {
      ctx.beginPath();
      ctx.arc(143 + 45 * i, y, 15, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawPattern(ctx) {
  const left = 62;
  const width = 388;
  const step = width / ROWS[PLAYER].length;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const x of [left, left + width]) {
    ctx.moveTo(x, 242);
    ctx.lineTo(x, 452);
  }
  ctx.stroke();
  for (const [row, columns] of patternRows.entries()) {
    for (const column of columns) {
      ctx.beginPath();
      ctx.arc(left + (column + 0.5) * step, 296 + 100 * row, 9, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

function pageMaterial(scene, name, page, seed) {
  const texture = new DynamicTexture(name, { width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT }, scene, true);
  const ctx = texture.getContext();
  paper(ctx, seed, page.cover);
  if (page.cover) {
    ctx.textAlign = 'center';
    ctx.font = 'italic bold 56px Georgia';
    ctx.fillText('How to Play', 256, 249);
    ctx.font = 'bold 65px Georgia';
    ctx.fillText('Congklak', 256, 331);
    shellInk(ctx, 256, 444, -0.45, 1.55);
  } else if (page.pattern) {
    drawPattern(ctx);
  } else {
    ctx.font = 'bold 40px Georgia';
    ctx.fillText(page.title, 46, 99);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(47, 118);
    ctx.lineTo(461, 118);
    ctx.stroke();
    ctx.font = '32px Georgia';
    let y = 176;
    for (const paragraph of page.paragraphs) y = textLines(ctx, paragraph, 46, y, 420);
    if (page.illustration === 'board') drawBoard(ctx);
    if (page.illustration === 'shells') {
      shellInk(ctx, 223, 544, -0.36);
      shellInk(ctx, 297, 580, 0.27, 0.85);
    }
  }
  texture.update();
  const surface = material(scene, name, '#000000');
  surface.emissiveTexture = texture;
  surface.disableLighting = true;
  return surface;
}

export function buildRulebook(scene, camera, aspect, reducedMotion) {
  const tableCenter = new Vector3(1.17, TABLE_HEIGHT + 0.039, 0.485);
  const rest = tableCenter.subtract(new Vector3(PAGE_WIDTH / 2, 0.022, 0));
  const flat = Quaternion.RotationYawPitchRoll(0, -Math.PI / 2, 0);
  const root = new TransformNode('Congklak rulebook', scene);
  root.position.copyFrom(rest);
  root.rotationQuaternion = flat.clone();

  const leather = material(scene, 'Book leather', '#63412b');
  const paperEdges = material(scene, 'Paper edges', '#c49a61');
  const cord = material(scene, 'Binding cord', '#5a3c27');
  const cover = new TransformNode('Rulebook cover hinge', scene);
  cover.parent = root;
  const leaf = new TransformNode('Turning leaf hinge', scene);
  leaf.parent = root;
  leaf.setEnabled(false);

  const surfaces = PAPER_SPREADS.map((spread, i) =>
    spread.map((page, side) => pageMaterial(scene, 'Rulebook page ' + (i * 2 + side + 1), page, 23 + i * 2 + side)),
  );
  const coverArt = pageMaterial(scene, 'How to Play Congklak cover', { cover: true }, 134);

  function pageFace(parent, name, surface, x, z, width = PAGE_WIDTH, height = PAGE_HEIGHT) {
    const mesh = CreatePlane(name, { width, height, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.parent = parent;
    mesh.position.set(x, 0, z);
    mesh.material = surface;
    mesh.isPickable = false;
    return mesh;
  }

  const half = PAGE_WIDTH / 2;
  box(scene, root, 'Book back cover', leather, half, 0, -0.012, PAGE_WIDTH + 0.012, PAGE_HEIGHT + 0.014, 0.010);
  box(scene, root, 'Right page block', paperEdges, half, 0, -0.001, PAGE_WIDTH, PAGE_HEIGHT, 0.015);
  const leftStack = box(scene, root, 'Left page block', paperEdges, -half, 0, -0.001, PAGE_WIDTH, PAGE_HEIGHT, 0.015);
  box(scene, cover, 'Book front cover', leather, half, 0, 0.016, PAGE_WIDTH + 0.012, PAGE_HEIGHT + 0.014, 0.010);
  const frontCover = pageFace(cover, 'Printed cover', coverArt, half, 0.022, PAGE_WIDTH + 0.008, PAGE_HEIGHT + 0.01);
  const left = pageFace(root, 'Left rulebook page', surfaces[0][0], -half, 0.008);
  const right = pageFace(root, 'Right rulebook page', surfaces[0][1], half, 0.008);
  const leafFront = pageFace(leaf, 'Front of turning page', surfaces[0][1], half, 0.010);
  const leafBack = pageFace(leaf, 'Back of turning page', surfaces[1][0], half, 0.010);
  leafBack.rotation.y = Math.PI;
  for (const y of [-0.119, 0, 0.119]) {
    const stitch = CreateTorus('Rulebook binding loop', { diameter: 0.027, thickness: 0.004, tessellation: 10 }, scene);
    stitch.parent = root;
    stitch.position.set(0, y, 0.011);
    stitch.material = cord;
    stitch.isPickable = false;
  }
  left.setEnabled(false);
  leftStack.setEnabled(false);
  right.setEnabled(false);

  let spread = 0;
  let facingCamera = false;

  function readingPose() {
    const world = camera.getWorldMatrix();
    const height = Math.max(PAGE_HEIGHT / 0.70, PAGE_WIDTH * 2 / (0.82 * aspect()));
    const distance = height / (2 * Math.tan(camera.fov / 2));
    return {
      position: Vector3.TransformCoordinates(new Vector3(0, height * 0.070, -distance), world),
      rotation: Quaternion.FromRotationMatrix(world.getRotationMatrix()),
    };
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!facingCamera) return;
    const { position, rotation } = readingPose();
    root.position.copyFrom(position);
    root.rotationQuaternion.copyFrom(rotation);
  });

  function animate(ms, update) {
    const start = performance.now();
    return new Promise((resolve) => {
      const observer = scene.onBeforeRenderObservable.add(() => {
        const time = reducedMotion ? 1 : Math.min(1, (performance.now() - start) / ms);
        update(time * time * (3 - 2 * time));
        if (time === 1) {
          scene.onBeforeRenderObservable.remove(observer);
          resolve();
        }
      });
    });
  }

  function showSpread(index) {
    spread = index;
    left.material = surfaces[index][0];
    right.material = surfaces[index][1];
  }

  return {
    tableCenter,
    spreadCount: PAPER_SPREADS.length,
    describe(index) {
      if (index === PAPER_SPREADS.length - 1) {
        const [far, near] = patternRows.map((row) => row.map((column) => column + 1).join(' and '));
        return PAPER_SPREADS[index][0].paragraphs.join(' ') + ' The far row has marks at columns ' + far +
          '. The near row has marks at columns ' + near + '. Columns count from the left edge.';
      }
      return PAPER_SPREADS[index].map((page) => page.title + '. ' + page.paragraphs.join(' ')).join(' ');
    },
    async open() {
      showSpread(0);
      await animate(650, (t) => {
        const { position, rotation } = readingPose();
        Vector3.LerpToRef(rest, position, t, root.position);
        Quaternion.SlerpToRef(flat, rotation, t, root.rotationQuaternion);
      });
      facingCamera = true;
      left.setEnabled(true);
      leftStack.setEnabled(true);
      right.setEnabled(true);
      await animate(410, (t) => { cover.rotation.y = -Math.PI * t; });
      frontCover.setEnabled(false);
    },
    async flip(index) {
      const forward = index > spread;
      leafFront.material = surfaces[forward ? spread : index][1];
      leafBack.material = surfaces[forward ? index : spread][0];
      if (forward) right.material = surfaces[index][1];
      else left.material = surfaces[index][0];
      leaf.setEnabled(true);
      await animate(520, (t) => {
        const turn = forward ? t : 1 - t;
        leaf.rotation.y = -Math.PI * turn;
        leafFront.setEnabled(turn < 0.5);
        leafBack.setEnabled(turn >= 0.5);
      });
      leaf.setEnabled(false);
      showSpread(index);
    },
    async close() {
      frontCover.setEnabled(true);
      await animate(370, (t) => { cover.rotation.y = -Math.PI * (1 - t); });
      left.setEnabled(false);
      leftStack.setEnabled(false);
      right.setEnabled(false);
      facingCamera = false;
      const position = root.position.clone();
      const rotation = root.rotationQuaternion.clone();
      await animate(620, (t) => {
        Vector3.LerpToRef(position, rest, t, root.position);
        Quaternion.SlerpToRef(rotation, flat, t, root.rotationQuaternion);
      });
    },
  };
}
