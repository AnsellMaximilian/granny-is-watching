import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, decodeMetrics } from '@smartspectra/node-sdk/messages';
import { SignalReadings, spectraError, validationHint } from '../src/smart-spectra-readings.js';
import { SpectraSession } from '../src/smart-spectra-session.js';
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

function sessionFixture({ getUserMedia, loadSdk, captureTimeoutMs, now } = {}) {
  const stream = fakeStream();
  const instances = [];
  class FakeSdk {
    constructor(options) { this.options = options; this.listeners = new Map(); instances.push(this); }
    on(name, callback) { this.listeners.set(name, callback); }
    useMediaStream(input) { this.stream = input; }
    async start() { this.listeners.get('processingStatus')(3); this.listeners.get('validationStatus')(0, 0, ''); }
    destroy() { this.destroyed = true; }
    send(name, ...args) { this.listeners.get(name)?.(...args); }
  }
  const session = new SpectraSession({
    mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream), enumerateDevices: async () => [] },
    loadSdk: loadSdk ?? (async () => ({ SmartSpectraSDK: FakeSdk, requestedMetrics: [11, 12, 13, 14], decodeMetrics: (value) => value })),
    captureTimeoutMs, now,
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
    assert.equal(session.state.phase, 'preview');
    assert.equal(session.state.stream, stream);
    assert.equal(instances.length, 0);
    assert.match(session.state.hint, desktop ? /npm ci/ : /npm start/);
    session.stopCamera();
  }
});

test('disconnects release the native session and late callbacks cannot revive it', async () => {
  const { session, stream, instances } = sessionFixture();
  await session.startCamera();
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

test('stopping while the renderer module loads prevents a late SDK instance from starting', async () => {
  const loading = deferred();
  const { session, stream, instances, FakeSdk } = sessionFixture({ loadSdk: () => loading.promise });
  const starting = session.startCamera();
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
  assert.equal(session.state.phase, 'signal-error');
  assert.ok(session.state.stream);
  assert.equal(instances.length, 0);
  session.stopCamera();
});
