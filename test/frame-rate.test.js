import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameRate, watchPreviewFrames } from '../src/frame-rate.js';

test('frame rate waits for enough video and distinguishes sustained 30 FPS from a 15 FPS camera', () => {
  for (const fps of [30, 15]) {
    let time = 0;
    const rate = new FrameRate({ now: () => time });
    assert.equal(rate.read(), null);
    for (let frame = 0; frame <= fps * 3; frame++) {
      time = frame * 1000 / fps;
      rate.record(frame);
      if (time < 750) assert.equal(rate.read(), null);
    }
    assert.ok(Math.abs(rate.read() - fps) < 0.01);
    assert.ok(rate.samples.length <= fps * 2 + 2);
  }
});

test('cumulative presentation counts include frames missed by a delayed JavaScript callback', () => {
  const rate = new FrameRate();
  rate.record(1, 100);
  rate.record(16, 600);
  rate.record(31, 1100);
  assert.equal(rate.read(1100), 30);
});

test('a frozen video becomes zero FPS rather than being kept alive by polling the same count', () => {
  const rate = new FrameRate();
  rate.record(0, 0);
  rate.record(30, 1000);
  rate.record(30, 2000);
  assert.equal(rate.read(2500), 0);
  rate.reset();
  assert.equal(rate.read(2600), null);
});

test('new streams, invalid samples and clock resets cannot inherit a stale measurement', () => {
  const rate = new FrameRate();
  rate.record(0, 0);
  rate.record(30, 1000);
  rate.record(NaN, 1200);
  rate.record(-1, 1200);
  rate.record(40, NaN);
  assert.equal(rate.read(1000), 30);
  rate.record(1, 1100); // A replacement video's counter restarts.
  assert.equal(rate.read(1100), null);
  rate.record(31, 2100);
  assert.equal(rate.read(2100), 30);
  rate.record(32, 100); // A clock adjustment starts a fresh measurement.
  assert.equal(rate.read(100), null);
});

test('preview monitoring stops while hidden and ignores queued callbacks from a stopped observer', () => {
  const callbacks = new Map();
  let id = 0;
  const video = {
    requestVideoFrameCallback: callback => { callbacks.set(++id, callback); return id; },
    cancelVideoFrameCallback: callbackId => callbacks.delete(callbackId),
  };
  const rate = new FrameRate();
  const monitor = watchPreviewFrames(video, rate);
  monitor.setActive(true);
  const queued = callbacks.get(id);
  queued(100, { presentedFrames: 1 });
  callbacks.get(id)(1100, { presentedFrames: 31 });
  assert.equal(rate.read(1100), 30);
  monitor.setActive(false);
  queued(1200, { presentedFrames: 32 });
  assert.equal(rate.read(1200), null);
  monitor.setActive(true);
  const resumed = id;
  queued(1300, { presentedFrames: 34 });
  assert.equal(id, resumed, 'A cancelled callback cannot create a second observer after resuming');
  assert.equal(rate.read(1300), null);
});

test('preview fallback excludes dropped frames and does not sample an invisible preview', () => {
  let time = 0;
  const quality = { totalVideoFrames: 0, droppedVideoFrames: 0 };
  const rate = new FrameRate({ now: () => time });
  const monitor = watchPreviewFrames({ getVideoPlaybackQuality: () => quality }, rate);
  monitor.setActive(true);
  monitor.poll();
  time = 1000;
  quality.totalVideoFrames = 30;
  quality.droppedVideoFrames = 10;
  monitor.poll();
  assert.equal(rate.read(), 20);
  monitor.setActive(false);
  monitor.poll();
  assert.equal(rate.read(), null);
});
