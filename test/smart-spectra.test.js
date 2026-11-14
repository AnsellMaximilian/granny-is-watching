import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, decodeMetrics } from '@smartspectra/node-sdk/messages';
import { SignalReadings, spectraError, validationHint } from '../src/smart-spectra-readings.js';
import { SpectraSession } from '../src/smart-spectra-session.js';
import { SpectraDiagnostics } from '../src/spectra-diagnostics.js';
import { estimateCameraFacing } from '../src/face-direction.js';

function facePoints({ noseX = 300, noseY = 240 } = {}) {
  const points = Array.from({ length: 478 }, () => ({ x: 300, y: 250 }));
  for (const [index, x, y] of [[33, 210, 180], [133, 250, 180], [263, 390, 180], [362, 350, 180], [1, noseX, noseY], [152, 300, 380]]) {
    points[index] = { x, y };
  }
  return points;
}

function readingsFixture() {
  let time = Date.UTC(2026, 10, 13);
  const model = new SignalReadings(() => time);
  model.start();
  return {
    model,
    advance: (ms) => { time += ms; },
    sample: (fields = {}) => ({ stable: true, timestamp: time * 1000, ...fields }),
    get: (id, options) => model.snapshot(options).find((reading) => reading.id === id),
  };
}

test('facial protobuf signals are available immediately, including false detections and classification confidence', () => {
  const { model, sample, get } = readingsFixture();
  const payload = Metrics.fromObject({
    face: {
      landmarks: [sample({ value: facePoints() })],
      blinking: [sample({ detected: false })], talking: [sample({ detected: true })],
      expression: [sample({ scores: [{ type: 4, confidence: 17 }, { type: 6, confidence: 83 }] })],
    },
  });
  model.ingest(decodeMetrics(Metrics.encode(payload).finish()));
  assert.equal(model.snapshot().length, 4);
  assert.equal(get('facing').value, 'Toward');
  assert.equal(get('blinking').value, 'No');
  assert.equal(get('talking').value, 'Detected');
  assert.equal(get('expression').value, 'Neutral');
  assert.equal(get('expression').detail, '83% confidence');
});

test('head direction handles translation, scale, mirroring and roll while rejecting turned or invalid faces', () => {
  const points = facePoints();
  const angle = Math.PI / 6;
  const transformed = points.map(({ x, y }) => ({
    x: 0.25 * (Math.cos(angle) * x - Math.sin(angle) * y) + 120,
    y: 0.25 * (Math.sin(angle) * x + Math.cos(angle) * y) - 30,
  }));
  assert.equal(estimateCameraFacing(points), true);
  assert.equal(estimateCameraFacing(transformed), true);
  assert.equal(estimateCameraFacing(points.map(({ x, y }) => ({ x: 640 - x, y }))), true);
  assert.equal(estimateCameraFacing(facePoints({ noseX: 355 })), false);
  assert.equal(estimateCameraFacing(facePoints({ noseY: 325 })), false);
  assert.equal(estimateCameraFacing([]), null);
  assert.equal(estimateCameraFacing(Array(478).fill({ x: 0, y: 0 })), null);
  const invalid = facePoints();
  invalid[1].x = NaN;
  assert.equal(estimateCameraFacing(invalid), null);
});

test('head direction resists brief jitter, responds to a sustained turn and resets on a new track', () => {
  const { model, advance, sample, get } = readingsFixture();
  const feed = (fields = {}) => model.ingest({ face: { landmarks: [sample({ value: facePoints(), ...fields })] } });
  feed();
  advance(40);
  feed({ value: facePoints({ noseX: 355 }) });
  assert.equal(get('facing').value, 'Toward');
  advance(40);
  feed();
  assert.equal(get('facing').value, 'Toward');
  advance(40);
  feed({ value: facePoints({ noseX: 355 }) });
  advance(160);
  feed({ value: facePoints({ noseX: 355 }) });
  assert.equal(get('facing').value, 'Away');
  advance(40);
  feed({ reset: true });
  assert.equal(get('facing').value, 'Toward');
  assert.equal(get('facing', { validationCode: 17 }).value, 'Away');
});

