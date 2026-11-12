export const SIGNALS = [
  { id: 'pulse', label: 'Pulse', group: 'cardio', field: 'pulseRate', unit: 'bpm', warmup: 12, confidence: 40 },
  { id: 'breathing', label: 'Breathing', group: 'breathing', field: 'rate', unit: 'br/min', warmup: 30, confidence: 45 },
  { id: 'hrv', label: 'HRV · RMSSD', group: 'cardio', field: 'hrv', valueField: 'rmssd', unit: 'ms', warmup: 60, confidence: 50 },
  { id: 'blinking', label: 'Blink', group: 'face', field: 'blinking', kind: 'detection', warmup: 0 },
  { id: 'talking', label: 'Talking', group: 'face', field: 'talking', kind: 'detection', warmup: 0 },
  { id: 'expression', label: 'Expression', group: 'face', field: 'expression', kind: 'expression', warmup: 0 },
  { id: 'eda', label: 'EDA proxy · unitless', group: 'eda', field: 'trace', kind: 'trace', warmup: 35 },
];

const EXPRESSIONS = ['Unspecified', 'Angry', 'Contempt', 'Disgust', 'Fear', 'Happy', 'Neutral', 'Sad', 'Surprise'];
const FRESH_MS = 5000;
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
  }

  start() {
    this.clear();
    this.startedAt = this.now();
  }

  ingest(metrics) {
    const now = this.now();
    for (const signal of SIGNALS) {
      const samples = metrics?.[signal.group]?.[signal.field];
      if (!Array.isArray(samples)) continue;
      let latest;
      let latestUs = this.samples.get(signal.id)?.timestampUs ?? 0;
      for (const sample of samples) {
        const sampleUs = timestamp(sample);
        if (sampleUs !== null && sampleUs > latestUs && sampleUs <= now * 1000 + 2_000_000) {
          latest = sample;
          latestUs = sampleUs;
        }
      }
      if (latest) this.samples.set(signal.id, { sample: latest, timestampUs: latestUs, receivedAt: now });
    }
  }

  snapshot({ active = true, validationCode = null } = {}) {
    const now = this.now();
    const elapsed = this.startedAt === null ? 0 : Math.max(0, (now - this.startedAt) / 1000);
    return SIGNALS.map((signal) => {
      const result = { id: signal.id, value: '—', detail: 'Not connected', quality: 'waiting' };
      if (!active || this.startedAt === null) return result;
      if (validationCode !== null && validationCode !== 0 && (validationCode !== 7 || signal.id === 'breathing')) {
        return { ...result, detail: 'Adjust camera' };
      }
      if (elapsed < signal.warmup) {
        return { ...result, detail: 'Warming up · ' + Math.ceil(signal.warmup - elapsed) + 's' };
      }
      const reading = this.samples.get(signal.id);
      if (!reading) return { ...result, detail: elapsed < signal.warmup + 15 ? 'Waiting for signal' : 'Not available' };
      if (now - reading.receivedAt > FRESH_MS || now - reading.timestampUs / 1000 > FRESH_MS) {
        return { ...result, detail: 'Signal lost', quality: 'stale' };
      }
      const { sample } = reading;
      const confidence = sample.confidence;
      if (signal.confidence !== undefined && (!Number.isFinite(confidence) || confidence < signal.confidence || confidence > 100)) {
        return { ...result, detail: Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? 'Low confidence · ' + Math.round(confidence) + '%' : 'Waiting for confidence' };
      }
      if (sample.stable !== true) return { ...result, detail: 'Acquiring signal' };
      if (signal.kind === 'detection') {
        if (typeof sample.detected !== 'boolean') return { ...result, detail: 'Not available' };
        return { ...result, value: sample.detected ? 'Detected' : 'No', detail: 'Live', quality: 'live' };
      }
      if (signal.kind === 'expression') {
        const scores = Array.isArray(sample.scores) ? sample.scores : [];
        const best = scores.filter((score) => EXPRESSIONS[score.type] && Number.isFinite(score.confidence) && score.confidence >= 0 && score.confidence <= 100)
          .reduce((highest, score) => !highest || score.confidence > highest.confidence ? score : highest, null);
        return best && best.confidence > 0
          ? { ...result, value: EXPRESSIONS[best.type], detail: Math.round(best.confidence) + '% confidence', quality: 'live' }
          : { ...result, detail: 'Not available' };
      }
      const value = sample[signal.valueField ?? 'value'];
      if (!Number.isFinite(value) || (signal.kind !== 'trace' && value <= 0)) return { ...result, detail: 'Not available' };
      return {
        ...result,
        value: signal.kind === 'trace' ? Number(value.toPrecision(3)).toString() : Math.round(value) + ' ' + signal.unit,
        detail: signal.confidence === undefined ? 'Live proxy signal' : Math.round(confidence) + '% confidence',
        quality: 'live',
      };
    });
  }
}

const VALIDATION_HINTS = {
  0: 'Keep still in even front lighting. Include your upper chest for breathing.',
  1: 'No face found. Face the camera in good lighting.',
  2: 'More than one face found. Keep only yourself in view.',
  3: 'Move your face toward the center of the camera.',
  4: 'Adjust your distance from the camera.',
  5: 'It is too dark. Add an even light in front of you.',
  6: 'It is too bright. Reduce glare on your face.',
  7: 'Move back slightly so your upper chest is visible for breathing.',
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
    2: 'SmartSpectra rejected the API key. Enter a valid key below, then retry signals.',
    3: 'SmartSpectra could not configure these signals on this device. Update or reinstall the SDK, then retry.',
    4: 'SmartSpectra credits are exhausted. Check your developer account before retrying.',
    5: 'SmartSpectra could not authenticate online. Check your connection, then retry signals.',
    6: 'SmartSpectra is temporarily unavailable. Retry signals in a moment.',
    7: 'The camera input became unavailable. Reconnect it and enable the camera again.',
    8: 'SmartSpectra could not process this camera feed. Check lighting and camera support, then retry signals.',
    9: 'This camera frame format could not be processed. Select another camera or retry.',
    10: 'Camera timing became inconsistent. Stop the camera and enable it again.',
    11: 'Camera frames were interrupted. Check your camera, then retry signals.',
    13: 'This API key does not allow the requested signals. Check its permissions in your developer account.',
    14: 'Frame rate stayed too low for reliable signals. Improve lighting and close other apps, then retry signals.',
    SMARTSPECTRA_IPC_TIMEOUT: 'SmartSpectra did not respond in time. Retry signals, or restart the desktop app.',
    SIGNAL_STALLED: 'SmartSpectra stopped sending updates. Retry signals, or restart the desktop app.',
    SIGNAL_STOPPED: 'SmartSpectra stopped processing. Retry signals, or restart the desktop app.',
    CAMERA_TIMEOUT: 'The camera did not open in time. Check the permission prompt or webcam connection, then retry.',
    CAMERA_ENDED: 'The camera disconnected. Reconnect it and enable the camera again.',
    CAPTURE_UNSUPPORTED: 'Camera capture is unavailable here. Open the desktop game with npm start.',
    PROCESSOR_UNSUPPORTED: 'This desktop runtime cannot process camera frames. Update the desktop app, then retry signals.',
  };
  // Native messages can include credentials or paths. Keep raw failures out of the UI.
  return errors[error?.code] ?? 'Signals are unavailable. Retry signals, or restart the desktop app. You can keep playing.';
}
