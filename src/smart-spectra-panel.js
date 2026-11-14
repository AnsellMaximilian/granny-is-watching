import { SIGNALS } from './smart-spectra-readings.js';
import { SpectraSession } from './smart-spectra-session.js';
import { FrameRate, watchPreviewFrames } from './frame-rate.js';

async function loadSdk() {
  if (typeof MediaStreamTrackProcessor === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw { code: 'PROCESSOR_UNSUPPORTED' };
  }
  const [sdk, messages] = await Promise.all([
    import('@smartspectra/node-sdk/renderer'),
    import('@smartspectra/node-sdk/messages'),
  ]);
  const { MetricType } = sdk;
  return {
    SmartSpectraSDK: sdk.SmartSpectraSDK,
    decodeMetrics: messages.decodeMetrics,
    requestedMetrics: [
      MetricType.FACE_LANDMARKS, MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS,
    ],
  };
}

export function mountSmartSpectra() {
  const $ = (id) => document.getElementById('spectra-' + id);
  const panel = $('panel');
  const video = $('video');
  const toggle = $('toggle');
  const retry = $('retry');
  const settings = $('settings');
  const fields = new Map();
  let promptedForKey = false;
  let encounter = null;
  let gameplayNeeded = false;
  let testUntil = 0;
  const previewRate = new FrameRate();
  const previewFrames = watchPreviewFrames(video, previewRate);
  let rateUpdatedAt = -Infinity;

  for (const signal of SIGNALS) {
    const container = document.createElement('div');
    container.className = 'spectra-signal';
    const label = document.createElement('dt');
    label.textContent = signal.label;
    const reading = document.createElement('dd');
    const value = document.createElement('span');
    const detail = document.createElement('small');
    reading.append(value, detail);
    container.append(label, reading);
    reading.id = 'spectra-reading-' + signal.id;
    $('primary').append(container);
    fields.set(signal.id, { reading, value, detail });
  }

  const session = new SpectraSession({ mediaDevices: navigator.mediaDevices, loadSdk, onChange: render });
  function render() {
    const state = session.state;
    const { phase, stream } = state;
    let hint = state.hint;
    panel.dataset.state = phase;
    panel.dataset.sdk = state.sdkStatus;
    if (video.srcObject !== stream) {
      previewFrames.reset();
      video.srcObject = stream;
      if (stream) video.play().catch(() => {});
    }
    $('preview').hidden = !stream;
    $('performance').hidden = !stream;
    $('readings').hidden = !stream || !['starting', 'measuring', 'adjust'].includes(phase);
    let status = {
      off: 'Camera off', opening: 'Opening camera…', preview: 'Live preview',
      starting: 'Starting face tracking…', measuring: 'Face tracking on', adjust: 'Adjust camera',
      stopping: 'Stopping face tracking…',
      'camera-error': 'Camera unavailable', 'signal-error': 'Face tracking unavailable',
    }[phase];
    if (encounter === 'away' && ['measuring', 'adjust'].includes(phase)) {
      status = state.validationCode === 1 ? 'Face out of view' : status;
      hint = 'Look away from the camera while choosing a pit. Granny leaves after your choice.';
    }
    // Do not replace aria-live text on every metrics tick or repeat SDK hints.
    if ($('status').textContent !== status) $('status').textContent = status;
    if ($('hint').textContent !== hint) $('hint').textContent = hint;
    $('hint').hidden = !hint;
    const sdkLabel = {
      idle: 'Tracking off', starting: 'Starting…', running: 'Tracking on',
      stopping: 'Stopping…', error: 'Unavailable',
    }[state.sdkStatus];
    if ($('sdk-status').textContent !== sdkLabel) $('sdk-status').textContent = sdkLabel;
    const cameraStatus = document.getElementById('camera-settings-status');
    if (cameraStatus.textContent !== hint) cameraStatus.textContent = hint;
    cameraStatus.hidden = !hint;
    toggle.textContent = phase === 'opening' ? 'Cancel' : stream ? 'Stop camera' : 'Enable camera';
    toggle.disabled = false;
    retry.hidden = !stream || !state.nativeAvailable || !state.hasKey;
    retry.textContent = testUntil > Date.now() ? 'Stop test'
      : phase === 'signal-error' ? 'Retry tracking · 15s' : 'Test tracking · 15s';
    settings.hidden = !state.nativeAvailable;
    if (state.needsKey && stream && !promptedForKey) {
      settings.open = true;
      promptedForKey = true;
    }
    const track = stream?.getVideoTracks()[0];
    $('camera-name').textContent = track?.label || 'Live camera';
    $('camera-picker').hidden = !stream || state.devices.length < 2;
    const ids = state.devices.map((device) => device.deviceId).join('|');
    if ($('camera').dataset.ids !== ids) {
      $('camera').replaceChildren(...state.devices.map((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || 'Camera ' + (index + 1);
        return option;
      }));
      $('camera').dataset.ids = ids;
    }
    const selected = track?.getSettings().deviceId;
    if (selected) $('camera').value = selected;
    renderFrameRates(true);
    renderReadings();
  }

  function renderFrameRates(force = false) {
    const { stream, phase, sdkStatus, lastTrackingFps } = session.state;
    const visible = Boolean(stream && !panel.hidden && !$('body').hidden && !document.hidden);
    previewFrames.setActive(visible);
    previewFrames.poll();
    const now = performance.now();
    if (!force && now - rateUpdatedAt < 500) return;
    rateUpdatedAt = now;
    const fps = visible ? previewRate.read(now) : null;
    const format = value => value === null ? '— FPS' : value.toFixed(1) + ' FPS';
    const quality = value => value === null ? 'waiting' : Number(value.toFixed(1)) < 25 ? 'low' : 'live';
    $('fps').textContent = format(fps);
    $('fps').dataset.quality = quality(fps);
    $('preview-rate').textContent = visible ? format(fps) : 'Hidden';
    $('preview-rate').dataset.quality = quality(fps);
    const settings = stream?.getVideoTracks()[0]?.getSettings() ?? {};
    const size = settings.width && settings.height ? settings.width + ' × ' + settings.height : '';
    const nominal = Number.isFinite(settings.frameRate) ? settings.frameRate.toFixed(1) + ' FPS' : '';
    $('mode').textContent = [size, nominal].filter(Boolean).join(' · ') || 'Not reported';
    const active = ['starting', 'running'].includes(sdkStatus);
    const trackingFps = active ? session.frameRate.read() : lastTrackingFps;
    $('tracking-rate').textContent = active ? format(trackingFps)
      : trackingFps !== null ? 'Last: ' + format(trackingFps) : phase === 'signal-error' ? 'Unavailable' : 'Off';
    $('tracking-rate').dataset.quality = quality(trackingFps);
    $('fps').title = 'Measured preview frame rate. Tracking feed: ' + $('tracking-rate').textContent;
  }

  function renderReadings() {
    session.poll();
    const { phase, validationCode, validationAt } = session.state;
    const active = ['starting', 'measuring', 'adjust'].includes(phase);
    for (const sample of session.readings.snapshot({ active, validationCode, validationAt })) {
      const field = fields.get(sample.id);
      field.value.textContent = sample.value;
      field.detail.textContent = active ? sample.detail : '';
      field.detail.hidden = !field.detail.textContent;
      field.reading.dataset.quality = sample.quality;
    }
  }

  function updateAnalysis() {
    if (testUntil && (Date.now() >= testUntil || !session.state.stream)) {
      testUntil = 0;
      render();
    }
    const focused = !document.hidden && document.hasFocus();
    void session.setAnalysisNeeded(focused && (gameplayNeeded || testUntil > Date.now()));
  }

  toggle.addEventListener('click', () => {
    if (session.state.stream || session.state.phase === 'opening') {
      testUntil = 0;
      session.stopCamera();
    }
    else void session.startCamera($('camera').value);
  });
  retry.addEventListener('click', () => {
    if (testUntil > Date.now()) {
      testUntil = 0;
      updateAnalysis();
    } else {
      testUntil = Date.now() + 15000;
      void session.startSignals();
    }
    render();
  });
  $('camera').addEventListener('change', () => {
    const id = $('camera').value;
    session.stopCamera();
    void session.startCamera(id);
  });
  $('key-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const key = $('key').value;
    $('key').value = '';
    if (!key.trim()) return;
    settings.open = false;
    promptedForKey = false;
    void session.setKey(key);
  });
  $('collapse').addEventListener('click', () => {
    const hidden = !$('body').hidden;
    $('body').hidden = hidden;
    $('collapse').textContent = hidden ? '+' : '−';
    $('collapse').setAttribute('aria-expanded', String(!hidden));
    $('collapse').setAttribute('aria-label', hidden ? 'Expand camera panel' : 'Collapse camera panel');
    panel.classList.toggle('collapsed', hidden);
  });
  const deviceChange = () => void session.refreshDevices();
  navigator.mediaDevices?.addEventListener('devicechange', deviceChange);
  const timer = setInterval(() => { updateAnalysis(); renderReadings(); renderFrameRates(); }, 100);
  const focusChange = () => updateAnalysis();
  document.addEventListener('visibilitychange', focusChange);
  window.addEventListener('blur', focusChange);
  window.addEventListener('focus', focusChange);
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    previewFrames.setActive(false);
    navigator.mediaDevices?.removeEventListener('devicechange', deviceChange);
    document.removeEventListener('visibilitychange', focusChange);
    window.removeEventListener('blur', focusChange);
    window.removeEventListener('focus', focusChange);
    session.stopCamera();
  }, { once: true });

  // Ordinary browser development remains playable, with preview-only support.
  let ready;
  if (window.grannySpectra?.getConfig) {
    ready = window.grannySpectra.getConfig()
      .then((config) => session.configure({ ...config, desktop: true }))
      .catch(() => session.configure({ desktop: true, nativeAvailable: false }));
  } else {
    session.configure({ desktop: false, nativeAvailable: false });
    ready = Promise.resolve();
  }
  return {
    gameplaySignals: () => session.gameplaySignals(),
    setAnalysisNeeded(needed) { gameplayNeeded = needed; updateAnalysis(); },
    setEncounter(value) { encounter = value; render(); },
    setPreviewVisible(visible) { panel.hidden = !visible; },
    async ensureCamera() {
      await ready;
      if (!session.state.stream) await session.startCamera($('camera').value);
    },
  };
}