test('brief blinks remain visible when the last sample in a packet has already returned to false', () => {
  const { model, advance, sample, get } = readingsFixture();
  const blink = sample({ detected: true });
  advance(100);
  model.ingest({ face: { blinking: [blink, sample({ detected: false })] } });
  assert.equal(get('blinking').value, 'Detected');
  advance(300);
  assert.equal(get('blinking').value, 'No');
  advance(2000);
  model.ingest({ face: { blinking: [blink, sample({ detected: false })] } });
  assert.equal(get('blinking').value, 'No', 'Old history does not create another blink');
});

test('partial packets, repeats and older samples cannot keep a stale facial reading alive', () => {
  const { model, advance, sample, get } = readingsFixture();
  const current = sample({ detected: true });
  model.ingest({ face: { talking: [current] } });
  advance(400);
  model.ingest({ face: { blinking: [sample({ detected: false })] } });
  assert.equal(get('talking').value, 'Detected');
  model.ingest({ face: { talking: [sample({ detected: false, timestamp: current.timestamp - 1 })] } });
  assert.equal(get('talking').value, 'Detected');
  advance(1200);
  model.ingest({ face: { talking: [current] } });
  assert.equal(get('talking').quality, 'stale');
  assert.equal(get('talking').value, '—');
  model.ingest({ face: { talking: [sample({ detected: false })] } });
  assert.equal(get('talking').value, 'No');
  assert.equal(get('talking', { validationCode: 1 }).value, '—');
  assert.equal(get('talking', { active: false }).value, '—');
});

test('missing, unstable, malformed and badly timed face samples never produce confident defaults', () => {
  const { model, advance, sample, get } = readingsFixture();
  model.ingest({ face: { talking: [sample({ detected: false, timestamp: undefined })] } });
  assert.equal(get('talking').value, '—');
  model.ingest({ face: { talking: [sample({ detected: false, timestamp: sample().timestamp + 10_000_000 })] } });
  assert.equal(get('talking').value, '—');
  model.ingest({ face: { talking: [sample({ detected: true, stable: false })] } });
  assert.equal(get('talking').detail, 'Acquiring signal');
  model.ingest({ face: { landmarks: [sample({ value: [] })] } });
  assert.equal(get('facing').value, '—');
  advance(1);
  model.ingest({ face: { talking: [sample({ detected: false })] } });
  assert.equal(get('talking', { validationCode: 7 }).value, 'No');
  assert.equal(get('talking', { validationCode: 99 }).value, '—');
  advance(16000);
  assert.equal(get('expression').detail, 'Not available');
});

test('a landmark tracking reset clears previous blink and expression samples without replaying their history', () => {
  const { model, advance, sample, get } = readingsFixture();
  const previousBlink = sample({ detected: true });
  const previousExpression = sample({ scores: [{ type: 6, confidence: 90 }] });
  model.ingest({ face: {
    landmarks: [sample({ value: facePoints() })], blinking: [previousBlink], expression: [previousExpression],
  } });
  assert.equal(get('blinking').value, 'Detected');
  assert.equal(get('expression').value, 'Neutral');
  advance(80);
  model.ingest({ face: { landmarks: [sample({ value: facePoints(), reset: true })] } });
  model.ingest({ face: { blinking: [previousBlink], expression: [previousExpression] } });
  assert.equal(get('facing').value, 'Toward');
  assert.equal(get('blinking').value, '—');
  assert.equal(get('expression').value, '—');
});

test('camera and SDK errors give actionable messages without displaying native secrets', () => {
  assert.match(spectraError({ name: 'NotAllowedError' }), /privacy settings/);
  assert.match(spectraError({ name: 'NotFoundError' }), /Connect a webcam/);
  assert.match(spectraError({ code: 2 }), /API key/);
  assert.match(spectraError({ code: 14 }), /Frame rate/);
  assert.match(spectraError({ code: 'SMARTSPECTRA_IPC_TIMEOUT' }), /did not respond/);
  assert.ok(!spectraError({ code: 99, message: 'secret-test-key' }).includes('secret-test-key'));
  assert.match(validationHint(1, ''), /No face/);
  assert.equal(validationHint(99, '  Please face forward.  '), 'Please face forward.');
});

