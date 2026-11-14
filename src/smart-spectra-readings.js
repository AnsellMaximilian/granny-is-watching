import { estimateCameraFacing, FacingDirection } from './face-direction.js';

export const SIGNALS = [
  { id: 'facing', label: 'Facing camera', field: 'landmarks', kind: 'landmarks' },
  { id: 'blinking', label: 'Eye blink', field: 'blinking', kind: 'detection' },
  { id: 'talking', label: 'Talking', field: 'talking', kind: 'detection' },
  { id: 'expression', label: 'Expression', field: 'expression', kind: 'expression' },
];

const EXPRESSIONS = ['Unspecified', 'Angry', 'Contempt', 'Disgust', 'Fear', 'Happy', 'Neutral', 'Sad', 'Surprise'];
const FRESH_MS = 1500;
const BLINK_HOLD_MS = 350;
const asNumber = (value) => typeof value === 'number' ? value : Number(value?.toString?.());

function timestamp(sample) {
  const value = asNumber(sample?.timestamp);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Keep independent fields across partial packets. Repeated or older samples must
// never refresh a reading's lifetime when a group has stopped producing data.
export class SignalReadings {
  constructor(now = Date.now) {
    this.now = now;
    this.clear();
  }

  clear() {
    this.samples = new Map();
    this.startedAt = null;
    this.direction = new FacingDirection();
    this.blinkUntil = 0;
    this.faceEpochUs = 0;
  }

  invalidateFace() {
    this.samples.clear();
    this.direction.clear();
    this.blinkUntil = 0;
  }

  start() {
    this.clear();
    this.startedAt = this.now();
  }

  ingest(metrics) {
    const now = this.now();
    for (const signal of SIGNALS) {
      const samples = metrics?.face?.[signal.field];
      if (!Array.isArray(samples)) continue;
      let latest;
      let latestUs = this.samples.get(signal.id)?.timestampUs ?? 0;
      for (const sample of samples) {
        const sampleUs = timestamp(sample);
        if (sampleUs !== null && sampleUs >= this.faceEpochUs && sampleUs > latestUs && sampleUs <= now * 1000 + 250_000) {
          latest = sample;
          latestUs = sampleUs;
        }
        if (signal.id === 'blinking' && sampleUs !== null && sampleUs >= this.faceEpochUs
          && sampleUs <= now * 1000 && now - sampleUs / 1000 <= BLINK_HOLD_MS
          && sample.stable === true && sample.detected === true) {
          this.blinkUntil = Math.max(this.blinkUntil, sampleUs / 1000 + BLINK_HOLD_MS);
        }
      }
      if (!latest) continue;
      if (signal.id === 'facing') {
        if (latest.reset === true) {
          this.invalidateFace();
          this.faceEpochUs = latestUs;
        }
        this.direction.update(latest.stable === true ? estimateCameraFacing(latest.value) : null, latestUs / 1000, latest.reset === true);
      }
      this.samples.set(signal.id, { sample: latest, timestampUs: latestUs, receivedAt: now });
    }
  }

  gameplayExpression({ active, validationCode }) {
    const reading = this.samples.get('expression');
    const now = this.now();
    if (!active || ![0, 3].includes(validationCode) || !reading || reading.sample.stable !== true
      || now - reading.timestampUs / 1000 > 450 || now - reading.receivedAt > 450) return null;
    const scores = reading.sample.scores;
    if (!Array.isArray(scores)) return null;
    const best = scores.filter((score) => Number.isInteger(score.type) && score.type >= 0 && score.type <= 8
      && Number.isFinite(score.confidence) && score.confidence >= 0 && score.confidence <= 100)
      .reduce((highest, score) => !highest || score.confidence > highest.confidence ? score : highest, null);
    return best && best.type !== 0 && best.confidence >= 45
      ? { type: best.type, confidence: best.confidence, timestampUs: reading.timestampUs }
      : null;
  }

  gameplayFacing({ active, validationCode, validationAt = null }) {
    if (!active) return null;
    const now = this.now();
    if ([1, 17].includes(validationCode) && validationAt !== null && now - validationAt <= 1000) return false;
    const reading = this.samples.get('facing');
    if (![0, 3, 7, 17].includes(validationCode) || !reading || reading.sample.stable !== true
      || now - reading.timestampUs / 1000 > 450 || now - reading.receivedAt > 450) return null;
    return validationCode === 17 ? false : this.direction.value;
  }

  snapshot({ active = true, validationCode = null, validationAt = null } = {}) {
    const now = this.now();
    const elapsed = this.startedAt === null ? 0 : Math.max(0, (now - this.startedAt) / 1000);
    return SIGNALS.map((signal) => {
      const result = { id: signal.id, value: '—', detail: 'Not connected', quality: 'waiting' };
      if (!active || this.startedAt === null) return result;
      if (signal.id === 'facing' && [1, 17].includes(validationCode) && validationAt !== null && now - validationAt <= 1000) {
        return { ...result, value: 'Away', detail: validationCode === 1 ? 'Face out of view' : 'Head turned away', quality: 'live' };
      }
      if (validationCode !== null && ![0, 3, 7, 17].includes(validationCode)) {
        return { ...result, detail: 'Adjust camera' };
      }
      const reading = this.samples.get(signal.id);
      if (!reading) return { ...result, detail: elapsed < 15 ? 'Waiting for signal' : 'Not available' };
      if (now - reading.receivedAt > FRESH_MS || now - reading.timestampUs / 1000 > FRESH_MS) {
        return { ...result, detail: 'Signal lost', quality: 'stale' };
      }
      const { sample } = reading;
      if (sample.stable !== true) return { ...result, detail: 'Acquiring signal' };
      if (signal.kind === 'landmarks') {
        if (this.direction.value === null) return { ...result, detail: 'Landmarks unavailable' };
        return {
          ...result,
          value: validationCode !== 17 && this.direction.value ? 'Toward' : 'Away',
          detail: 'Head direction', quality: 'live',
        };
      }
      if (signal.kind === 'detection') {
        if (typeof sample.detected !== 'boolean') return { ...result, detail: 'Not available' };
        const detected = signal.id === 'blinking' ? now < this.blinkUntil : sample.detected;
        return { ...result, value: detected ? 'Detected' : 'No', detail: signal.id === 'blinking' && detected ? 'Recent blink' : 'Live', quality: 'live' };
      }
      if (signal.kind === 'expression') {
        const scores = Array.isArray(sample.scores) ? sample.scores : [];
        const best = scores.filter((score) => EXPRESSIONS[score.type] && Number.isFinite(score.confidence) && score.confidence >= 0 && score.confidence <= 100)
          .reduce((highest, score) => !highest || score.confidence > highest.confidence ? score : highest, null);
        return best && best.confidence > 0
          ? { ...result, value: EXPRESSIONS[best.type], detail: Math.round(best.confidence) + '% confidence', quality: 'live' }
          : { ...result, detail: 'Not available' };
      }
      return result;
    });
  }
}

const VALIDATION_HINTS = {
  0: 'Keep one well-lit face in view. Face the camera to check direction.',
  1: 'No face found. Face the camera in good lighting.',
  2: 'More than one face found. Keep only yourself in view.',
  3: 'Move your face toward the center of the camera.',
  4: 'Adjust your distance from the camera.',
  5: 'It is too dark. Add an even light in front of you.',
  6: 'It is too bright. Reduce glare on your face.',
  7: 'Keep one well-lit face in view. Face the camera to check direction.',
  10: 'The camera is adjusting. Hold still for a moment.',
  11: 'Camera frame rate is low. Close other camera apps or reduce graphics load.',
  12: 'Too much movement. Keep your head and camera still.',
  13: 'Move a little farther from the camera.',
  14: 'Move a little closer to the camera.',
  15: 'Move your face a little lower in the frame.',
  16: 'Move your face a little higher in the frame.',
  17: 'Look forward toward the camera.',
};

export function validationHint(code, hint) {
  if (code === 7) return VALIDATION_HINTS[0];
  return typeof hint === 'string' && hint.trim() ? hint.trim().slice(0, 300) : VALIDATION_HINTS[code] ?? 'Adjust your position and lighting until the camera has a clear view.';
}

export function spectraError(error) {
  const cameraErrors = {
    NotAllowedError: 'Camera access was denied. Allow camera access in your system privacy settings, then retry.',
    PermissionDeniedError: 'Camera access was denied. Allow camera access in your system privacy settings, then retry.',
    NotFoundError: 'No camera was found. Connect a webcam, then retry.',
    DevicesNotFoundError: 'No camera was found. Connect a webcam, then retry.',
    NotReadableError: 'The camera is busy or unavailable. Close other camera apps, then retry.',
    TrackStartError: 'The camera could not start. Close other camera apps, then retry.',
    OverconstrainedError: 'This camera cannot provide the requested video. Select another camera or retry.',
    AbortError: 'The camera stopped while opening. Check its connection, then retry.',
    SecurityError: 'Camera access is blocked. Check your system privacy settings and restart the game.',
  };
  if (cameraErrors[error?.name]) return cameraErrors[error.name];
  const errors = {
    2: 'This API key was not accepted. Enter a valid SmartSpectra key in Settings, then try again.',
    3: 'Face tracking could not start on this device. Update or reinstall the game, then try again.',
    4: 'Your SmartSpectra credits have run out. Check your Presage account before trying again.',
    5: 'Could not verify your API key online. Check your connection, then try again.',
    6: 'Face tracking is temporarily unavailable. Try again in a moment.',
    7: 'The camera input became unavailable. Reconnect it and enable the camera again.',
    8: 'Face tracking could not read your camera feed. Check your lighting, then try again.',
    9: 'This camera frame format could not be processed. Select another camera or retry.',
    10: 'Camera timing became inconsistent. Stop the camera and enable it again.',
    11: 'The camera feed was interrupted. Check its connection, then try again.',
    13: 'This API key does not include facial tracking. Check your Presage account.',
    14: 'Frame rate stayed too low for face tracking. Improve lighting and close other apps, then try again.',
    SMARTSPECTRA_IPC_TIMEOUT: 'Face tracking did not respond in time. Try again or restart the game.',
    SIGNAL_STALLED: 'Face tracking stopped updating. Try again or restart the game.',
    SIGNAL_STOPPED: 'Face tracking stopped. Try again or restart the game.',
    CAMERA_TIMEOUT: 'The camera did not open in time. Check the permission prompt or webcam connection, then retry.',
    CAMERA_ENDED: 'The camera disconnected. Reconnect it and enable the camera again.',
    CAPTURE_UNSUPPORTED: 'Camera access is unavailable here. Open the desktop game.',
    PROCESSOR_UNSUPPORTED: 'Face tracking is unavailable in this version. Update the game, then try again.',
  };
  // Native messages can include credentials or paths. Keep raw failures out of the UI.
  return errors[error?.code] ?? 'Face tracking is unavailable. Try again or restart the game. You can keep playing.';
}
