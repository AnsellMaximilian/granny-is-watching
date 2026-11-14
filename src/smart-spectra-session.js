import { SignalReadings, spectraError, validationHint } from './smart-spectra-readings.js';

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

  constructor({ mediaDevices, loadSdk, onChange = () => {}, now = Date.now, captureTimeoutMs = 30000 }) {
    this.mediaDevices = mediaDevices;
    this.loadSdk = loadSdk;
    this.onChange = onChange;
    this.captureTimeoutMs = captureTimeoutMs;
    this.now = now;
    this.readings = new SignalReadings(now);
    this.state = {
      phase: 'off', sdkStatus: 'idle', stream: null, validationCode: null, validationAt: null, devices: [],
      nativeAvailable: false, desktop: false, packaged: false, hasKey: false, needsKey: false,
      hint: 'Enable your camera for a live preview. Facial analysis runs only when needed.',
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
    if (config.environmentError) this.state.hint = 'The local key file could not be loaded. You can enter a key in Settings.';
    this.emit();
  }

  emit() { this.onChange(this.state); }

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

  #clearSignals() {
    this.#signalGeneration++;
    this.#failSignals = null;
    this.#stoppedAt = null;
    this.readings.clear();
    this.state.validationCode = null;
    this.state.validationAt = null;
  }

  #disposeSdk() {
    this.#clearSignals();
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
    this.state.hint = !this.state.stream ? 'Camera stopped. Enable it whenever you want a preview.'
      : !this.state.nativeAvailable ? this.state.desktop
        ? this.state.packaged
          ? 'Live preview only. The bundled facial runtime could not load. Reinstall the game, or continue with facial hurdles off.'
          : 'Live preview only. The native SmartSpectra runtime is unavailable. Run npm ci and restart the game.'
        : 'Live preview only. Open the desktop game with npm start to use SmartSpectra.'
      : !this.#key ? 'Live preview ready. Enter your SmartSpectra API key in Settings to detect signals.'
      : 'Live preview only. SDK idle until a facial encounter or a 15-second signal test.';
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
    if (!needed) {
      this.#clearSignals();
      // A pending start must not turn on the frame pump after its choice ended.
      // Cancel it rather than waiting through the SDK's full startup timeout.
      if (this.#sdkStarting) this.#disposeSdk();
      if (this.#sdkStarted || this.#stopRequested) {
        this.#stopRequested = true;
        Object.assign(this.state, { phase: 'stopping', sdkStatus: 'stopping', hint: 'Stopping facial analysis. Your camera preview stays on.' });
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
    this.#cameraGeneration++;
    this.#analysisNeeded = false;
    this.#signalBlocked = false;
    this.#disposeSdk();
    for (const track of this.state.stream?.getTracks() ?? []) track.stop();
    Object.assign(this.state, {
      phase: 'off', sdkStatus: 'idle', stream: null,
      hint: 'Camera stopped. Enable it whenever you want to check the signals.',
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
      this.stopCamera();
      Object.assign(this.state, { phase: 'camera-error', hint: spectraError(error) });
      this.emit();
    } finally { clearTimeout(timeout); }
  }

  async setKey(key) {
    if (typeof key !== 'string' || !key.trim()) return;
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
    this.#signalBlocked = false;
    this.#analysisNeeded = true;
    await this.#syncSignals();
  }

  async #updateSignals() {
    if (!this.#analysisNeeded || !this.state.stream || this.#stopRequested) {
      if (this.#sdkStarted) {
        const sdk = this.#sdk;
        this.#clearSignals();
        this.#sdkStarted = false;
        try { await sdk.stop(); }
        catch {
          if (sdk === this.#sdk) this.#disposeSdk();
        }
        if (sdk !== this.#sdk) return;
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
      this.#signalBlocked = true;
      this.#disposeSdk();
      Object.assign(this.state, {
        phase: 'signal-error', sdkStatus: 'error', hint: spectraError(error), needsKey: error?.code === 2,
      });
      this.emit();
    };
    this.#failSignals = fail;
    this.#lastFeedbackAt = this.now();
    Object.assign(this.state, { phase: 'starting', sdkStatus: 'starting', hint: 'Starting facial analysis. Keep your face visible and well lit.' });
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
        try { this.readings.ingest(decodeMetrics(buffer)); }
        catch { fail({ code: 8 }); }
      });
      sdk.on('frameSentThrough', () => { if (current()) this.#lastFeedbackAt = this.now(); });
      sdk.on('error', (code, _message, _retryable) => fail({ code }));
      sdk.useMediaStream(this.state.stream);
      this.#sdkStarting = true;
      await sdk.start();
      if (current()) {
        this.#sdkStarting = false;
        this.#sdkStarted = true;
      }
    } catch (error) { fail(error); }
  }
}
