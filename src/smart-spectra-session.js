import { SignalReadings, spectraError, validationHint } from './smart-spectra-readings.js';
import { FrameRate } from './frame-rate.js';

export class SpectraSession {
  #sdk = null;
  #key = '';
  #cameraGeneration = 0;
  #signalGeneration = 0;
  #failSignals = null;
  #lastFeedbackAt = 0;
  #stoppedAt = null;
  #analysisNeeded = false;
  #signalBlocked = false;
  #sdkStarted = false;
  #sdkStarting = false;
  #stopRequested = false;
  #signalTask = Promise.resolve();
  #frameCount = 0;
  #frameTimestamp = 0;
  #diagnosticValidationCode = null;

  constructor({ mediaDevices, loadSdk, onChange = () => {}, now = Date.now, captureTimeoutMs = 30000, diagnostics = null }) {
    this.mediaDevices = mediaDevices;
    this.loadSdk = loadSdk;
    this.onChange = onChange;
    this.captureTimeoutMs = captureTimeoutMs;
    this.now = now;
    this.diagnostics = diagnostics;
    this.readings = new SignalReadings(now);
    this.frameRate = new FrameRate({ now });
    this.state = {
      phase: 'off', sdkStatus: 'idle', stream: null, validationCode: null, validationAt: null, devices: [], lastTrackingFps: null,
      errorCode: null, retryable: false,
      nativeAvailable: false, desktop: false, packaged: false, hasKey: false, needsKey: false,
      hint: 'Enable your camera for a live preview.',
    };
  }

