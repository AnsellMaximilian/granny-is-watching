const WOOD_SOUNDS = [
  'impactWood_light_000.ogg',
  'impactWood_light_001.ogg',
  'impactWood_light_003.ogg',
  'impactWood_light_004.ogg',
];
const EFFECTS = [...WOOD_SOUNDS, 'fire-ignite.ogg', 'scream-loss.wav', 'scream-granny.wav', 'scream-pressure.wav'];
const MUSIC_GAIN = 0.26;
const AUDIO_BASE = import.meta.env.BASE_URL + 'audio/';

function loadBytes(file) {
  // XHR supports the local file URLs used by Electron as well as Vite's HTTP URLs.
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', AUDIO_BASE + file);
    request.responseType = 'arraybuffer';
    request.timeout = 15000;
    request.onload = () => {
      if ((request.status === 0 || request.status === 200) && request.response?.byteLength) {
        resolve(request.response);
      } else {
        reject(new Error('Unable to load ' + file));
      }
    };
    request.onerror = request.ontimeout = () => reject(new Error('Unable to load ' + file));
    request.send();
  });
}

export function createGameAudio() {
  const music = new Audio(AUDIO_BASE + 'horror-gamelan.ogg');
  music.loop = true;
  music.preload = 'auto';
  const files = EFFECTS.map((file) => loadBytes(file).catch((error) => {
    console.warn(error.message);
    return null;
  }));
  const buffers = new Map();
  let context;
  let master;
  let background;
  let woodIndex = 0;
  let muted = false;
  let screamsPlaying = 0;
  let threat = null;

  function duckMusic() {
    if (background) background.gain.setTargetAtTime(MUSIC_GAIN * (screamsPlaying ? 0.18 : threat ? 0.55 : 1), context.currentTime, 0.12);
  }

  function stopThreat() {
    if (!threat) return;
    const retiring = threat;
    threat = null;
    retiring.gain.gain.setTargetAtTime(0, context.currentTime, 0.025);
    retiring.source.stop(context.currentTime + 0.12);
    duckMusic();
  }

  function start() {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.82;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      master.connect(limiter).connect(context.destination);
      background = context.createGain();
      background.gain.value = MUSIC_GAIN;
      context.createMediaElementSource(music).connect(background).connect(master);
      for (const [index, promise] of files.entries()) {
        void promise.then(async (bytes) => {
          if (bytes) buffers.set(EFFECTS[index], await context.decodeAudioData(bytes));
        }).catch((error) => console.warn('Unable to decode ' + EFFECTS[index], error));
      }
    }
    void context.resume().catch((error) => console.warn('Unable to resume audio', error));
    void music.play().catch((error) => console.warn('Unable to play background music', error));
  }

  function play(file, volume, pan = 0) {
    const buffer = buffers.get(file);
    if (!context || !buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = volume;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(master);
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    }, { once: true });
    source.start();
    return source;
  }

  return {
    start,
    stopThreat,
    threat(level, lighter = false) {
      if (!context) return;
      const buffer = buffers.get('scream-pressure.wav');
      if (!buffer) return;
      const pressure = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
      if (!threat) {
        const source = context.createBufferSource();
        const gain = context.createGain();
        const filter = context.createBiquadFilter();
        source.buffer = buffer;
        source.loop = true;
        gain.gain.value = 0;
        filter.type = 'lowpass';
        source.connect(filter).connect(gain).connect(master);
        source.addEventListener('ended', () => { source.disconnect(); filter.disconnect(); gain.disconnect(); }, { once: true });
        source.start();
        threat = { source, gain, filter, last: null, lighter: null };
        duckMusic();
      }
      if (threat.last !== null && Math.abs(threat.last - pressure) < 0.01 && threat.lighter === lighter) return;
      threat.last = pressure;
      threat.lighter = lighter;
      threat.gain.gain.setTargetAtTime((0.025 + 0.42 * pressure ** 1.6) * (lighter ? 0.4 : 1), context.currentTime, 0.25);
      threat.filter.frequency.setTargetAtTime(600 + 3600 * pressure, context.currentTime, 0.25);
      threat.source.playbackRate.setTargetAtTime(0.68 + 0.42 * pressure, context.currentTime, 0.25);
    },
    toggleMuted() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.82, context.currentTime, 0.02);
      return muted;
    },
    seedDrop(x) {
      play(WOOD_SOUNDS[woodIndex], 0.55, Math.max(-0.65, Math.min(0.65, x * 0.55)));
      woodIndex = (woodIndex + 1) % WOOD_SOUNDS.length;
    },
    ignite(x = 0) {
      play('fire-ignite.ogg', 0.65, Math.max(-0.4, Math.min(0.4, x * 0.35)));
    },
    scream(granny = false, volume = 0.76) {
      const source = play(granny ? 'scream-granny.wav' : 'scream-loss.wav', Math.max(0, Math.min(0.76, volume)));
      if (!source) return;
      screamsPlaying += 1;
      duckMusic();
      source.addEventListener('ended', () => {
        screamsPlaying -= 1;
        duckMusic();
      }, { once: true });
    },
  };
}
