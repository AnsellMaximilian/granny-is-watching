const rounded = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const maximum = values => values.length ? Math.max(...values) : null;
function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}
function boundedPush(values, value) {
  if (values.length < 512 && Number.isFinite(value) && value >= 0) values.push(value);
}

// Aggregate in memory. Only one timing summary per second crosses IPC; no frames,
// expressions, face coordinates, API keys, or raw native messages are persisted.
export class SpectraDiagnostics {
  constructor({ write, now = Date.now, monotonicNow = () => performance.now(), intervalMs = 1000 } = {}) {
    this.write = typeof write === 'function' ? write : null;
    this.now = now;
    this.monotonicNow = monotonicNow;
    this.intervalMs = intervalMs;
    this.startedAt = monotonicNow();
    this.sessionId = 0;
    this.sessionStartedAt = null;
    this.active = false;
    this.context = {};
    this.previousTimestampUs = null;
    this.previousArrivalMs = null;
    this.previousMetricsMs = null;
    this.firstStableFace = new Set();
    this.resetWindow();
  }

  resetWindow() {
    this.windowStartedAt = this.monotonicNow();
    this.window = {
      framesReceived: 0, framesSentTrue: 0, framesSentFalse: 0,
      duplicateTimestamps: 0, outOfOrderTimestamps: 0, timestampGapsOver40Ms: 0,
      firstSdkTimestampUs: null, lastSdkTimestampUs: null,
      sourceGaps: [], arrivalGaps: [], metricsGaps: [], renderGaps: [],
      metricsPackets: 0, faceLandmarks: 0, stableLandmarks: 0,
      faceExpressions: 0, stableExpressions: 0, blinkSamples: 0, talkingSamples: 0,
      renderFrames: 0,
    };
  }

  event(event, details = {}) {
    if (!this.write) return;
    try {
      this.write({
        event, atMs: this.now(), elapsedMs: rounded(this.monotonicNow() - this.startedAt),
        sessionId: this.sessionId || null,
        sessionElapsedMs: this.sessionStartedAt === null ? null : rounded(this.monotonicNow() - this.sessionStartedAt),
        ...this.context, ...details,
      });
    } catch { /* Diagnostics must never interrupt gameplay or SDK delivery. */ }
  }

  beginSession() {
    if (!this.write) return;
    this.flush(true);
    this.sessionId++;
    this.active = true;
    this.sessionStartedAt = this.monotonicNow();
    this.previousTimestampUs = null;
    this.previousArrivalMs = null;
    this.previousMetricsMs = null;
    this.firstStableFace.clear();
    this.resetWindow();
    this.event('session_start_requested');
  }

  endSession(reason) {
    if (!this.write || !this.active) return;
    this.flush(true);
    this.event('session_end', { reason });
    this.active = false;
    this.sessionStartedAt = null;
    this.previousTimestampUs = null;
    this.previousArrivalMs = null;
    this.previousMetricsMs = null;
  }

  frame(sent, timestampUs) {
    if (!this.write || !this.active) return;
    const window = this.window;
    const arrivalMs = this.monotonicNow();
    if (this.previousArrivalMs === null) this.event('first_frame', { sdkTimestampUs: timestampUs });
    window.framesReceived++;
    if (sent) window.framesSentTrue++; else window.framesSentFalse++;
    if (this.previousArrivalMs !== null) boundedPush(window.arrivalGaps, arrivalMs - this.previousArrivalMs);
    this.previousArrivalMs = arrivalMs;
    if (!Number.isSafeInteger(timestampUs) || timestampUs <= 0) return;
    if (this.previousTimestampUs !== null) {
      if (timestampUs === this.previousTimestampUs) { window.duplicateTimestamps++; return; }
      if (timestampUs < this.previousTimestampUs) { window.outOfOrderTimestamps++; return; }
      const gapMs = (timestampUs - this.previousTimestampUs) / 1000;
      boundedPush(window.sourceGaps, gapMs);
      if (gapMs > 40) window.timestampGapsOver40Ms++;
    }
    window.firstSdkTimestampUs ??= timestampUs;
    window.lastSdkTimestampUs = timestampUs;
    this.previousTimestampUs = timestampUs;
  }

