const C = globalThis.CRAS;
const $ = (id) => document.getElementById(id);

const NAMES = { intro: "Intro", recap: "Recap", credits: "Credits", preview: "Preview" };
const BINGE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];
// Placeholder layout for the timeline when no episode is open.
const SAMPLE = { duration: 1440, segments: [
  { type: "recap", start: 0, end: 60 },
  { type: "intro", start: 75, end: 165 },
  { type: "credits", start: 1290, end: 1380 },
  { type: "preview", start: 1385, end: 1440 }
] };

let settings = C.mergeSettings({});
let context = null; // what the content script on the active tab reports
let binge = { count: 0 };
let sleepState = { mode: "off", until: 0 };

function saveSettings(patch) {
  settings = C.mergeSettings({ ...settings, ...patch });
  chrome.storage.sync.set(patch);
}

function seriesKeep(type) {
  const s = context && context.series;
  const ex = s && s.id && settings.showExceptions[s.id];
  return !!(ex && ex.keep && ex.keep[type]);
}

// "skip" | "watch" (per-show exception) | "off" (segment type turned off)
function segmentFate(type) {
  if (!settings.segments[type]) return "off";
  if (seriesKeep(type)) return "watch";
  return "skip";
}

// ---- render ------------------------------------------------------------------

function renderAll() {
  document.body.classList.toggle("is-off", !settings.enabled);
  $("enabled").checked = settings.enabled;
  $("status").textContent = settings.enabled ? "for Crunchyroll" : "Off, nothing gets skipped";
  $("status").classList.toggle("off", !settings.enabled);

  for (const tile of document.querySelectorAll("[data-seg]")) {
    tile.setAttribute("aria-pressed", String(!!settings.segments[tile.dataset.seg]));
  }
  $("autoNext").checked = settings.autoNext;

  $("delayOut").textContent = settings.delay === 0 ? "None" : `${settings.delay}s`;
  stepperBounds("delay", settings.delay <= 0, settings.delay >= 10);

  $("bingeOut").textContent = settings.bingeLimit ? String(settings.bingeLimit) : "Off";
  const bi = BINGE_STEPS.indexOf(nearestBinge(settings.bingeLimit));
  stepperBounds("binge", bi <= 0, bi >= BINGE_STEPS.length - 1);
  renderBinge();

  renderEpisode();
  renderExceptions();
}

function stepperBounds(name, atMin, atMax) {
  document.querySelector(`[data-step="${name}"][data-dir="-1"]`).disabled = atMin;
  document.querySelector(`[data-step="${name}"][data-dir="1"]`).disabled = atMax;
}

function nearestBinge(v) {
  return BINGE_STEPS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 0);
}

function renderStats(stats) {
  const s = stats || {};
  $("savedTotal").textContent = C.formatDuration(s.total || 0);
  $("savedToday").textContent = C.formatDuration((s.days || {})[C.dayKey()] || 0);
  $("skipCount").textContent = String(s.count || 0);
}

function renderBinge() {
  const n = binge.count || 0;
  const info = $("bingeInfo");
  info.hidden = !(settings.bingeLimit > 0 && n > 0);
  info.textContent = `${n} of ${settings.bingeLimit} played in a row`;
}

function renderSleep() {
  let active = "off";
  const timed = sleepState.mode === "time" && sleepState.until > Date.now();
  if (sleepState.mode === "episode") active = "episode";
  else if (timed) active = String(sleepState.minutes || "");
  for (const b of document.querySelectorAll("[data-sleep]")) {
    b.setAttribute("aria-checked", String(b.dataset.sleep === active));
  }
  const info = $("sleepInfo");
  info.classList.toggle("active", active !== "off");
  info.hidden = active === "off";
  if (timed) info.textContent = `Pausing in ${C.formatTimestamp((sleepState.until - Date.now()) / 1000)}`;
  else if (sleepState.mode === "episode") info.textContent = "Stops when this episode ends";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderTimeline(segments, duration, time, sample) {
  const tl = $("timeline");
  tl.replaceChildren();
  tl.classList.toggle("sample", !!sample);
  const dur = duration || Math.max(1, ...segments.map((s) => s.end)) * 1.02;
  for (const s of segments) {
    const seg = el("span", `seg${!sample && segmentFate(s.type) !== "skip" ? " watch" : ""}`);
    seg.style.left = `${(s.start / dur) * 100}%`;
    seg.style.width = `${Math.max(1.5, ((Math.min(s.end, dur) - s.start) / dur) * 100)}%`;
    tl.append(seg);
  }
  if (!sample && Number.isFinite(time) && dur > 0) {
    const head = el("span", "head");
    head.style.left = `${Math.min(100, (time / dur) * 100)}%`;
    tl.append(head);
  }
}

function renderEpisode() {
  const legend = $("legend");
  legend.replaceChildren();

  if (!context || !context.episodeId) {
    $("showTitle").textContent = "No episode open";
    $("epMeta").textContent = "Open an episode on Crunchyroll to see where it skips";
    renderTimeline(SAMPLE.segments, SAMPLE.duration, null, true);
    return;
  }

  const series = context.series;
  $("showTitle").textContent = (series && series.title) || context.episodeTitle || "This episode";
  $("epMeta").textContent =
    series && series.title && context.episodeTitle ? context.episodeTitle : `Episode ${context.episodeId}`;
  renderTimeline(context.segments, context.duration, context.time, false);

  if (!context.segments.length) {
    legend.append(el("li", "none", "No timestamps for this episode yet, so Crunchyroll's own skip button is used"));
  }
  const canExcept = !!(series && series.id);
  for (const s of context.segments) {
    const fate = segmentFate(s.type);
    const li = el("li");
    let what;
    if (fate === "off") {
      what = el("span", "what off", "Off");
    } else if (canExcept) {
      // Tap to keep this part for every episode of the show.
      what = el("button", `what${fate === "skip" ? " skip" : ""}`);
      what.type = "button";
      what.title = fate === "skip" ? `Watch the ${NAMES[s.type].toLowerCase()} for this show` : "Skip it again";
      what.innerHTML = '<svg><use href="#i-swap" /></svg>';
      what.append(fate === "skip" ? "Skip" : "Watch");
      what.addEventListener("click", () => setKeep(s.type));
    } else {
      what = el("span", `what${fate === "skip" ? " skip" : ""}`, fate === "skip" ? "Skip" : "Watch");
    }
    li.append(
      el("span", `dot${fate === "skip" ? "" : " watch"}`),
      el("span", "name", NAMES[s.type]),
      el("span", "time", `${C.formatTimestamp(s.start)} – ${C.formatTimestamp(s.end)}`),
      what
    );
    legend.append(li);
  }
}

function renderExceptions() {
  const list = $("exceptions");
  list.replaceChildren();
  const entries = Object.entries(settings.showExceptions);
  $("exceptionCount").textContent = String(entries.length);
  $("noExceptions").hidden = entries.length > 0;
  for (const [id, ex] of entries) {
    const li = el("li");
    const text = el("span");
    const kept = Object.keys(NAMES).filter((t) => ex.keep && ex.keep[t]).map((t) => NAMES[t].toLowerCase());
    text.append(el("b", "", ex.title || id), el("small", "", `Watching the ${kept.join(", ")}`));
    const remove = el("button", "link", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      const next = { ...settings.showExceptions };
      delete next[id];
      saveSettings({ showExceptions: next });
      renderAll();
    });
    li.append(text, remove);
    list.append(li);
  }
}

