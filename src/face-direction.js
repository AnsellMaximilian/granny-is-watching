// SmartSpectra uses MediaPipe's 478-point face layout. These are the eye
// corners, nose tip and chin from that layout. Only x/y positions are available.
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
const REQUIRED = [1, 33, 133, 152, 263, 362];
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// A coarse head-direction heuristic, not a calibrated gaze measurement. Ratios
// keep it independent of frame size, translation, mirroring and moderate roll.
export function estimateCameraFacing(points) {
  if (!Array.isArray(points) || points.length < 468
    || REQUIRED.some((index) => !Number.isFinite(points[index]?.x) || !Number.isFinite(points[index]?.y))) return null;
  const left = midpoint(points[33], points[133]);
  const right = midpoint(points[263], points[362]);
  const span = distance(left, right);
  if (span < 1e-6) return null;
  const axis = { x: (right.x - left.x) / span, y: (right.y - left.y) / span };
  const center = midpoint(left, right);
  const nose = points[1];
  const chin = points[152];
  const along = (point) => ((point.x - center.x) * axis.x + (point.y - center.y) * axis.y) / span;
  const down = (point) => (point.x - center.x) * -axis.y + (point.y - center.y) * axis.x;
  const chinDepth = down(chin);
  if (Math.abs(chinDepth) / span < 0.35 || Math.abs(chinDepth) / span > 3) return null;
  const widths = [distance(points[33], points[133]), distance(points[263], points[362])];
  if (widths.some((width) => width / span < 0.05 || width / span > 0.65)) return null;
  const pitch = down(nose) / chinDepth;
  const symmetry = Math.min(...widths) / Math.max(...widths);
  return Math.abs(along(nose)) <= 0.18 && Math.abs(along(chin)) <= 0.22
    && pitch >= 0.1 && pitch <= 0.65 && symmetry >= 0.6;
}

export class FacingDirection {
  constructor() { this.clear(); }

  clear() {
    this.value = null;
    this.pending = null;
    this.pendingSince = null;
    this.lastAt = null;
  }

  update(direction, timestampMs, reset = false) {
    if (direction === null) { this.clear(); return; }
    if (reset || this.lastAt === null || timestampMs - this.lastAt > 1500) this.clear();
    this.lastAt = timestampMs;
    if (this.value === null || direction === this.value) {
      this.value = direction;
      this.pending = null;
    } else if (this.pending !== direction) {
      this.pending = direction;
      this.pendingSince = timestampMs;
    } else if (timestampMs - this.pendingSince >= (direction ? 200 : 120)) {
      this.value = direction;
      this.pending = null;
    }
  }
}
