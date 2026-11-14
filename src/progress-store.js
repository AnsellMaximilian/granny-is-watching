import { GRANNY, PLAYER, ROWS } from './congklak.js';

export const DEFAULT_SETTINGS = Object.freeze({ sound: true, facialHurdles: false, saveProgress: true, showCamera: true });
export const PROGRESS_VERSION = 1;
const SMALL_PITS = ROWS.flat();

export function validCheckpoint(value) {
  if (!value || !Array.isArray(value.burned) || !Array.isArray(value.escapePattern)) return null;
  const { burned, escapePattern } = value;
  if (burned.length > 10 || escapePattern.length !== 4
    || [burned, escapePattern].some((pits) => new Set(pits).size !== pits.length || pits.some((pit) => !Number.isInteger(pit) || !SMALL_PITS.includes(pit)))
    || ROWS.some((row) => row.every((pit) => burned.includes(pit)))
    || [PLAYER, GRANNY].some((side) => ROWS[side].filter((pit) => escapePattern.includes(pit)).length !== 2)
    || (burned.length === 4 && escapePattern.every((pit) => burned.includes(pit)))) return null;
  return { burned: [...burned], escapePattern: [...escapePattern] };
}

export function decodeProgress(json) {
  const raw = JSON.parse(json);
  if (!raw || raw.version !== PROGRESS_VERSION || !raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings)) throw new Error('Unsupported save.');
  const settings = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) =>
    [key, typeof raw.settings[key] === 'boolean' ? raw.settings[key] : fallback]));
  const checkpoint = settings.saveProgress && raw.checkpoint !== null ? validCheckpoint(raw.checkpoint) : null;
  const issue = settings.saveProgress && raw.checkpoint != null && !checkpoint
    ? 'The saved round could not be loaded. Your settings were kept; you can start a new game.' : '';
  return { settings, checkpoint, issue };
}

export function browserProgressStorage(storage = () => globalThis.localStorage) {
  const key = 'granny-is-watching:progress:v1';
  return {
    read: async () => storage().getItem(key),
    write: async (json) => storage().setItem(key, json),
  };
}

export class ProgressStore {
  constructor(storage) {
    this.storage = storage;
    this.settings = { ...DEFAULT_SETTINGS };
    this.checkpoint = null;
    this.issue = '';
    this.pending = Promise.resolve();
  }

  static async load(storage) {
    const store = new ProgressStore(storage);
    try {
      const json = await storage.read();
      if (json !== null) Object.assign(store, decodeProgress(json));
    } catch {
      store.issue = 'Local progress could not be loaded. You can still start a new game.';
    }
    return store;
  }

  getCheckpoint() { return this.settings.saveProgress && this.checkpoint ? validCheckpoint(this.checkpoint) : null; }

  persist() {
    const json = JSON.stringify({ version: PROGRESS_VERSION, settings: this.settings, checkpoint: this.getCheckpoint() });
    this.pending = this.pending.then(async () => {
      try { await this.storage.write(json); this.issue = ''; }
      catch { this.issue = 'Local saving is unavailable. Retry works in this session, but progress may not survive closing the game.'; }
    });
    return this.pending;
  }

  updateSettings(patch) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof patch[key] === 'boolean') this.settings[key] = patch[key];
    }
    if (!this.settings.saveProgress) this.checkpoint = null;
    return this.persist();
  }

  saveRound(game) {
    const checkpoint = validCheckpoint({ burned: game.burned, escapePattern: game.escapePattern });
    if (!checkpoint) throw new Error('Cannot save an unplayable round.');
    if (this.settings.saveProgress) this.checkpoint = checkpoint;
    return this.persist();
  }

  clearCheckpoint() { this.checkpoint = null; return this.persist(); }
}