test('gameplay expressions require fresh, stable, confident classifications even while debug values remain visible', () => {
  const { model, advance, sample } = readingsFixture();
  const options = { active: true, validationCode: 0 };
  model.ingest({ face: { expression: [sample({ scores: [{ type: 5, confidence: 83 }] })] } });
  assert.equal(model.gameplayExpression(options).type, 5);
  assert.equal(model.gameplayExpression({ ...options, active: false }), null);
  assert.equal(model.gameplayExpression({ ...options, validationCode: 1 }), null);
  advance(500);
  assert.equal(model.gameplayExpression(options), null);
  assert.equal(model.snapshot().find((reading) => reading.id === 'expression').value, 'Happy');
  for (const fields of [
    { scores: [{ type: 5, confidence: 20 }] },
    { scores: [{ type: 0, confidence: 90 }, { type: 5, confidence: 10 }] },
    { scores: [{ type: 5, confidence: 90 }], stable: false },
  ]) {
    advance(1);
    model.ingest({ face: { expression: [sample(fields)] } });
    assert.equal(model.gameplayExpression(options), null);
  }
});

test('gameplay away uses fresh turned-head or no-face feedback and never mistakes a disconnected camera for looking away', () => {
  const { model, advance, sample, get } = readingsFixture();
  const now = sample().timestamp / 1000;
  const options = { active: true, validationCode: 1, validationAt: now };
  assert.equal(model.gameplayFacing(options), false);
  assert.equal(get('facing', options).value, 'Away');
  assert.equal(get('facing', options).detail, 'Face out of view');
  assert.equal(model.gameplayFacing({ ...options, active: false }), null);
  assert.equal(model.gameplayFacing({ ...options, validationCode: 2 }), null);
  assert.equal(model.gameplayFacing({ ...options, validationCode: 17 }), false);
  advance(1100);
  assert.equal(model.gameplayFacing(options), null);
  model.ingest({ face: { landmarks: [sample({ value: facePoints() })] } });
  assert.equal(model.gameplayFacing({ active: true, validationCode: 0 }), true);
  advance(500);
  assert.equal(model.gameplayFacing({ active: true, validationCode: 0 }), null);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeStream() {
  const track = new EventTarget();
  track.readyState = 'live';
  track.stop = () => { track.readyState = 'ended'; };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

function sessionFixture({ getUserMedia, loadSdk, captureTimeoutMs, now, diagnostics } = {}) {
  const stream = fakeStream();
  const instances = [];
  class FakeSdk {
    constructor(options) { this.options = options; this.listeners = new Map(); instances.push(this); }
    on(name, callback) { this.listeners.set(name, callback); }
    useMediaStream(input) { this.stream = input; }
    async start() {
      this.starts = (this.starts ?? 0) + 1;
      this.listeners.get('processingStatus')(3);
      this.listeners.get('validationStatus')(0, 0, '');
    }
    async stop() { this.stops = (this.stops ?? 0) + 1; this.send('processingStatus', 1); }
    destroy() { this.destroyed = true; }
    send(name, ...args) { this.listeners.get(name)?.(...args); }
  }
  const session = new SpectraSession({
    mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream), enumerateDevices: async () => [] },
    loadSdk: loadSdk ?? (async () => ({ SmartSpectraSDK: FakeSdk, requestedMetrics: [11, 12, 13, 14], decodeMetrics: (value) => value })),
    captureTimeoutMs, now, diagnostics,
  });
  session.configure({ desktop: true, nativeAvailable: true, apiKey: 'test-local-key' });
  return { session, stream, instances, FakeSdk };
}

test('a missing key or native runtime preserves a working preview without starting the SDK', async () => {
  const { session, stream, instances } = sessionFixture();
  session.configure({ desktop: true, nativeAvailable: true });
  await session.startCamera();
  assert.equal(session.state.phase, 'preview');
  assert.equal(session.state.stream, stream);
  assert.match(session.state.hint, /API key/);
  assert.equal(instances.length, 0);
  await session.setKey('replacement-key');
  assert.equal(session.state.phase, 'preview', 'Entering a key alone does not spend analysis time');
  assert.equal(instances.length, 0);
  await session.startSignals();
  assert.equal(session.state.phase, 'measuring');
  assert.equal(instances.length, 1);
  assert.equal(instances[0].options.enableTelemetry, false);
  session.stopCamera();
  assert.equal(stream.track.readyState, 'ended');
  assert.ok(instances[0].destroyed);
  assert.equal(session.state.stream, null);
});

test('late camera permission grants are released after cancellation and after timeout', async () => {
  for (const timeout of [false, true]) {
    const capture = deferred();
    const { session, stream, instances } = sessionFixture({ getUserMedia: () => capture.promise, captureTimeoutMs: timeout ? 10 : 1000 });
    const starting = session.startCamera();
    if (timeout) {
      await starting;
      assert.equal(session.state.phase, 'camera-error');
      assert.match(session.state.hint, /did not open in time/);
    } else session.stopCamera();
    capture.resolve(stream);
    await starting;
    await Promise.resolve();
    assert.equal(stream.track.readyState, 'ended');
    assert.equal(instances.length, 0);
    assert.equal(session.state.stream, null);
  }
});

test('camera denial is recoverable and never starts a native session', async () => {
  const { session, instances } = sessionFixture({ getUserMedia: async () => { throw { name: 'NotAllowedError' }; } });
  await session.startCamera();
  assert.equal(session.state.phase, 'camera-error');
  assert.match(session.state.hint, /denied/);
  assert.equal(instances.length, 0);
});

test('browser or missing-native fallback keeps the preview usable without loading native code', async () => {
  for (const desktop of [false, true]) {
    const { session, stream, instances } = sessionFixture();
    session.configure({ desktop, nativeAvailable: false, apiKey: 'test-local-key' });
    await session.startCamera();
    await session.startSignals();
    assert.equal(session.state.phase, 'preview');
    assert.equal(session.state.stream, stream);
    assert.equal(instances.length, 0);
    assert.match(session.state.hint, desktop ? /Restart the game/ : /desktop game/);
    session.stopCamera();
  }
});

test('a packaged runtime failure offers reinstall guidance instead of source-development commands', async () => {
  const { session, stream, instances } = sessionFixture();
  session.configure({ desktop: true, packaged: true, nativeAvailable: false });
  await session.startCamera();
  await session.startSignals();
  assert.equal(session.state.stream, stream);
  assert.equal(instances.length, 0);
  assert.match(session.state.hint, /Reinstall the game/);
  assert.match(session.state.hint, /Visual C\+\+ x64 runtime/);
  assert.ok(!session.state.hint.includes('npm'));
  session.stopCamera();
});

test('disconnects release the native session and late callbacks cannot revive it', async () => {
  const { session, stream, instances } = sessionFixture();
  await session.startCamera();
  await session.startSignals();
  stream.track.dispatchEvent(new Event('ended'));
  assert.equal(session.state.phase, 'camera-error');
  assert.ok(instances[0].destroyed);
  assert.equal(stream.track.readyState, 'ended');
  instances[0].send('validationStatus', 0, 0, 'Late event');
  assert.equal(session.state.phase, 'camera-error');
});

test('losing the face clears detections and chest-only feedback does not block facial analysis', async () => {
  const { session, instances } = sessionFixture();
  await session.startCamera();
  await session.startSignals();
  instances[0].send('metrics', { face: { talking: [{ timestamp: Date.now() * 1000, stable: true, detected: true }] } });
  assert.equal(session.readings.snapshot().find((reading) => reading.id === 'talking').value, 'Detected');
  instances[0].send('validationStatus', 1, 0, 'No face found.');
  assert.equal(session.readings.samples.size, 0);
  assert.equal(session.state.phase, 'adjust');
  instances[0].send('validationStatus', 7, 0, 'Chest not visible.');
  assert.equal(session.state.validationCode, 0);
  assert.equal(session.state.phase, 'measuring');
  assert.ok(!session.state.hint.toLowerCase().includes('chest'));
  session.stopCamera();
});

test('fatal low-frame-rate errors keep the preview, clear signals and require a manual retry', async () => {
  const { session, instances } = sessionFixture();
  await session.startCamera();
  await session.startSignals();
  instances[0].send('error', 14, 'native internal error', true);
  assert.equal(session.state.phase, 'signal-error');
  assert.ok(session.state.stream);
  assert.equal(session.readings.startedAt, null);
  assert.equal(instances.length, 1);
  await session.startSignals();
  assert.equal(instances.length, 2);
  assert.equal(session.state.phase, 'measuring');
  session.stopCamera();
});

test('diagnostics preserve working face feedback and the exact cutoff time without changing recovery', async () => {
  const records = [];
  const base = 1_800_000_000_000;
  let time = base;
  const diagnostics = new SpectraDiagnostics({ write: record => records.push(record), now: () => time, monotonicNow: () => time - base });
  const { session, instances } = sessionFixture({ now: () => time, diagnostics });
  await session.startCamera();
  await session.startSignals();
  time += 1000;
  instances[0].send('frameSentThrough', true, time * 1000);
  instances[0].send('metrics', { face: { expression: [{ stable: true, timestamp: time * 1000, scores: [{ type: 5, confidence: 90 }] }] } });
  time += 2000;
  instances[0].send('validationStatus', 11, time * 1000, 'Frame rate is low.');
  time += 2000;
  instances[0].send('error', 14, 'raw message with test-local-key', true);
  const error = records.find(record => record.event === 'sdk_error');
  assert.equal(error.code, 14);
  assert.equal(error.retryable, true);
  assert.equal(error.source, 'sdk_event');
  assert.equal(error.sessionElapsedMs, 5000);
  assert.equal(records.find(record => record.event === 'first_stable_face').sessionElapsedMs, 1000);
  assert.equal(records.find(record => record.event === 'session_end').sessionElapsedMs, 5000);
  assert.ok(!JSON.stringify(records).includes('test-local-key'));
  assert.ok(!JSON.stringify(records).includes('confidence'));
  assert.equal(session.state.phase, 'signal-error');
  assert.equal(instances.length, 1, 'Logging never automatically retries a failed session');
  session.stopCamera();
});

test('stopping while the renderer module loads prevents a late SDK instance from starting', async () => {
  const loading = deferred();
  const { session, stream, instances, FakeSdk } = sessionFixture({ loadSdk: () => loading.promise });
  await session.startCamera();
  const starting = session.startSignals();
  await Promise.resolve();
  await Promise.resolve();
  session.stopCamera();
  loading.resolve({ SmartSpectraSDK: FakeSdk, requestedMetrics: [11, 12, 13, 14], decodeMetrics: (value) => value });
  await starting;
  assert.equal(instances.length, 0);
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(session.state.phase, 'off');
});

test('silent processing stops and missing heartbeats become recoverable signal errors', async () => {
  for (const stopped of [false, true]) {
    let time = Date.now();
    const { session, instances } = sessionFixture({ now: () => time });
    await session.startCamera();
    await session.startSignals();
    if (stopped) instances[0].send('processingStatus', 5);
    time += stopped ? 1001 : 35001;
    session.poll();
    assert.equal(session.state.phase, 'signal-error');
    assert.ok(session.state.stream);
    assert.ok(instances[0].destroyed);
    assert.match(session.state.hint, /stopped/);
    session.stopCamera();
  }
});

test('a malformed protobuf packet is contained without losing the preview or throwing into the game', async () => {
  const { session, instances } = sessionFixture({
    loadSdk: async () => ({
      SmartSpectraSDK: class {
        on(name, callback) { this[name] = callback; }
        useMediaStream() {}
        async start() { this.metrics(new Uint8Array([255])); }
        destroy() {}
      },
      requestedMetrics: [11, 12, 13, 14], decodeMetrics,
    }),
  });
  await session.startCamera();
  await session.startSignals();
  assert.equal(session.state.phase, 'signal-error');
  assert.ok(session.state.stream);
  assert.equal(instances.length, 0);
  session.stopCamera();
});

test('camera preview with a valid key stays idle until analysis is needed', async () => {
  const { session, stream, instances } = sessionFixture();
  await session.startCamera();
  assert.equal(session.state.stream, stream);
  assert.equal(session.state.phase, 'preview');
  assert.equal(session.state.sdkStatus, 'idle');
  assert.equal(instances.length, 0);
  assert.equal(session.gameplaySignals().healthy, false);
  session.stopCamera();
});

test('tracking feed FPS counts rejected frames, ignores duplicate callbacks and preserves the last rate for diagnosis', async () => {
  let time = Date.now();
  const { session, instances } = sessionFixture({ now: () => time });
  await session.startCamera();
  await session.startSignals();
  const sdk = instances[0];
  const start = time;
  for (let frame = 0; frame <= 30; frame++) {
    time = start + frame * 1000 / 30;
    sdk.send('frameSentThrough', frame % 2 === 0, time * 1000);
    sdk.send('frameSentThrough', true, time * 1000); // Same frame, repeated.
  }
  assert.ok(Math.abs(session.frameRate.read() - 30) < 0.01);
  await session.stopSignals();
  assert.equal(session.frameRate.read(), null);
  assert.ok(Math.abs(session.state.lastTrackingFps - 30) < 0.01);
  sdk.send('frameSentThrough', true, (time + 1000) * 1000);
  assert.equal(session.frameRate.read(), null, 'Late callbacks cannot revive the stopped counter');
  await session.startSignals();
  assert.equal(session.state.lastTrackingFps, null);
  const resumed = time;
  for (let frame = 0; frame <= 15; frame++) {
    time = resumed + frame * 1000 / 15;
    sdk.send('frameSentThrough', false, time * 1000);
  }
  sdk.send('error', 14, 'Low frame rate', false);
  assert.equal(session.state.sdkStatus, 'error');
  assert.ok(Math.abs(session.state.lastTrackingFps - 15) < 0.01);
  session.stopCamera();
  assert.equal(session.state.lastTrackingFps, null);
});

test('encounters reuse a stopped SDK while keeping the original camera live and clearing old signals', async () => {
  const { session, stream, instances } = sessionFixture();
  await session.startCamera();
  await Promise.all(Array.from({ length: 20 }, () => session.setAnalysisNeeded(true)));
  assert.equal(instances.length, 1);
  const sdk = instances[0];
  assert.equal(sdk.starts, 1);
  assert.equal(session.state.sdkStatus, 'running');
  sdk.send('metrics', { face: { expression: [{ timestamp: Date.now() * 1000, stable: true, scores: [{ type: 5, confidence: 90 }] }] } });
  assert.equal(session.gameplaySignals().expression.type, 5);
  const lateValidation = sdk.listeners.get('validationStatus');
  const lateMetrics = sdk.listeners.get('metrics');
  const stopping = session.stopSignals();
  assert.equal(session.gameplaySignals().expression, null, 'Stopped analysis is unavailable immediately');
  await stopping;
  lateValidation(0, 0, 'Late validation');
  lateMetrics({ face: { talking: [{ timestamp: Date.now() * 1000, stable: true, detected: true }] } });
  assert.equal(session.state.sdkStatus, 'idle');
  assert.equal(session.state.phase, 'preview');
  assert.equal(session.readings.samples.size, 0);
  assert.equal(sdk.stops, 1);
  assert.ok(!sdk.destroyed, 'A clean stop retains the graph');
  assert.equal(stream.track.readyState, 'live');
  await session.setAnalysisNeeded(true);
  assert.equal(instances.length, 1);
  assert.equal(sdk.starts, 2);
  assert.equal(session.gameplaySignals().expression, null, 'A new encounter cannot inherit the old smile');
  session.stopCamera();
  assert.ok(sdk.destroyed);
  assert.equal(stream.track.readyState, 'ended');
});

test('an encounter ending during SDK startup cancels analysis without stopping its preview', async () => {
  const starting = deferred();
  const { session, stream, instances, FakeSdk } = sessionFixture();
  FakeSdk.prototype.start = () => starting.promise;
  await session.startCamera();
  const demand = session.setAnalysisNeeded(true);
  for (let i = 0; i < 10 && instances.length === 0; i++) await Promise.resolve();
  assert.equal(instances.length, 1);
  const stopped = session.setAnalysisNeeded(false);
  assert.ok(instances[0].destroyed);
  instances[0].send('validationStatus', 0, 0, 'Late startup');
  starting.resolve();
  await Promise.all([demand, stopped]);
  assert.equal(session.state.sdkStatus, 'idle');
  assert.equal(session.state.phase, 'preview');
  assert.equal(session.gameplaySignals().healthy, false);
  assert.equal(stream.track.readyState, 'live');
  session.stopCamera();
});

test('a new encounter waits for the previous asynchronous stop before restarting', async () => {
  const draining = deferred();
  const { session, instances, FakeSdk } = sessionFixture();
  FakeSdk.prototype.stop = () => draining.promise;
  await session.startCamera();
  await session.setAnalysisNeeded(true);
  const stopping = session.setAnalysisNeeded(false);
  await Promise.resolve();
  const restarting = session.setAnalysisNeeded(true);
  await Promise.resolve();
  assert.equal(instances[0].starts, 1);
  draining.resolve();
  await Promise.all([stopping, restarting]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].starts, 2);
  assert.equal(session.state.sdkStatus, 'running');
  session.stopCamera();
});