  configure(config) {
    this.#key = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    Object.assign(this.state, {
      desktop: config.desktop,
      packaged: Boolean(config.packaged),
      nativeAvailable: config.nativeAvailable,
      hasKey: Boolean(this.#key),
      needsKey: !this.#key,
    });
    if (config.environmentError) this.state.hint = 'Your API key could not be loaded. Enter it in Settings.';
    this.emit();
  }

  emit() {
    this.diagnostics?.poll({
      phase: this.state.phase, sdkStatus: this.state.sdkStatus, validationCode: this.state.validationCode,
      analysisNeeded: this.#analysisNeeded, signalBlocked: this.#signalBlocked,
    });
    this.onChange(this.state);
  }

  gameplaySignals() {
    const active = ['measuring', 'adjust'].includes(this.state.phase)
      && this.state.stream?.getVideoTracks()[0]?.readyState === 'live'
      && this.now() - this.#lastFeedbackAt <= 500;
    return {
      healthy: Boolean(active),
      expression: this.readings.gameplayExpression({ active, validationCode: this.state.validationCode }),
      facing: this.readings.gameplayFacing({ active, validationCode: this.state.validationCode, validationAt: this.state.validationAt }),
    };
  }

  #clearSignals(reason = 'signals_cleared') {
    this.diagnostics?.endSession(reason);
    const fps = this.frameRate.read();
    if (fps !== null) this.state.lastTrackingFps = fps;
    this.#signalGeneration++;
    this.#failSignals = null;
    this.#stoppedAt = null;
    this.readings.clear();
    this.state.validationCode = null;
    this.state.validationAt = null;
    this.frameRate.reset();
    this.#frameCount = 0;
    this.#frameTimestamp = 0;
    this.#diagnosticValidationCode = null;
  }

  #disposeSdk(reason = 'sdk_disposed') {
    this.diagnostics?.event('session_disposed', { reason });
    this.#clearSignals(reason);
    const sdk = this.#sdk;
    this.#sdk = null;
    this.#sdkStarted = false;
    this.#sdkStarting = false;
    this.#stopRequested = false;
    try { sdk?.destroy(); } catch { /* Camera cleanup still has to run. */ }
  }

  #previewState() {
    this.state.phase = this.state.stream ? 'preview' : 'off';
    this.state.sdkStatus = 'idle';
    this.state.errorCode = null;
    this.state.retryable = false;
    this.state.hint = !this.state.stream ? 'Enable your camera for a live preview.'
      : !this.state.nativeAvailable ? this.state.desktop
        ? this.state.packaged
          ? 'Face tracking is unavailable. Install the latest Microsoft Visual C++ x64 runtime and restart the game. Reinstall the game if needed.'
          : 'Face tracking is unavailable. Restart the game or reinstall it.'
        : 'Face tracking is available in the desktop game.'
      : !this.#key ? 'Enter your SmartSpectra API key in Settings to enable face tracking.'
      : '';
    this.emit();
  }

  // Serializing clean stop/start keeps one native graph and prevents overlapping
  // sessions when a player chooses a pit or opens Settings during startup.
  #syncSignals() {
    this.#signalTask = this.#signalTask.then(() => this.#updateSignals());
    return this.#signalTask;
  }

  setAnalysisNeeded(needed) {
    needed = Boolean(needed);
    if (needed === this.#analysisNeeded) return this.#signalTask;
    this.#analysisNeeded = needed;
    this.diagnostics?.event('analysis_demand', { analysisNeeded: needed, signalBlocked: this.#signalBlocked });
    if (!needed) {
      this.#clearSignals('analysis_not_needed');
      // A pending start must not turn on the frame pump after its choice ended.
      // Cancel it rather than waiting through the SDK's full startup timeout.
      if (this.#sdkStarting) this.#disposeSdk();
      if (this.#sdkStarted || this.#stopRequested) {
        this.#stopRequested = true;
        Object.assign(this.state, { phase: 'stopping', sdkStatus: 'stopping', hint: '' });
        this.emit();
      } else if (!this.#signalBlocked) this.#previewState();
    }
    return this.#syncSignals();
  }

  stopSignals() { return this.setAnalysisNeeded(false); }

  poll() {
    if (!this.#failSignals) return;
    if (this.#stoppedAt !== null && this.now() - this.#stoppedAt > 1000) {
      this.#failSignals({ code: 'SIGNAL_STOPPED' });
    } else if (this.now() - this.#lastFeedbackAt > 35000) {
      this.#failSignals({ code: 'SIGNAL_STALLED' });
    }
  }

  stopCamera() {
    this.diagnostics?.event('camera_stopped');
    this.#cameraGeneration++;
    this.#analysisNeeded = false;
    this.#signalBlocked = false;
    this.#disposeSdk();
    for (const track of this.state.stream?.getTracks() ?? []) track.stop();
    Object.assign(this.state, {
      phase: 'off', sdkStatus: 'idle', stream: null, lastTrackingFps: null, errorCode: null, retryable: false,
      hint: 'Enable your camera for a live preview.',
    });
    this.emit();
  }

  async refreshDevices() {
    try {
      this.state.devices = (await this.mediaDevices?.enumerateDevices?.() ?? []).filter((device) => device.kind === 'videoinput');
      this.emit();
    } catch { /* Camera preview can still work if enumeration is restricted. */ }
  }

  async startCamera(deviceId = '') {
    if (this.state.stream || this.state.phase === 'opening') return;
    this.diagnostics?.event('camera_open_requested');
    const generation = ++this.#cameraGeneration;
    Object.assign(this.state, { phase: 'opening', hint: 'Opening camera. Allow access if your system asks.' });
    this.emit();
    let timeout;
    try {
      if (!this.mediaDevices?.getUserMedia) throw { code: 'CAPTURE_UNSUPPORTED' };
      const capture = this.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // This small preview does not need HD frames. Reduce renderer → native
          // pixel-copy bandwidth while preserving the 30 fps analysis cadence.
          width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
        },
      });
      // getUserMedia has no abort API. Release a late permission grant after a
      // Cancel, timeout, or replacement request rather than leaking the camera.
      capture.then((stream) => {
        if (generation !== this.#cameraGeneration) for (const track of stream.getTracks()) track.stop();
      }, () => {});
      const stream = await Promise.race([
        capture,
        new Promise((_, reject) => { timeout = setTimeout(() => reject({ code: 'CAMERA_TIMEOUT' }), this.captureTimeoutMs); }),
      ]);
      if (generation !== this.#cameraGeneration) return;
      clearTimeout(timeout);
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        for (const item of stream.getTracks()) item.stop();
        throw { code: 'CAMERA_ENDED' };
      }
      this.state.stream = stream;
      const mode = track.getSettings?.() ?? {};
      this.diagnostics?.event('camera_opened', {
        width: mode.width, height: mode.height, nominalFps: mode.frameRate,
        cameraReadyState: track.readyState, cameraMuted: track.muted, cameraEnabled: track.enabled,
      });
      track.addEventListener('ended', () => {
        if (generation !== this.#cameraGeneration) return;
        this.stopCamera();
        Object.assign(this.state, { phase: 'camera-error', hint: spectraError({ code: 'CAMERA_ENDED' }) });
        this.emit();
      }, { once: true });
      this.#previewState();
      void this.refreshDevices();
      await this.#syncSignals();
    } catch (error) {
      if (generation !== this.#cameraGeneration) return;
      this.diagnostics?.event('camera_error', { code: error?.code, source: 'camera_open' });
      this.stopCamera();
      Object.assign(this.state, { phase: 'camera-error', hint: spectraError(error) });
      this.emit();
    } finally { clearTimeout(timeout); }
  }

  async setKey(key) {
    if (typeof key !== 'string' || !key.trim()) return;
    this.diagnostics?.event('key_replaced');
    this.#key = key.trim().slice(0, 1024);
    this.state.hasKey = true;
    this.state.needsKey = false;
    this.#signalBlocked = false;
    this.#disposeSdk();
    this.#previewState();
    await this.#syncSignals();
  }

  // Explicit retry only. Automatic demand changes never retry a rejected key,
  // exhausted credits or a failed runtime on every turn/frame.
  async startSignals() {
    this.diagnostics?.event('manual_retry');
    this.#signalBlocked = false;
    this.#analysisNeeded = true;
    await this.#syncSignals();
  }

  async #updateSignals() {
    if (!this.#analysisNeeded || !this.state.stream || this.#stopRequested) {
      if (this.#sdkStarted) {
        const sdk = this.#sdk;
        this.diagnostics?.event('session_stop_requested');
        this.#clearSignals();
        this.#sdkStarted = false;
        try { await sdk.stop(); }
        catch {
          if (sdk === this.#sdk) this.#disposeSdk();
        }
        if (sdk !== this.#sdk) return;
        this.diagnostics?.event('session_stopped');
      }
      this.#stopRequested = false;
      if (!this.#signalBlocked) this.#previewState();
      if (!this.#analysisNeeded || !this.state.stream) return;
    }
    if (this.#signalBlocked || this.#sdkStarted) return;
    this.#clearSignals();
    const generation = this.#signalGeneration;
    const current = () => generation === this.#signalGeneration && this.#analysisNeeded;
    if (!this.state.nativeAvailable || !this.#key) {
      this.#previewState();
      return;
    }
    const fail = (error) => {
      if (!current()) return;
      const lastTrackingFps = this.frameRate.read() ?? this.state.lastTrackingFps;
      this.diagnostics?.event('sdk_error', {
        code: error?.code, retryable: error?.retryable, source: error?.diagnosticSource ?? 'app_or_startup',
        phase: this.state.phase, trackingFps: lastTrackingFps,
      });
      this.#signalBlocked = true;
      this.#disposeSdk('sdk_error');
      Object.assign(this.state, {
        phase: 'signal-error', sdkStatus: 'error', hint: spectraError(error), needsKey: error?.code === 2, lastTrackingFps,
        errorCode: error?.code ?? null,
        retryable: error?.retryable === true || ['SIGNAL_STOPPED', 'SIGNAL_STALLED', 'SMARTSPECTRA_IPC_TIMEOUT'].includes(error?.code),
      });
      this.emit();
    };
    this.#failSignals = fail;
    this.#lastFeedbackAt = this.now();
    this.diagnostics?.beginSession();
    Object.assign(this.state, { phase: 'starting', sdkStatus: 'starting', lastTrackingFps: null,
      errorCode: null, retryable: false, hint: 'Face the camera in even light.' });
    this.emit();
    try {
      const { SmartSpectraSDK, requestedMetrics, decodeMetrics } = await this.loadSdk();
      if (!current()) return;
      const sdk = this.#sdk ?? new SmartSpectraSDK({
        apiKey: this.#key, requestedMetrics,
        enableTelemetry: false, enableAccumulatedOutput: false, sendTimeoutMs: 30000,
      });
      this.#sdk = sdk;
      sdk.on('processingStatus', (status) => {
        if (!current()) return;
        this.diagnostics?.event('sdk_status', { processingStatus: status });
        this.#lastFeedbackAt = this.now();
        if (status === 5 || (status === 1 && this.readings.startedAt !== null)) this.#stoppedAt = this.now();
        if (status === 3) {
          this.state.sdkStatus = 'running';
          this.#stoppedAt = null;
          if (this.readings.startedAt === null) this.readings.start();
          this.state.phase = this.state.validationCode === null || this.state.validationCode === 0 ? 'measuring' : 'adjust';
          this.state.hint = validationHint(this.state.validationCode ?? 0);
          this.emit();
        }
      });
      sdk.on('validationStatus', (code, _timestampUs, hint) => {
        if (!current()) return;
        if (code !== this.#diagnosticValidationCode) {
          this.diagnostics?.event('sdk_validation', { validationCode: code, sdkTimestampUs: _timestampUs });
          this.#diagnosticValidationCode = code;
        }
        this.#lastFeedbackAt = this.now();
        this.state.validationAt = this.now();
        this.state.sdkStatus = 'running';
        if (this.readings.startedAt === null) this.readings.start();
        if (code === 1 || code === 2) this.readings.invalidateFace();
        // Chest framing is irrelevant to the requested facial metrics.
        if (code === 7) { code = 0; hint = ''; }
        const phase = code === 0 ? 'measuring' : 'adjust';
        const guidance = validationHint(code, hint).split(this.#key).join('[key]');
        if (phase !== this.state.phase || code !== this.state.validationCode || guidance !== this.state.hint) {
          Object.assign(this.state, { phase, validationCode: code, hint: guidance });
          this.emit();
        }
      });
      sdk.on('metrics', (buffer) => {
        if (!current()) return;
        this.#lastFeedbackAt = this.now();
        try {
          const metrics = decodeMetrics(buffer);
          this.readings.ingest(metrics);
          this.diagnostics?.metrics(metrics);
        }
        catch { fail({ code: 8 }); }
      });
      sdk.on('frameSentThrough', (_sent, timestampUs) => {
        if (!current()) return;
        this.diagnostics?.frame(_sent, timestampUs);
        this.#lastFeedbackAt = this.now();
        // Count both accepted and rejected frames: a missing face must not
        // masquerade as a slow camera. Ignore duplicate/out-of-order callbacks.
        if (Number.isFinite(timestampUs) && timestampUs > this.#frameTimestamp) {
          this.#frameTimestamp = timestampUs;
          this.frameRate.record(++this.#frameCount);
        }
      });
      sdk.on('error', (code, _message, retryable) => fail({ code, retryable, diagnosticSource: 'sdk_event' }));
      sdk.useMediaStream(this.state.stream);
      this.#sdkStarting = true;
      await sdk.start();
      if (current()) {
        this.diagnostics?.event('sdk_start_resolved');
        this.#sdkStarting = false;
        this.#sdkStarted = true;
      }
    } catch (error) { fail(error); }
  }
}
