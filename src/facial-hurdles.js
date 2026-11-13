export const HAPPY_RULES = Object.freeze({ chooseMs: 5000, graceMs: 1500, angerMs: 8000, holdMs: 900 });

// Timing runs only while the game is foregrounded and the current signal is
// reliable. This state stays independent of DOM text, scene poses and scores.
export class FacialHurdles {
  constructor() {
    this.enabled = false;
    this.resetChoice();
  }

  resetChoice() {
    this.choiceMs = 0;
    this.active = null;
    this.resolved = false;
    this.angerMs = 0;
    this.happyMs = 0;
    this.encounterMs = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.resetChoice();
  }

  get pressure() { return Math.min(1, this.angerMs / HAPPY_RULES.angerMs); }
  get stage() { return Math.min(2, Math.floor(this.pressure * 3)); }

  step(deltaMs, { choosing = false, focused = true, expression = null } = {}) {
    if (!this.enabled || !focused || !expression || !Number.isInteger(expression.type)
      || expression.type < 1 || expression.type > 8 || !Number.isFinite(expression.confidence)
      || expression.confidence < 45 || expression.confidence > 100) return null;
    const dt = Math.max(0, Math.min(100, deltaMs));
    if (this.active === null) {
      if (!choosing || this.resolved) return null;
      this.choiceMs += dt;
      if (this.choiceMs < HAPPY_RULES.chooseMs) return null;
      this.active = 'happy';
      return 'happy-start';
    }
    if (this.active !== 'happy') return null;
    this.encounterMs += dt;
    if (expression.type === 5) {
      this.happyMs += dt;
      this.angerMs = Math.max(0, this.angerMs - dt * 2);
      if (this.happyMs >= HAPPY_RULES.holdMs) {
        this.active = null;
        this.resolved = true;
        return 'happy-pass';
      }
    } else {
      // A brief classifier flicker erodes the smile hold instead of resetting it.
      this.happyMs = Math.max(0, this.happyMs - dt * 0.5);
      if (this.encounterMs > HAPPY_RULES.graceMs) this.angerMs += dt;
    }
    if (this.angerMs >= HAPPY_RULES.angerMs) {
      this.active = 'failed';
      return 'happy-fail';
    }
    return null;
  }
}
