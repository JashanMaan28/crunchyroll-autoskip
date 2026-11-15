// Service worker: fetches skip-event timestamps, keeps stats, handles the
// toggle hotkey.
importScripts("shared/defaults.js");

const SKIP_EVENTS_URL = "https://static.crunchyroll.com/skip-events/production/";
const ID_RE = /^[A-Z0-9]{6,20}$/;
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

// Serialize stat writes so two quick skips can't clobber each other.
let statQueue = Promise.resolve();
function addStat(kind, seconds) {
  statQueue = statQueue.then(async () => {
    const { stats } = await chrome.storage.local.get("stats");
    const s = stats && typeof stats === "object" ? stats : {};
    s.total = (s.total || 0) + seconds;
    s.count = (s.count || 0) + 1;
    s.days = s.days || {};
    const today = CRAS.dayKey();
    s.days[today] = (s.days[today] || 0) + seconds;
    // Keep ~2 months of daily totals.
    const keys = Object.keys(s.days).sort();
    while (keys.length > 62) delete s.days[keys.shift()];
    s.kinds = s.kinds || {};
    s.kinds[kind] = (s.kinds[kind] || 0) + 1;
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
      addStat(String(msg.kind || "other").slice(0, 20), seconds).then(() => sendResponse(true));
      return true;
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-autoskip") return;
  const { enabled } = await chrome.storage.sync.get("enabled");
  await chrome.storage.sync.set({ enabled: enabled === false });
});
