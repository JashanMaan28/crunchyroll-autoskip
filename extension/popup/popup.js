const C = globalThis.CRAS;
const P = globalThis.CRAS_planner;
const $ = (id) => document.getElementById(id);

const NAMES = { intro: "Intro", recap: "Recap", credits: "Credits", preview: "Preview" };
const BINGE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];
const POST_LABEL = "Post-credits";
// Placeholder layout for the timeline when no episode is open.
const SAMPLE = { duration: 1440, segments: [
  { type: "recap", start: 0, end: 60 },
  { type: "intro", start: 75, end: 165 },
  { type: "credits", start: 1290, end: 1380 },
  { type: "preview", start: 1385, end: 1440 }
] };

let settings = C.mergeSettings({});
let context = null; // what the content script on the active tab reports
let activeTabId = null;
let binge = { count: 0 };
let sleepState = { mode: "off", until: 0 };
let markScope = "show";

function saveSettings(patch) {
  settings = C.mergeSettings({ ...settings, ...patch });
  chrome.storage.sync.set(patch);
}

function seriesKeep(type) {
  const s = context && context.series;
  const ex = s && s.id && settings.showExceptions[s.id];
  return !!(ex && ex.keep && ex.keep[type]);
}

// "skip" | "watch" (per-show exception) | "once" (new opening) | "off" (segment type turned off)
function segmentFate(type) {
  if (!settings.segments[type]) return "off";
  if (seriesKeep(type)) return "watch";
  if (type === "intro" && context && context.watchOpening) return "once";
  return "skip";
}

function marksFor(key) {
  return (key && settings.marks[key] && settings.marks[key].list) || [];
}

function sendToTab(msg) {
  if (activeTabId === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(activeTabId, msg, (res) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(res);
    });
  });
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
  $("firstOpening").checked = settings.firstOpening;
  $("seekMarkers").checked = settings.seekMarkers;

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
  const week = C.summarizeWeek(s);
  $("weekTotal").textContent = C.formatDuration(week.total);
  $("weekEps").textContent = `${week.episodes} episode${week.episodes === 1 ? "" : "s"}`;
  $("savedTotal").textContent = C.formatDuration(s.total || 0);
  $("skipCount").textContent = String(s.count || 0);

  // Seven slim bars, one per day, today on the right.
  const spark = $("spark");
  spark.replaceChildren();
  const max = Math.max(1, ...week.days.map((d) => d.seconds));
  const spoken = [];
  week.days.forEach((d, i) => {
    const long = d.date.toLocaleDateString(undefined, { weekday: "long" });
    const col = el("span", `col${i === week.days.length - 1 ? " today" : ""}`);
    col.title = `${i === week.days.length - 1 ? "Today" : long}: ${C.formatDuration(d.seconds)} saved`;
    const bar = el("span", `stick${d.seconds ? "" : " zero"}`);
    bar.style.height = d.seconds ? `${Math.max(3, Math.round((d.seconds / max) * 28))}px` : "2px";
    col.append(bar, el("span", "day", d.date.toLocaleDateString(undefined, { weekday: "narrow" })));
    spark.append(col);
    spoken.push(`${long} ${C.formatDuration(d.seconds)}`);
  });
  spark.setAttribute("aria-label", `Time saved per day: ${spoken.join(", ")}`);

  // Top three shows of the week.
  const list = $("topShows");
  list.replaceChildren();
  const top = week.shows.slice(0, 3);
  for (const show of top) {
    const li = el("li");
    const track = el("span", "track");
    const fill = el("span", "fill");
    fill.style.width = `${Math.max(4, (show.seconds / top[0].seconds) * 100)}%`;
    track.append(fill);
    li.append(el("span", "show", show.title || "Unknown show"), track, el("span", "val", C.formatDuration(show.seconds)));
    list.append(li);
  }
  list.hidden = !top.length;
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

function iconButton(cls, icon, text, title, onClick) {
  const b = el("button", cls);
  b.type = "button";
  b.title = title;
  b.innerHTML = `<svg><use href="#${icon}" /></svg>`;
  b.append(text);
  b.addEventListener("click", onClick);
  return b;
}