  metrics(metrics) {
    if (!this.write || !this.active) return;
    const now = this.monotonicNow();
    if (this.previousMetricsMs !== null) boundedPush(this.window.metricsGaps, now - this.previousMetricsMs);
    this.previousMetricsMs = now;
    this.window.metricsPackets++;
    const face = metrics?.face;
    for (const [field, total, stable] of [
      ['landmarks', 'faceLandmarks', 'stableLandmarks'],
      ['expression', 'faceExpressions', 'stableExpressions'],
      ['blinking', 'blinkSamples'], ['talking', 'talkingSamples'],
    ]) {
      const samples = face?.[field];
      if (!Array.isArray(samples)) continue;
      this.window[total] += samples.length;
      if (stable) {
        const count = samples.filter(sample => sample?.stable === true).length;
        this.window[stable] += count;
        if (count > 0 && !this.firstStableFace.has(field)) {
          this.firstStableFace.add(field);
          this.event('first_stable_face', { source: field });
        }
      }
    }
  }

  gameFrame({ gamePhase, encounter = null, focused, documentHidden, settingsOpen, gameFps, renderFrameMs }) {
    if (!this.write) return;
    const changed = gamePhase !== this.context.gamePhase || encounter !== this.context.encounter
      || focused !== this.context.focused || documentHidden !== this.context.documentHidden || settingsOpen !== this.context.settingsOpen;
    Object.assign(this.context, { gamePhase, encounter, focused, documentHidden, settingsOpen, gameFps: rounded(gameFps) });
    this.window.renderFrames++;
    boundedPush(this.window.renderGaps, renderFrameMs);
    if (changed) this.event('game_context');
  }

  poll(details = {}) {
    if (!this.write) return;
    Object.assign(this.context, details);
    this.flush();
  }

  flush(force = false) {
    if (!this.write) return;
    const elapsed = this.monotonicNow() - this.windowStartedAt;
    if (elapsed < this.intervalMs && !force) return;
    const window = this.window;
    if (elapsed > 0 && (this.active || window.framesReceived || window.metricsPackets || window.renderFrames)) {
      const meanSourceGap = average(window.sourceGaps);
      this.event('timing_sample', {
        windowMs: rounded(elapsed), analysisActive: this.active,
        framesReceived: window.framesReceived, framesSentTrue: window.framesSentTrue, framesSentFalse: window.framesSentFalse,
        callbackFps: rounded(window.framesReceived * 1000 / elapsed),
        timestampFps: rounded(meanSourceGap > 0 ? 1000 / meanSourceGap : null),
        firstSdkTimestampUs: window.firstSdkTimestampUs, lastSdkTimestampUs: window.lastSdkTimestampUs,
        sourceGapMeanMs: rounded(meanSourceGap), sourceGapP95Ms: rounded(percentile95(window.sourceGaps)), sourceGapMaxMs: rounded(maximum(window.sourceGaps)),
        timestampGapsOver40Ms: window.timestampGapsOver40Ms,
        arrivalGapP95Ms: rounded(percentile95(window.arrivalGaps)), arrivalGapMaxMs: rounded(maximum(window.arrivalGaps)),
        duplicateTimestamps: window.duplicateTimestamps, outOfOrderTimestamps: window.outOfOrderTimestamps,
        metricsPackets: window.metricsPackets, metricsGapMaxMs: rounded(maximum(window.metricsGaps)),
        faceLandmarks: window.faceLandmarks, stableLandmarks: window.stableLandmarks,
        faceExpressions: window.faceExpressions, stableExpressions: window.stableExpressions,
        blinkSamples: window.blinkSamples, talkingSamples: window.talkingSamples,
        renderFrames: window.renderFrames, renderGapP95Ms: rounded(percentile95(window.renderGaps)), renderGapMaxMs: rounded(maximum(window.renderGaps)),
      });
    }
    this.resetWindow();
  }
}
