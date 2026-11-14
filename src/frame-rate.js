// Count actual frames, not animation frames or the camera's nominal FPS mode.
// Cumulative counters also account for frames presented between callbacks.
export class FrameRate {
  constructor({ now = () => performance.now(), windowMs = 2000, settleMs = 750, staleMs = 1500 } = {}) {
    this.now = now;
    this.windowMs = windowMs;
    this.settleMs = settleMs;
    this.staleMs = staleMs;
    this.reset();
  }

  reset() { this.samples = []; }

  record(count, time = this.now()) {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(time)) return;
    let last = this.samples.at(-1);
    if (last && (count < last.count || time < last.time)) {
      this.reset();
      last = null;
    }
    if (last && count === last.count) return; // A frozen frame is not fresh video.
    if (last && time === last.time) last.count = count;
    else this.samples.push({ count, time });
    while (this.samples.length > 2 && this.samples[1].time <= time - this.windowMs) this.samples.shift();
  }

  read(time = this.now()) {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!last || !Number.isFinite(time) || time < last.time) return null;
    if (time - last.time >= this.staleMs) return 0;
    const elapsed = time - first.time;
    if (this.samples.length < 2 || elapsed < this.settleMs) return null;
    return (last.count - first.count) * 1000 / elapsed;
  }
}

export function watchPreviewFrames(video, meter) {
  let callback = null;
  let active = false;
  let generation = 0;
  const schedule = token => {
    callback = video.requestVideoFrameCallback((time, metadata) => {
      if (!active || token !== generation) return;
      meter.record(metadata.presentedFrames, time);
      schedule(token);
    });
  };
  const restart = () => {
    generation++;
    meter.reset();
    if (callback !== null) video.cancelVideoFrameCallback?.(callback);
    callback = null;
    if (active && video.requestVideoFrameCallback) schedule(generation);
  };
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      restart();
    },
    poll() {
      if (!active || video.requestVideoFrameCallback) return;
      // Older browsers: use playback counters, excluding frames dropped before
      // display. Never substitute getSettings().frameRate for measured FPS.
      const quality = video.getVideoPlaybackQuality?.();
      if (quality) meter.record(Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames));
    },
    reset: restart,
  };
}