test('a pause and resume in the same task cannot leave analysis running with invalidated callbacks', async () => {
  const { session, instances } = sessionFixture();
  await session.startCamera();
  await session.setAnalysisNeeded(true);
  const stopping = session.setAnalysisNeeded(false);
  const restarting = session.setAnalysisNeeded(true);
  await Promise.all([stopping, restarting]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].stops, 1);
  assert.equal(instances[0].starts, 2);
  assert.equal(session.state.sdkStatus, 'running');
  instances[0].send('validationStatus', 1, 0, 'No face');
  assert.equal(session.gameplaySignals().facing, false);
  session.stopCamera();
});

test('credit failures stay blocked across automatic encounter requests until a deliberate retry', async () => {
  const { session, stream, instances } = sessionFixture();
  await session.startCamera();
  await session.setAnalysisNeeded(true);
  instances[0].send('error', 4, 'Credit exhausted', false);
  assert.equal(session.state.sdkStatus, 'error');
  for (let i = 0; i < 5; i++) {
    await session.setAnalysisNeeded(false);
    await session.setAnalysisNeeded(true);
  }
  assert.equal(instances.length, 1);
  assert.equal(session.state.phase, 'signal-error');
  assert.equal(stream.track.readyState, 'live');
  await session.startSignals();
  assert.equal(instances.length, 2);
  assert.equal(session.state.sdkStatus, 'running');
  session.stopCamera();
});

