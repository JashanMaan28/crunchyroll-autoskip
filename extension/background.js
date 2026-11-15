// Background: fetches skip-event timestamps, keeps stats, handles hotkeys.
// Chrome runs this as a service worker; Firefox as an event page that has
// already loaded shared/defaults.js (see scripts/build.js).
if (typeof CRAS === "undefined") importScripts("shared/defaults.js");

const SKIP_EVENTS_URL = "https://static.crunchyroll.com/skip-events/production/";
const ID_RE = /^[A-Z0-9]{6,20}$/;
const KEEP_DAYS = 62;
const CACHE_LIMIT = 200;
const cache = new Map(); // episodeId -> { data, at }

async function getSkipEvents(episodeId) {
  if (!ID_RE.test(episodeId || "")) return { data: null };
  const hit = cache.get(episodeId);
  // Timestamps get filled in after an episode airs, so don't cache misses long.
  if (hit && Date.now() - hit.at < (hit.data ? 6 * 3600e3 : 5 * 60e3)) return { data: hit.data };
  let data = null;
  try {
    const res = await fetch(`${SKIP_EVENTS_URL}${episodeId}.json`, { cache: "no-cache" });
    // Episodes without timestamps answer 403 with an XML error body.
    if (res.ok) {
      const text = await res.text();
      const json = JSON.parse(text);
      if (json && typeof json === "object") data = json;
    }
  } catch (err) {
    console.debug("[CR Autoskip] skip-events fetch failed", episodeId, err);
  }
  cache.set(episodeId, { data, at: Date.now() });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return { data };
}

function pruneDays(obj) {
  const keys = Object.keys(obj).sort();
  while (keys.length > KEEP_DAYS) delete obj[keys.shift()];
}

// Serialize stat writes so two quick skips can't clobber each other.
// stats = { total, count, kinds, days: {day: s}, shows: {day: {series: s}},
//           eps: {day: [episodeId]}, titles: {series: title} }
let statQueue = Promise.resolve();
function addStat(kind, seconds, meta) {
  statQueue = statQueue.then(async () => {
    const { stats } = await chrome.storage.local.get("stats");
    const s = stats && typeof stats === "object" ? stats : {};
    const today = CRAS.dayKey();
    s.total = (s.total || 0) + seconds;
    s.count = (s.count || 0) + 1;
    s.days = s.days || {};
    s.days[today] = (s.days[today] || 0) + seconds;
    s.kinds = s.kinds || {};
    s.kinds[kind] = (s.kinds[kind] || 0) + 1;
    s.shows = s.shows || {};
    s.eps = s.eps || {};
    s.titles = s.titles || {};
    if (meta.seriesId) {
      const day = (s.shows[today] = s.shows[today] || {});
      day[meta.seriesId] = (day[meta.seriesId] || 0) + seconds;
      if (meta.seriesTitle) s.titles[meta.seriesId] = meta.seriesTitle;
    }
    if (meta.episodeId) {
      const list = (s.eps[today] = s.eps[today] || []);
      if (!list.includes(meta.episodeId) && list.length < 200) list.push(meta.episodeId);
    }
    // Keep ~2 months of history.
    pruneDays(s.days);
    pruneDays(s.shows);
    pruneDays(s.eps);
    const live = new Set(Object.values(s.shows).flatMap((d) => Object.keys(d)));
    for (const id of Object.keys(s.titles)) if (!live.has(id)) delete s.titles[id];
    await chrome.storage.local.set({ stats: s });
  });
  return statQueue;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "cras:getSkipEvents") {
    getSkipEvents(String(msg.episodeId || "").toUpperCase()).then(sendResponse);
    return true;
  }
  if (msg.type === "cras:stat") {
    const seconds = Number(msg.seconds);
    if (Number.isFinite(seconds) && seconds > 0 && seconds < 4 * 3600) {
      const id = (v) => {
        const x = String(v || "").toUpperCase();
        return ID_RE.test(x) ? x : "";
      };
      const meta = {
        seriesId: id(msg.seriesId),
        seriesTitle: String(msg.seriesTitle || "").slice(0, 80),
        episodeId: id(msg.episodeId)
      };
      addStat(String(msg.kind || "other").slice(0, 20), seconds, meta).then(() => sendResponse(true));
      return true;
    }
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-autoskip") {
    const { enabled } = await chrome.storage.sync.get("enabled");
    await chrome.storage.sync.set({ enabled: enabled === false });
  } else if (command === "mark-segment") {
    const target = tab && tab.id !== undefined ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!target) return;
    const all = await chrome.commands.getAll();
    const shortcut = (all.find((c) => c.name === "mark-segment") || {}).shortcut || "the mark shortcut";
    chrome.tabs.sendMessage(target.id, { type: "cras:mark", shortcut }).catch(() => {
      /* not a Crunchyroll tab */
    });
  }
});
