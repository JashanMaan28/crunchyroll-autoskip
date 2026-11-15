// Settings shared by the content script, popup and background worker.
// Loaded as a classic script everywhere (and via require() in tests), so it
// only defines globals on whatever `self`/`globalThis` happens to be.
(function (root) {
  const SEGMENT_TYPES = ["recap", "intro", "credits", "preview"];

  // chrome.storage.sync — follows the user across browsers they are signed into.
  const DEFAULT_SETTINGS = {
    enabled: true,
    // Seconds the countdown button runs before it acts.
    delay: 3,
    segments: { intro: true, recap: true, credits: true, preview: true },
    // When credits/preview end the episode: go to the next one (smart) or just seek.
    autoNext: true,
    // Seconds of footage after the credits that count as a post-credits scene
    // worth watching. Anything shorter (logos, a black frame) is skipped.
    postCreditsMin: 10,
    // Stop auto-advancing after this many episodes in a row. 0 = off.
    bingeLimit: 0,
    // { [seriesId]: { title, keep: { intro: bool, credits: bool } } }
    showExceptions: {}
  };

  const LABELS = {
    intro: "Skip Intro",
    recap: "Skip Recap",
    credits: "Skip Credits",
    preview: "Skip Preview",
    next: "Next Episode"
  };

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function clampNumber(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // Merge whatever is in storage over the defaults, tolerating missing or
  // malformed keys from older versions.
  function mergeSettings(stored) {
    const s = isObject(stored) ? stored : {};
    const segments = { ...DEFAULT_SETTINGS.segments };
    if (isObject(s.segments)) {
      for (const t of SEGMENT_TYPES) {
        if (typeof s.segments[t] === "boolean") segments[t] = s.segments[t];
      }
    }
    return {
      enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_SETTINGS.enabled,
      delay: clampNumber(s.delay, 0, 10, DEFAULT_SETTINGS.delay),
      segments,
      autoNext: typeof s.autoNext === "boolean" ? s.autoNext : DEFAULT_SETTINGS.autoNext,
      postCreditsMin: clampNumber(s.postCreditsMin, 0, 120, DEFAULT_SETTINGS.postCreditsMin),
      bingeLimit: Math.round(clampNumber(s.bingeLimit, 0, 50, DEFAULT_SETTINGS.bingeLimit)),
      showExceptions: isObject(s.showExceptions) ? s.showExceptions : {}
    };
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
    return `${sec}s`;
  }

  function formatTimestamp(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  // Local calendar day, used as the key for "saved today".
  function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const api = {
    SEGMENT_TYPES,
    DEFAULT_SETTINGS,
    LABELS,
    mergeSettings,
    formatDuration,
    formatTimestamp,
    dayKey
  };

  root.CRAS = Object.assign(root.CRAS || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
