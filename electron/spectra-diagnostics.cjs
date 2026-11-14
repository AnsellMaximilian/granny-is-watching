const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const EVENTS = new Set([
  'logger_start', 'renderer_loaded', 'camera_open_requested', 'camera_opened', 'camera_error', 'camera_stopped',
  'analysis_demand', 'manual_retry', 'key_replaced', 'session_start_requested', 'sdk_start_resolved',
  'session_stop_requested', 'session_stopped', 'session_disposed', 'session_end', 'sdk_status',
  'sdk_validation', 'sdk_error', 'timing_sample', 'game_context',
  'first_frame', 'first_stable_face',
]);
const NUMBER_FIELDS = new Set([
  'atMs', 'elapsedMs', 'sessionId', 'sessionElapsedMs', 'windowMs', 'width', 'height', 'nominalFps',
  'previewFps', 'trackingFps', 'validationCode', 'sdkTimestampUs', 'processingStatus',
  'gameFps', 'framesReceived', 'framesSentTrue', 'framesSentFalse', 'callbackFps', 'timestampFps',
  'firstSdkTimestampUs', 'lastSdkTimestampUs', 'sourceGapMeanMs', 'sourceGapP95Ms', 'sourceGapMaxMs',
  'timestampGapsOver40Ms', 'arrivalGapP95Ms', 'arrivalGapMaxMs', 'duplicateTimestamps', 'outOfOrderTimestamps',
  'metricsPackets', 'metricsGapMaxMs', 'faceLandmarks', 'stableLandmarks', 'faceExpressions', 'stableExpressions',
  'blinkSamples', 'talkingSamples', 'renderFrames', 'renderGapP95Ms', 'renderGapMaxMs',
]);
const BOOLEAN_FIELDS = new Set([
  'analysisActive', 'analysisNeeded', 'signalBlocked', 'retryable', 'focused', 'documentHidden', 'settingsOpen',
  'previewVisible', 'cameraMuted', 'cameraEnabled', 'hasFreshExpression', 'hasFreshFacing', 'healthy', 'packaged',
]);
const STRING_FIELDS = new Set([
  'phase', 'sdkStatus', 'gamePhase', 'encounter', 'source', 'reason', 'cameraReadyState',
  'appVersion', 'sdkVersion', 'electronVersion', 'chromiumVersion', 'platform',
]);
const ERROR_CODES = new Set([
  'SIGNAL_STOPPED', 'SIGNAL_STALLED', 'SMARTSPECTRA_IPC_TIMEOUT', 'SMARTSPECTRA_DESTROYED',
  'CAMERA_TIMEOUT', 'CAMERA_ENDED', 'CAPTURE_UNSUPPORTED', 'PROCESSOR_UNSUPPORTED',
]);

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object' || !EVENTS.has(record.event)) return null;
  const clean = { event: record.event };
  for (const [field, value] of Object.entries(record)) {
    if (NUMBER_FIELDS.has(field) && (value === null || (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER))) clean[field] = value;
    else if (BOOLEAN_FIELDS.has(field) && typeof value === 'boolean') clean[field] = value;
    else if (STRING_FIELDS.has(field) && (value === null || (typeof value === 'string' && /^[a-zA-Z0-9_.^+ -]{0,64}$/.test(value)))) clean[field] = value;
    else if (field === 'code') {
      if (Number.isInteger(value) && value >= 0 && value <= 255) clean.code = value;
      else if (ERROR_CODES.has(value)) clean.code = value;
      else clean.code = null;
    }
  }
  return clean;
}

function registerSpectraDiagnosticsIpc({ ipcMain, isTrusted, file, metadata = {}, maxBytes = 5 * 1024 * 1024, now = Date.now }) {
  const runId = randomUUID();
  let writes = Promise.resolve();
  let size = null;
  let pending = 0;
  let burstStart = now();
  let burstCount = 0;
  const write = record => {
    const clean = sanitizeRecord(record);
    if (!clean || pending >= 256) return;
    const time = now();
    if (time - burstStart >= 1000) { burstStart = time; burstCount = 0; }
    if (++burstCount > 100 && clean.event !== 'sdk_error') return;
    const line = JSON.stringify({ loggedAt: new Date(time).toISOString(), runId, ...clean }) + '\n';
    pending++;
    writes = writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (size === null) {
        try { size = (await fs.stat(file)).size; }
        catch (error) { if (error.code !== 'ENOENT') throw error; size = 0; }
      }
      const bytes = Buffer.byteLength(line);
      if (size + bytes > maxBytes && size > 0) {
        await fs.rm(file + '.previous', { force: true });
        await fs.rename(file, file + '.previous');
        size = 0;
      }
      await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
      size += bytes;
    }).catch(() => { size = null; }).finally(() => { pending--; });
  };
  ipcMain.on('granny:spectra-diagnostic', (event, record) => {
    if (isTrusted(event)) write(record);
  });
  write({ event: 'logger_start', ...metadata });
  return { write, flush: () => writes.catch(() => {}) };
}

module.exports = { registerSpectraDiagnosticsIpc, sanitizeRecord };
