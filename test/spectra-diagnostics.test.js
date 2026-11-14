import test from 'node:test';
import assert from 'node:assert/strict';
import { SpectraDiagnostics } from '../src/spectra-diagnostics.js';

function fixture(write) {
  const records = [];
  let time = 0;
  const diagnostics = new SpectraDiagnostics({ write: write ?? (record => records.push(record)),
    now: () => 1_800_000_000_000 + time, monotonicNow: () => time });
  return { diagnostics, records, setTime(value) { time = value; } };
}

test('diagnostics distinguish frame timestamp cadence from slower callback delivery', () => {
  const { diagnostics, records, setTime } = fixture();
  diagnostics.beginSession();
  for (let frame = 0; frame < 30; frame++) {
    setTime(frame * 2000 / 30);
    diagnostics.frame(true, 1_800_000_000_000_000 + frame * 33_333);
  }
  diagnostics.metrics({ face: { expression: [{ stable: true, scores: [{ type: 5, confidence: 99 }] }], landmarks: [{ stable: false, value: ['private coordinates'] }] } });
  setTime(2000);
  diagnostics.poll({ previewFps: 29.9 });
  const sample = records.find(record => record.event === 'timing_sample');
  assert.equal(sample.callbackFps, 15);
  assert.equal(sample.timestampFps, 30);
  assert.equal(sample.sourceGapMaxMs, 33.333);
  assert.equal(sample.arrivalGapMaxMs, 66.667);
  assert.equal(sample.timestampGapsOver40Ms, 0);
  assert.equal(sample.stableExpressions, 1);
  assert.equal(sample.stableLandmarks, 0);
  assert.equal(records.filter(record => record.event === 'timing_sample').length, 1);
  assert.ok(!JSON.stringify(records).includes('confidence'));
  assert.ok(!JSON.stringify(records).includes('private coordinates'));
});

test('gaps, duplicate timestamps and stopped delivery stay visible in one-second summaries', () => {
  const { diagnostics, records, setTime } = fixture();
  diagnostics.beginSession();
  diagnostics.frame(true, 1_000_000);
  setTime(100); diagnostics.frame(false, 1_100_000);
  setTime(120); diagnostics.frame(false, 1_100_000);
  setTime(140); diagnostics.frame(false, 1_050_000);
  setTime(1000); diagnostics.poll();
  setTime(2000); diagnostics.poll();
  const [sample, stalled] = records.filter(record => record.event === 'timing_sample');
  assert.equal(sample.timestampFps, 10);
  assert.equal(sample.timestampGapsOver40Ms, 1);
  assert.equal(sample.sourceGapMaxMs, 100);
  assert.equal(sample.duplicateTimestamps, 1);
  assert.equal(sample.outOfOrderTimestamps, 1);
  assert.equal(sample.framesSentTrue, 1);
  assert.equal(sample.framesSentFalse, 3);
  assert.equal(stalled.callbackFps, 0);
  assert.equal(stalled.timestampFps, null);
});

test('encounter transitions and an error retain the elapsed analysis time before cleanup', () => {
  const { diagnostics, records, setTime } = fixture();
  diagnostics.gameFrame({ gamePhase: 'game', encounter: null, focused: true, documentHidden: false, settingsOpen: false, gameFps: 60, renderFrameMs: 16.7 });
  setTime(1000); diagnostics.beginSession();
  setTime(3000); diagnostics.gameFrame({ gamePhase: 'facial-happy', encounter: 'happy', focused: true, documentHidden: false, settingsOpen: false, gameFps: 20, renderFrameMs: 100 });
  setTime(6000); diagnostics.event('sdk_error', { code: 14, retryable: true });
  diagnostics.endSession('sdk_error');
  const error = records.find(record => record.event === 'sdk_error');
  assert.equal(error.sessionElapsedMs, 5000);
  assert.equal(error.gamePhase, 'facial-happy');
  assert.equal(error.encounter, 'happy');
  assert.equal(error.retryable, true);
  assert.equal(records.find(record => record.event === 'session_end').sessionElapsedMs, 5000);
  assert.equal(diagnostics.active, false);
  setTime(7000); diagnostics.beginSession();
  diagnostics.frame(true, 100);
  setTime(8000); diagnostics.poll();
  assert.equal(records.at(-1).sessionId, 2);
  assert.equal(records.at(-1).outOfOrderTimestamps, 0);
});

test('missing diagnostics and a failed log bridge cannot interrupt analysis', () => {
  for (const write of [undefined, () => { throw new Error('disk unavailable'); }]) {
    const { diagnostics, setTime } = fixture(write === undefined ? null : write);
    assert.doesNotThrow(() => {
      diagnostics.beginSession(); diagnostics.frame(true, 100); diagnostics.metrics(null);
      setTime(1000); diagnostics.poll(); diagnostics.event('sdk_error', { code: 14 }); diagnostics.endSession('sdk_error');
    });
  }
});