// ---- events ------------------------------------------------------------------

$("enabled").addEventListener("change", (e) => {
  saveSettings({ enabled: e.target.checked });
  renderAll();
});

for (const tile of document.querySelectorAll("[data-seg]")) {
  tile.addEventListener("click", () => {
    const type = tile.dataset.seg;
    saveSettings({ segments: { ...settings.segments, [type]: !settings.segments[type] } });
    renderAll();
  });
}

$("autoNext").addEventListener("change", (e) => saveSettings({ autoNext: e.target.checked }));

for (const b of document.querySelectorAll("[data-step]")) {
  b.addEventListener("click", () => {
    const dir = Number(b.dataset.dir);
    if (b.dataset.step === "delay") {
      saveSettings({ delay: Math.min(10, Math.max(0, settings.delay + dir)) });
    } else {
      const i = BINGE_STEPS.indexOf(nearestBinge(settings.bingeLimit));
      const next = BINGE_STEPS[Math.min(BINGE_STEPS.length - 1, Math.max(0, i + dir))];
      saveSettings({ bingeLimit: next });
      binge = { count: 0, at: Date.now() };
      chrome.storage.local.set({ binge });
    }
    renderAll();
  });
}

function setKeep(type) {
  const series = context && context.series;
  if (!series || !series.id) return;
  const all = { ...settings.showExceptions };
  const current = all[series.id] || { title: series.title || "", keep: {} };
  const keep = { ...current.keep, [type]: !(current.keep && current.keep[type]) };
  for (const k of Object.keys(keep)) if (!keep[k]) delete keep[k];
  if (!Object.keys(keep).length) delete all[series.id];
  else all[series.id] = { title: series.title || current.title, keep };
  saveSettings({ showExceptions: all });
  renderAll();
}

for (const b of document.querySelectorAll("[data-sleep]")) {
  b.addEventListener("click", () => {
    const v = b.dataset.sleep;
    if (v === "off") sleepState = { mode: "off", until: 0 };
    else if (v === "episode") sleepState = { mode: "episode", until: 0 };
    else sleepState = { mode: "time", minutes: Number(v), until: Date.now() + Number(v) * 60e3 };
    chrome.storage.local.set({ sleep: sleepState });
    renderSleep();
  });
}

$("resetStats").addEventListener("click", () => {
  chrome.storage.local.set({ stats: {} });
  renderStats({});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) renderStats(changes.stats.newValue);
  if (area === "local" && changes.binge) {
    binge = changes.binge.newValue || { count: 0 };
    renderBinge();
  }
  if (area === "local" && changes.sleep) {
    sleepState = changes.sleep.newValue || { mode: "off", until: 0 };
    renderSleep();
  }
  if (area === "sync") {
    chrome.storage.sync.get(null, (s) => {
      settings = C.mergeSettings(s);
      renderAll();
    });
  }
});

// ---- init --------------------------------------------------------------------

function askContext() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || tab.id === undefined) return;
    chrome.tabs.sendMessage(tab.id, { type: "cras:getContext" }, (res) => {
      if (chrome.runtime.lastError) return; // not a Crunchyroll tab
      context = res || null;
      renderEpisode();
    });
  });
}

chrome.storage.sync.get(null, (s) => {
  settings = C.mergeSettings(s);
  chrome.storage.local.get(["stats", "binge", "sleep"], (l) => {
    if (l.binge) binge = l.binge;
    if (l.sleep) sleepState = l.sleep;
    renderAll();
    renderStats(l.stats);
    renderSleep();
    askContext();
  });
});

// Keep the sleep countdown and the playhead moving while the popup is open.
setInterval(renderSleep, 1000);
setInterval(askContext, 1000);