// segments: [{ start, end, watch }]
function renderTimeline(segments, duration, time, sample) {
  const tl = $("timeline");
  tl.replaceChildren();
  tl.classList.toggle("sample", !!sample);
  const dur = duration || Math.max(1, ...segments.map((s) => s.end)) * 1.02;
  for (const s of segments) {
    const seg = el("span", `seg${s.watch ? " watch" : ""}`);
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

// The stretch between the credits and the preview (or the end), when it's
// long enough to be a scene.
function postCreditsInfo() {
  const segs = context.segments;
  const credits = segs.find((s) => s.type === "credits");
  if (!credits || !context.duration) return null;
  const preview = segs.find((s) => s.type === "preview" && s.start >= credits.end - 2);
  const end = preview ? preview.start : context.duration;
  if (end - credits.end < settings.postCreditsMin) return null;
  return { start: credits.end, end, hasPreview: !!preview };
}

function legendRow({ fate, name, time, what }) {
  const li = el("li");
  li.append(el("span", `dot${fate === "skip" ? "" : " watch"}`), el("span", "name", name), el("span", "time", time), what);
  return li;
}

function span(a, b) {
  return `${C.formatTimestamp(a)} – ${C.formatTimestamp(b)}`;
}

function renderEpisode() {
  const legend = $("legend");
  legend.replaceChildren();
  $("addMark").hidden = !context || !context.episodeId || !$("markForm").hidden;

  if (!context || !context.episodeId) {
    $("showTitle").textContent = "No episode open";
    $("epMeta").textContent = "Open an episode on Crunchyroll to see where it skips";
    $("markForm").hidden = true;
    renderTimeline(SAMPLE.segments, SAMPLE.duration, null, true);
    return;
  }

  const series = context.series;
  $("showTitle").textContent = (series && series.title) || context.episodeTitle || "This episode";
  $("epMeta").textContent =
    series && series.title && context.episodeTitle ? context.episodeTitle : `Episode ${context.episodeId}`;

  const bars = [];
  const custom = context.custom || [];
  const post = postCreditsInfo();
  const postMark = marksFor(context.marksKey).find((m) => m.label === POST_LABEL);

  if (!context.segments.length && !custom.length) {
    legend.append(el("li", "none", "No timestamps for this episode yet, so Crunchyroll's own skip button is used"));
  }
  const canExcept = !!(series && series.id);
  for (const s of context.segments) {
    const fate = segmentFate(s.type);
    bars.push({ start: s.start, end: s.end, watch: fate !== "skip" });
    let what;
    if (fate === "off") {
      what = el("span", "what off", "Off");
    } else if (fate === "once") {
      what = iconButton("what", "i-music", "Once", "A new opening, so it plays this time. Click to skip it.", () =>
        sendToTab({ type: "cras:skipOpening" }).then(askContext)
      );
    } else if (canExcept) {
      // Tap to keep this part for every episode of the show.
      const skip = fate === "skip";
      what = iconButton(
        `what${skip ? " skip" : ""}`,
        "i-swap",
        skip ? "Skip" : "Watch",
        skip ? `Watch the ${NAMES[s.type].toLowerCase()} for this show` : "Skip it again",
        () => setKeep(s.type)
      );
    } else {
      what = el("span", `what${fate === "skip" ? " skip" : ""}`, fate === "skip" ? "Skip" : "Watch");
    }
    legend.append(legendRow({ fate, name: NAMES[s.type], time: span(s.start, s.end), what }));

    // Right after the credits: the post-credits scene, one tap to skip it.
    if (s.type === "credits" && post) {
      const skipping = !!postMark;
      if (!skipping) bars.push({ start: post.start, end: post.end, watch: true });
      legend.append(
        legendRow({
          fate: skipping ? "skip" : "watch",
          name: "After credits",
          time: span(post.start, post.end),
          what: iconButton(
            `what${skipping ? " skip" : ""}`,
            "i-swap",
            skipping ? "Skip" : "Watch",
            skipping ? "Watch the post-credits scene again" : "Skip the post-credits scene on every episode",
            () => togglePostCredits(post)
          )
        })
      );
    }
  }

  for (const c of custom) {
    bars.push({ start: c.start, end: c.end, watch: false });
    if (c.label === POST_LABEL && post) continue; // shown as "After credits"
    legend.append(
      legendRow({
        fate: "skip",
        name: c.label || "Your skip",
        time: span(c.start, c.end),
        what: iconButton("what", "i-x", "Remove", "Stop skipping this part", () => removeMark(c.markId))
      })
    );
  }
  renderTimeline(bars, context.duration, context.time, false);
}

function renderExceptions() {
  const list = $("exceptions");
  list.replaceChildren();
  const ids = new Set([...Object.keys(settings.showExceptions), ...Object.keys(settings.marks)]);
  $("exceptionCount").textContent = String(ids.size);
  $("noExceptions").hidden = ids.size > 0;
  for (const id of ids) {
    const ex = settings.showExceptions[id];
    const marks = marksFor(id);
    const parts = [];
    const kept = ex ? Object.keys(NAMES).filter((t) => ex.keep && ex.keep[t]).map((t) => NAMES[t].toLowerCase()) : [];
    if (kept.length) parts.push(`Watching the ${kept.join(", ")}`);
    if (marks.some((m) => m.label === POST_LABEL)) parts.push("skipping post-credits");
    const own = marks.filter((m) => m.label !== POST_LABEL).length;
    if (own) parts.push(`${own} custom skip${own === 1 ? "" : "s"}`);
    const title = (ex && ex.title) || (settings.marks[id] && settings.marks[id].title) || id;
    const summary = parts.join(" · ");

    const li = el("li");
    const text = el("span");
    text.append(el("b", "", title), el("small", "", summary.charAt(0).toUpperCase() + summary.slice(1)));
    const remove = el("button", "link", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      const next = { ...settings.showExceptions };
      delete next[id];
      saveSettings({ showExceptions: next });
      chrome.storage.sync.remove(C.MARK_PREFIX + id);
      renderAll();
    });
    li.append(text, remove);
    list.append(li);
  }
}

// ---- marks ---------------------------------------------------------------------

function markTitle() {
  const s = context.series;
  return (s && s.title) || context.episodeTitle || "";
}

function togglePostCredits(post) {
  const key = context.marksKey;
  const has = marksFor(key).some((m) => m.label === POST_LABEL);
  const showWide = !!(context.series && context.series.id);
  C.updateMarks(key, markTitle(), (list) => {
    if (has) return list.filter((m) => m.label !== POST_LABEL);
    const mark = {
      id: C.newMarkId(),
      s: { a: "credits.end", o: 0 },
      e: post.hasPreview ? { a: "preview.start", o: 0 } : { a: "end", o: 0 },
      label: POST_LABEL
    };
    if (!showWide) mark.ep = context.episodeId;
    return [...list, mark];
  }).then(askContext);
}

function removeMark(markId) {
  const keys = new Set([context.marksKey, `EP_${context.episodeId}`]);
  Promise.all([...keys].map((k) => C.updateMarks(k, "", (list) => list.filter((m) => m.id !== markId)))).then(askContext);
}

function parseTime(str) {
  const text = String(str || "").trim();
  if (!text) return null;
  const parts = text.split(":").map((p) => (p.trim() === "" ? NaN : Number(p)));
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function openMarkForm() {
  const t = Number.isFinite(context.time) ? context.time : 0;
  const dur = context.duration || t + 30;
  $("mStart").value = C.formatTimestamp(t);
  $("mEnd").value = C.formatTimestamp(Math.min(dur, t + 30));
  const showWide = !!(context.series && context.series.id);
  $("scopeShow").disabled = !showWide;
  setScope(showWide ? "show" : "episode");
  $("mNote").classList.remove("error");
  $("mNote").innerHTML = 'Tip: in the player, press <kbd>Alt</kbd><kbd>Shift</kbd><kbd>M</kbd> at the start and again at the end.';
  $("markForm").hidden = false;
  $("addMark").hidden = true;
  $("mStart").focus();
  $("mStart").select();
}

function closeMarkForm() {
  $("markForm").hidden = true;
  $("addMark").hidden = !context || !context.episodeId;
}

function setScope(scope) {
  markScope = scope;
  for (const b of document.querySelectorAll("[data-scope]")) {
    b.setAttribute("aria-checked", String(b.dataset.scope === scope));
  }
}

function formError(text) {
  $("mNote").textContent = text;
  $("mNote").classList.add("error");
}

$("addMark").addEventListener("click", openMarkForm);
$("mCancel").addEventListener("click", closeMarkForm);
for (const b of document.querySelectorAll("[data-scope]")) b.addEventListener("click", () => setScope(b.dataset.scope));
for (const b of document.querySelectorAll("[data-now]")) {
  b.addEventListener("click", () => {
    if (context && Number.isFinite(context.time)) $(b.dataset.now).value = C.formatTimestamp(context.time);
  });
}
$("mToEnd").addEventListener("click", () => {
  if (context && context.duration) $("mEnd").value = C.formatTimestamp(context.duration);
});

$("markForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!context || !context.episodeId) return;
  const dur = context.duration;
  const a = parseTime($("mStart").value);
  let b = parseTime($("mEnd").value);
  if (a === null || b === null) return formError("Use minutes:seconds, like 21:45");
  // Typed the end as shown (whole seconds): treat "the last second" as the end.
  if (dur && b >= Math.floor(dur)) b = dur;
  if (b - a < 2) return formError("The end has to be at least 2 seconds after the start");
  if (dur && a >= dur) return formError("The start is past the end of the episode");
  const id = C.newMarkId();
  const mark =
    markScope === "show"
      ? { id, s: P.anchorPoint(a, context.segments, dur), e: P.anchorPoint(b, context.segments, dur), label: "" }
      : { id, s: { a: "start", o: a }, e: { a: "start", o: b }, label: "", ep: context.episodeId };
  C.updateMarks(context.marksKey, markTitle(), (list) => [...list, mark]).then(() => {
    closeMarkForm();
    askContext();
  });
});

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
$("firstOpening").addEventListener("change", (e) => saveSettings({ firstOpening: e.target.checked }));
$("seekMarkers").addEventListener("change", (e) => saveSettings({ seekMarkers: e.target.checked }));

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
    activeTabId = tab.id;
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
