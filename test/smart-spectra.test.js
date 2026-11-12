import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, decodeMetrics } from '@smartspectra/node-sdk/messages';
import { SignalReadings, spectraError, validationHint } from '../src/smart-spectra-readings.js';
import { SpectraSession } from '../src/smart-spectra-session.js';

function readingsFixture() {
  let time = Date.UTC(2026, 10, 13);
  const model = new SignalReadings(() => time);
  model.start();
  return {
    model,
    advance: (ms) => { time += ms; },
    sample: (fields = {}) => ({ value: 72, confidence: 85, stable: true, timestamp: time * 1000, ...fields }),
    get: (id, options) => model.snapshot(options).find((reading) => reading.id === id),
  };
}

test('SDK protobuf decoding preserves real rates, HRV, false detections and expression scores', () => {
  const { model, advance, sample, get } = readingsFixture();
  advance(61000);
  const payload = Metrics.fromObject({
    cardio: { pulseRate: [sample()], hrv: [sample({ rmssd: 34.6 })] },
    breathing: { rate: [sample({ value: 16.4 })] },
    face: {
      blinking: [sample({ detected: false })], talking: [sample({ detected: true })],
      expression: [sample({ scores: [{ type: 4, confidence: 17 }, { type: 6, confidence: 83 }] })],
    },
    eda: { trace: [sample({ value: 0 })] },
  });
  model.ingest(decodeMetrics(Metrics.encode(payload).finish()));
  assert.equal(get('pulse').value, '72 bpm');
  assert.equal(get('breathing').value, '16 br/min');
  assert.equal(get('hrv').value, '35 ms');
  assert.equal(get('blinking').value, 'No');
  assert.equal(get('talking').value, 'Detected');
  assert.equal(get('expression').value, 'Neutral');
  assert.equal(get('eda').value, '0');
  assert.equal(get('expression').detail, '83% confidence');
});

test('rates warm up and invalid, unstable, low-confidence and omitted values never become readings', () => {
  const { model, advance, sample, get } = readingsFixture();
  model.ingest({ cardio: { pulseRate: [sample()] } });
  assert.equal(get('pulse').value, '—');
  assert.match(get('pulse').detail, /Warming up/);
  advance(13000);
  model.ingest({ cardio: { pulseRate: [sample({ stable: false })] } });
  assert.equal(get('pulse').detail, 'Acquiring signal');
  advance(1);
  model.ingest({ cardio: { pulseRate: [sample({ confidence: 39 })] } });
  assert.match(get('pulse').detail, /Low confidence/);
  advance(1);
  model.ingest({ cardio: { pulseRate: [sample({ value: 0 })] } });
  assert.equal(get('pulse').value, '—');
  advance(50000);
  model.ingest({ cardio: { pulseRate: [sample({ value: NaN })] } });
  assert.equal(get('pulse').value, '—');
  assert.equal(get('breathing').detail, 'Not available');
  assert.equal(get('hrv').value, '—');
});

test('partial packets, repeated timestamps and out-of-order samples cannot keep a stale value alive', () => {
  const { model, advance, sample, get } = readingsFixture();
  advance(61000);
  const current = sample();
  model.ingest({ cardio: { pulseRate: [current] } });
  advance(1000);
  model.ingest({ face: { talking: [sample({ detected: false })] } });
  assert.equal(get('pulse').value, '72 bpm');
  model.ingest({ cardio: { pulseRate: [sample({ value: 90, timestamp: current.timestamp - 1 })] } });
  assert.equal(get('pulse').value, '72 bpm');
  advance(4100);
  model.ingest({ cardio: { pulseRate: [current] } });
  assert.equal(get('pulse').quality, 'stale');
  assert.equal(get('pulse').value, '—');
  model.ingest({ cardio: { pulseRate: [sample({ value: 81 })] } });
  assert.equal(get('pulse').value, '81 bpm');
  assert.equal(get('pulse', { validationCode: 1 }).value, '—');
  assert.equal(get('pulse', { active: false }).value, '—');
});

test('missing timestamps, future timestamps and old samples are not presented as current signals', () => {
  const { model, advance, sample, get } = readingsFixture();
  advance(61000);
  model.ingest({ cardio: { pulseRate: [sample({ timestamp: undefined })] } });
  assert.equal(get('pulse').value, '—');
  model.ingest({ cardio: { pulseRate: [sample({ timestamp: sample().timestamp + 10_000_000 })] } });
  assert.equal(get('pulse').value, '—');
  model.ingest({ cardio: { pulseRate: [sample({ timestamp: sample().timestamp - 10_000_000 })] } });
  assert.equal(get('pulse').quality, 'stale');
});

test('chest framing feedback gates breathing while other reliable signals can remain visible', () => {
  const { model, advance, sample, get } = readingsFixture();
  advance(61000);
  model.ingest({ cardio: { pulseRate: [sample()] }, breathing: { rate: [sample({ value: 17 })] } });
  assert.equal(get('pulse', { validationCode: 7 }).value, '72 bpm');
  assert.equal(get('breathing', { validationCode: 7 }).detail, 'Adjust camera');
  assert.equal(get('pulse', { validationCode: 99 }).value, '—');
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
    loadSdk: loadSdk ?? (async () => ({ SmartSpectraSDK: FakeSdk, requestedMetrics: [2, 15], decodeMetrics: (value) => value })),
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
  loading.resolve({ SmartSpectraSDK: FakeSdk, requestedMetrics: [2], decodeMetrics: (value) => value });
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
      requestedMetrics: [2], decodeMetrics,
    }),
  });
  await session.startCamera();
  assert.equal(session.state.phase, 'signal-error');
  assert.ok(session.state.stream);
  assert.equal(instances.length, 0);
  session.stopCamera();
});
