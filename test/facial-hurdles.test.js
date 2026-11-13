import test from 'node:test';
import assert from 'node:assert/strict';
import { FacialHurdles } from '../src/facial-hurdles.js';

const neutral = { type: 6, confidence: 85 };
const happy = { type: 5, confidence: 85 };
function fixture() {
  const hurdles = new FacialHurdles();
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