test('low-rate validation recovers in place, but a terminal low-rate failure needs one deliberate fresh session', async () => {
  let time = Date.now();
  const { session, instances, stream } = sessionFixture({ now: () => time });
  const happy = () => ({ face: { expression: [{ stable: true, timestamp: time * 1000, scores: [{ type: 5, confidence: 90 }] }] } });
  await session.startCamera();
  await session.setAnalysisNeeded(true);
  const failed = instances[0];
  failed.send('metrics', happy());
  assert.equal(session.gameplaySignals().expression.type, 5);
  failed.send('validationStatus', 11, time * 1000, 'Frame rate is low.');
  assert.equal(session.state.phase, 'adjust');
  assert.equal(session.gameplaySignals().expression, null);
  time += 100;
  failed.send('validationStatus', 0, time * 1000, '');
  failed.send('metrics', happy());
  assert.equal(session.gameplaySignals().expression.type, 5);
  assert.equal(instances.length, 1, 'A validation warning clears without a new session');
  failed.send('error', 14, 'Sustained low frame rate', true);
  assert.equal(session.state.errorCode, 14);
  assert.equal(session.state.retryable, true);
  assert.equal(session.gameplaySignals().healthy, false);
  assert.equal(stream.track.readyState, 'live');
  for (let turn = 0; turn < 3; turn++) {
    await session.setAnalysisNeeded(false);
    await session.setAnalysisNeeded(true);
  }
  assert.equal(instances.length, 1, 'New frames and choices must not automatically spend another session');
  await session.startSignals();
  assert.equal(instances.length, 2);
  assert.equal(instances[1].starts, 1);
  assert.equal(session.state.phase, 'measuring');
  assert.equal(session.state.retryable, false);
  assert.equal(session.state.errorCode, null);
  assert.equal(session.gameplaySignals().expression, null, 'A fresh session cannot reuse the failed session\'s expression');
  failed.send('error', 14, '', true);
  failed.send('metrics', happy());
  assert.equal(session.state.phase, 'measuring');
  assert.equal(session.gameplaySignals().expression, null);
  instances[1].send('metrics', happy());
  assert.equal(session.gameplaySignals().expression.type, 5);
  session.stopCamera();
});
