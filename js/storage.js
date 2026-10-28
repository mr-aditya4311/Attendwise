/*
 * AttendWise storage layer: settings and calculation history.
 * Uses localStorage when available, otherwise an in-memory fallback
 * that reports itself through `usingMemory` so the UI can warn the user.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AttendStorage = api;
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const SETTINGS_KEY = 'attendwise.settings.v1';
  const HISTORY_KEY = 'attendwise.history.v1';
  const HISTORY_LIMIT = 50;

  const memoryFallback = {};

  function getBackend() {
    try {
      const probe = '__attendwise_probe__';
      const ls = root && root.localStorage;
      if (!ls) return null;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      return null;
    }
  }

  function makeStore() {
    const backend = getBackend();
    return {
      usingMemory: backend === null,
      get(key) {
        if (backend) {
          try { return backend.getItem(key); } catch (e) { return null; }
        }
        return Object.prototype.hasOwnProperty.call(memoryFallback, key) ? memoryFallback[key] : null;
      },
      set(key, value) {
        if (backend) {
          try { backend.setItem(key, value); return true; } catch (e) { /* fall through */ }
        }
        memoryFallback[key] = value;
        return !backend;
      },
      remove(key) {
        if (backend) {
          try { backend.removeItem(key); } catch (e) { /* ignore */ }
        }
        delete memoryFallback[key];
      }
    };
  }

  let store = makeStore();

  function defaults(engine) {
    return Object.assign({}, engine.DEFAULT_SETTINGS);
  }

  /** loadSettings: returns { settings, usingMemory } with defaults for any missing or invalid field. */
  function loadSettings(engine) {
    const result = defaults(engine);
    const raw = store.get(SETTINGS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.displayName === 'string' && parsed.displayName.trim() !== '') {
          result.displayName = parsed.displayName.trim().slice(0, 40);
        }
        const lpd = engine.parseNonNegativeInt(parsed && parsed.lecturesPerDay);
        if (lpd !== null && lpd > 0) result.lecturesPerDay = lpd;
        const target = engine.parseTargetPercent(parsed && parsed.targetPercent);
        if (target !== null && target > 0 && target < 100) result.targetPercent = target;
      } catch (e) {
        // Corrupt value: keep defaults.
      }
    }
    return { settings: result, usingMemory: store.usingMemory };
  }

  /**
   * saveSettings: validates before writing. Returns { ok, errors, usingMemory }.
   * Invalid values are never silently clamped; errors are returned instead.
   */
  function saveSettings(engine, input) {
    const errors = {};
    const name = String(input.displayName === undefined || input.displayName === null ? '' : input.displayName).trim();
    const lpd = engine.parseNonNegativeInt(input.lecturesPerDay);
    const target = engine.parseTargetPercent(input.targetPercent);
    if (lpd === null || lpd === 0) errors.lecturesPerDay = 'Lectures per college day must be a positive whole number.';
    if (target === null || !(target > 0 && target < 100)) errors.targetPercent = 'Target must be greater than 0 and less than 100.';
    if (Object.keys(errors).length) {
      return { ok: false, errors, usingMemory: store.usingMemory };
    }
    const settings = { displayName: name === '' ? 'Student' : name.slice(0, 40), lecturesPerDay: lpd, targetPercent: target };
    store.set(SETTINGS_KEY, JSON.stringify(settings));
    return { ok: true, settings, errors: {}, usingMemory: store.usingMemory };
  }

  function resetSettings(engine) {
    store.remove(SETTINGS_KEY);
    return { settings: defaults(engine), usingMemory: store.usingMemory };
  }

  function loadHistory() {
    const raw = store.get(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
    } catch (e) {
      return [];
    }
  }

  function appendHistory(entry) {
    const list = loadHistory();
    list.unshift(entry);
    store.set(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
    return list.slice(0, HISTORY_LIMIT);
  }

  function clearHistory() {
    store.remove(HISTORY_KEY);
  }

  // Test hook: swap the backing store (used by the node test suite).
  function _setBackendForTests(fakeLocalStorage) {
    root = { localStorage: fakeLocalStorage };
    store = makeStore();
  }

  return {
    SETTINGS_KEY,
    HISTORY_KEY,
    loadSettings,
    saveSettings,
    resetSettings,
    loadHistory,
    appendHistory,
    clearHistory,
    get usingMemory() { return store.usingMemory; },
    _setBackendForTests
  };
});
