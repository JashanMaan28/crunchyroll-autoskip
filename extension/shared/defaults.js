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
    showExceptions: {},
    // Let the opening play the first time you watch a show, and on every
    // episode 1, then skip it as usual.
    firstOpening: true,
    // Shade the skip zones on the player's own seek bar.
    seekMarkers: true
  };

  // Custom skips live in their own sync keys ("marks.<seriesId>"), one per
  // show, so a long list can't hit the per-item quota of showExceptions.
  // { title, list: [{ id, s: {a, o}, e: {a, o}, label, ep? }] }
  //   a = anchor ("start", "end", "credits.end", ...), o = offset in seconds,
  //   ep = only for this episode.
  const MARK_PREFIX = "marks.";
  const MAX_MARKS_PER_SHOW = 20;

  const LABELS = {
    intro: "Skip Intro",
    recap: "Skip Recap",
    credits: "Skip Credits",
    preview: "Skip Preview",
    custom: "Skip Scene",
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
      showExceptions: isObject(s.showExceptions) ? s.showExceptions : {},
      firstOpening: typeof s.firstOpening === "boolean" ? s.firstOpening : DEFAULT_SETTINGS.firstOpening,
      seekMarkers: typeof s.seekMarkers === "boolean" ? s.seekMarkers : DEFAULT_SETTINGS.seekMarkers,
      marks: collectMarks(s)
    };
  }

  function isPoint(p) {
    return isObject(p) && typeof p.a === "string" && Number.isFinite(Number(p.o));
  }

  function collectMarks(stored) {
    const out = {};
    for (const [key, v] of Object.entries(stored)) {
      if (!key.startsWith(MARK_PREFIX) || !isObject(v) || !Array.isArray(v.list)) continue;
      const list = v.list.filter((m) => isObject(m) && typeof m.id === "string" && isPoint(m.s) && isPoint(m.e));
      if (list.length) out[key.slice(MARK_PREFIX.length)] = { title: typeof v.title === "string" ? v.title : "", list };
    }
    return out;
  }

  // Read-modify-write one show's marks. `fn(list)` returns the new list.
  // Only call this where chrome.storage exists (popup, content script).
  function updateMarks(key, title, fn) {
    const k = MARK_PREFIX + key;
    return new Promise((resolve) => {
      chrome.storage.sync.get(k, (got) => {
        const cur = got && isObject(got[k]) && Array.isArray(got[k].list) ? got[k] : { title: "", list: [] };
        const list = fn(cur.list.slice()).slice(-MAX_MARKS_PER_SHOW);
        if (!list.length) chrome.storage.sync.remove(k, resolve);
        else chrome.storage.sync.set({ [k]: { title: title || cur.title || "", list } }, resolve);
      });
    });
  }

  function newMarkId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Last 7 days (today included) for the weekly recap.
  function summarizeWeek(stats, now = new Date()) {
    const s = isObject(stats) ? stats : {};
    const days = [];
    const episodes = new Set();
    const shows = {};
    let total = 0;
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dayKey(date);
      const seconds = Number((s.days || {})[key]) || 0;
      total += seconds;
      for (const id of (s.eps || {})[key] || []) episodes.add(id);
      for (const [id, sec] of Object.entries((s.shows || {})[key] || {})) shows[id] = (shows[id] || 0) + (Number(sec) || 0);
      days.push({ key, date, seconds });
    }
    const top = Object.entries(shows)
      .filter(([, sec]) => sec > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, seconds]) => ({ id, title: (s.titles || {})[id] || "", seconds }));
    return { days, total, episodes: episodes.size, shows: top };
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
    MARK_PREFIX,
    mergeSettings,
    updateMarks,
    newMarkId,
    summarizeWeek,
    formatDuration,
    formatTimestamp,
    dayKey
  };

  root.CRAS = Object.assign(root.CRAS || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
