import test from 'node:test';
import assert from 'node:assert/strict';
import { FacialHurdles } from '../src/facial-hurdles.js';

const neutral = { type: 6, confidence: 85 };
const happy = { type: 5, confidence: 85 };
function fixture() {
  const hurdles = new FacialHurdles({ random: () => 1 });
  hurdles.setEnabled(true);
  const advance = (ms, options = {}) => {
    const events = [];
    for (let remaining = ms; remaining > 0; remaining -= 100) {
      const event = hurdles.step(Math.min(100, remaining), { choosing: true, expression: neutral, ...options });
      if (event) events.push(event);
    }
    return events;
  };
  return { hurdles, advance };
}

test('happy hurdle waits for five seconds of choosing and ignores disabled, busy and unfocused time', () => {
  const { hurdles, advance } = fixture();
  advance(10000, { choosing: false });
  advance(10000, { focused: false });
  advance(4900);
  assert.equal(hurdles.active, null);
  assert.deepEqual(advance(100), ['happy-start']);
  hurdles.setEnabled(false);
  assert.deepEqual(advance(15000), []);
  assert.equal(hurdles.active, null);
});

test('neutral reactions have a grace period, build pressure gradually, and eventually fail once', () => {
  const { hurdles, advance } = fixture();
  advance(5000);
  advance(1500);
  assert.equal(hurdles.pressure, 0);
  advance(2700);
  assert.equal(hurdles.stage, 1);
  assert.ok(hurdles.pressure > 0 && hurdles.pressure < 1);
  advance(2700);
  assert.equal(hurdles.stage, 2);
  assert.deepEqual(advance(2600), ['happy-fail']);
  assert.equal(hurdles.pressure, 1);
  assert.deepEqual(advance(5000), []);
});

test('a sustained happy face relieves pressure and returns to the same choice without retriggering', () => {
  const { hurdles, advance } = fixture();
  advance(5000);
  advance(4000);
  const before = hurdles.pressure;
  advance(500, { expression: happy });
  assert.ok(hurdles.pressure < before);
  advance(100); // A short classifier flicker does not erase the smile hold.
  assert.deepEqual(advance(500, { expression: happy }), ['happy-pass']);
  assert.equal(hurdles.resolved, true);
  assert.deepEqual(advance(15000), []);
  hurdles.resetChoice();
  assert.deepEqual(advance(5000), ['happy-start']);
});

test('missing, uncertain and paused tracking cannot increase anger or complete a smile', () => {
  const { hurdles, advance } = fixture();
  advance(5000);
  advance(3000);
  const anger = hurdles.pressure;
  advance(20000, { expression: null });
  advance(20000, { expression: { type: 5, confidence: 10 } });
  advance(20000, { expression: { type: 0, confidence: 90 } });
  advance(20000, { expression: happy, focused: false });
  assert.equal(hurdles.pressure, anger);
  assert.equal(hurdles.happyMs, 0);
  assert.equal(hurdles.active, 'happy');
});

test('large frame gaps do not charge a backgrounded player for elapsed wall time', () => {
  const { hurdles } = fixture();
  hurdles.step(60000, { choosing: true, expression: neutral });
  assert.equal(hurdles.choiceMs, 100);
  assert.equal(hurdles.active, null);
});

test('upside-down encounter keeps waiting while away and suspends the smile timer', () => {
  const { hurdles, advance } = fixture();
  assert.equal(hurdles.activateAway(false), false);
  assert.equal(hurdles.activateAway(true), true);
  assert.equal(hurdles.activateAway(true), false);
  assert.deepEqual(advance(20000, { facing: false }), []);
  assert.equal(hurdles.active, 'away');
  assert.equal(hurdles.pressure, 0);
  hurdles.resetChoice();
  assert.equal(hurdles.active, null);
  assert.deepEqual(advance(5000), ['happy-start']);
});

test('random visits are rolled once per eligible choice and wait for their randomized delay', () => {
  const values = [0.1, 0.5, 0.9];
  let calls = 0;
  const hurdles = new FacialHurdles({ random: () => values[calls++] });
  hurdles.setEnabled(true);
  for (let i = 0; i < 100; i++) hurdles.step(100, { choosing: false, facing: true, expression: neutral });
  for (let i = 0; i < 100; i++) hurdles.step(100, { choosing: true, facing: true, expression: neutral, focused: false });
  assert.equal(calls, 0);
  for (let i = 0; i < 24; i++) assert.equal(hurdles.step(100, { choosing: true, facing: true, expression: neutral }), null);
  assert.equal(calls, 2);
  assert.equal(hurdles.step(100, { choosing: true, facing: true, expression: neutral }), 'away-start');
  assert.equal(hurdles.active, 'away');
  hurdles.resetChoice();
  for (let i = 0; i < 40; i++) assert.equal(hurdles.step(100, { choosing: true, facing: true, expression: neutral }), null);
  assert.equal(calls, 3, 'A skipped visit is not rolled again every frame');
  assert.equal(hurdles.active, null);
});

test('away visits schedule with the SDK off, but wait for fresh direction before appearing', () => {
  let calls = 0;
  const hurdles = new FacialHurdles({ random: () => { calls++; return 0; } });
  hurdles.setEnabled(true);
  for (let i = 0; i < 100; i++) hurdles.step(100, { choosing: true, facing: null, expression: null });
  assert.equal(calls, 2);
  assert.equal(hurdles.needsSignals, true);
  assert.equal(hurdles.active, null);
  assert.equal(hurdles.pressure, 0);
  assert.equal(hurdles.step(100, { choosing: true, facing: false }), 'away-start');
  assert.equal(calls, 2);
});

test('smile preparation starts after two seconds without data and never punishes SDK startup', () => {
  const { hurdles, advance } = fixture();
  advance(1900, { expression: null });
  assert.equal(hurdles.needsSignals, false);
  advance(100, { expression: null });
  assert.equal(hurdles.needsSignals, true);
  advance(10000, { expression: null });
  assert.equal(hurdles.active, null);
  assert.equal(hurdles.pressure, 0);
  assert.deepEqual(advance(100), ['happy-start']);
  assert.equal(hurdles.pressure, 0);
  assert.deepEqual(advance(900, { expression: happy }), ['happy-pass']);
  assert.equal(hurdles.needsSignals, false);
  hurdles.resetChoice();
  assert.equal(hurdles.needsSignals, false, 'Choosing cancels pending preparation');
});

test('looking toward upside-down Granny has grace and tolerance before a single theft per appearance', () => {
  const { hurdles, advance } = fixture();
  hurdles.activateAway(true);
  advance(1500, { facing: true });
  assert.equal(hurdles.pressure, 0);
  advance(1500, { facing: true });
  const pressure = hurdles.pressure;
  advance(30000, { facing: null });
  advance(30000, { facing: true, focused: false });
  assert.equal(hurdles.pressure, pressure);
  advance(500, { facing: false });
  assert.ok(hurdles.pressure < pressure);
  assert.deepEqual(advance(5500, { facing: true }), ['away-penalty']);
  assert.equal(hurdles.active, 'away', 'She stays after the penalty until a pit is chosen');
  assert.equal(hurdles.awayPenalized, true);
  assert.equal(hurdles.needsSignals, false, 'No more analysis is needed after the single theft');
  assert.deepEqual(advance(20000, { facing: true }), []);
});
