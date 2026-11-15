// Main controller: watches the current episode, decides when to show the
// countdown, and carries out skips / next-episode jumps.
(() => {
  if (window.top !== window) return;
  // An older copy of this script can still be running in the tab (from before
  // the extension was reloaded or updated). The newest copy takes over.
  try {
    if (typeof window.__crasStop === "function") window.__crasStop();
  } catch {
    /* the old copy is already gone */
  }

  const C = globalThis.CRAS;
  const P = globalThis.CRAS_planner;
  const Page = globalThis.CRAS_page;
  const LOG = "[CR Autoskip]";
  const log = (...a) => console.debug(LOG, ...a);

  // How long after an episode change we ignore the player, while the old
  // video's currentTime may still be lingering.
  const SETTLE_MS = 1500;
  const NATIVE_SCAN_MS = 700;

  let settings = C.mergeSettings({});
  let sleep = { mode: "off", until: 0 };
  let binge = { count: 0 };
  // { [seriesId]: { seasons: [...], at } }: shows whose opening already played.
  let openings = {};

  const ep = {
    id: null,
    changedAt: 0,
    segments: [],
    hasData: false,
    series: null,
    // segment key -> "idle" | "done" | "cancelled"
    segState: new Map(),
    // Credits were skipped to show a post-credits scene; go next at the end.
    postScene: false,
    endHandled: false,
    // We navigated here ourselves (auto-advance), so make sure it plays.
    arrivedByAutoNext: false,
    nativeSeenAt: new Map(),
    // Custom marks resolved for this episode ([{ type: "custom", ... }]).
    custom: [],
    customDur: NaN,
    customStale: true,
    // Play the opening this time? undefined = not decided yet.
    watchOpening: undefined,
    openingRecorded: false
  };

  let video = null;
  let countdown = null; // { seg, plan, elapsed, last }
  let countdownTimer = 0;
  let selfSeekUntil = 0;
  let autoAdvancing = false;
  let lastNativeScan = 0;
  let nativeButtons = [];
  let hiddenNative = null;
  // Hotkey marking in progress: { episodeId, start }.
  let marking = null;
  let seekBar = null;
  let seekScanAt = 0;

  const overlay = globalThis.CRAS_overlay.createOverlay({
    onSkipNow: () => countdown && execute(),
    onCancel: () => cancelCountdown("user")
  });

  // ---- storage -------------------------------------------------------------

  function loadAll() {
    chrome.storage.sync.get(null, (s) => {
      settings = C.mergeSettings(s);
    });
    chrome.storage.local.get(["sleep", "binge", "openings"], (s) => {
      if (s.sleep) sleep = s.sleep;
      if (s.binge) binge = s.binge;
      if (s.openings) openings = s.openings;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      const wasEnabled = settings.enabled;
      const wasFirstOpening = settings.firstOpening;
      chrome.storage.sync.get(null, (s) => {
        settings = C.mergeSettings(s);
        ep.customStale = true;
        if (wasFirstOpening !== settings.firstOpening) ep.watchOpening = undefined;
        if (wasEnabled !== settings.enabled) {
          if (!settings.enabled) cancelCountdown("silent");
          overlay.toast(settings.enabled ? "Auto-skip on" : "Auto-skip off", 1800, settings.enabled);
        }
        // Re-evaluate segments the user just turned off/on.
        if (countdown && !eligible(countdown.seg.type)) cancelCountdown("silent");
      });
    }
    if (area === "local") {
      if (changes.sleep) sleep = changes.sleep.newValue || { mode: "off", until: 0 };
      if (changes.binge) binge = changes.binge.newValue || { count: 0 };
      if (changes.openings) openings = changes.openings.newValue || {};
    }
  });

  function setBinge(count) {
    binge = { count, at: Date.now() };
    chrome.storage.local.set({ binge });
  }

  function clearSleep() {
    sleep = { mode: "off", until: 0 };
    chrome.storage.local.set({ sleep });
  }

  function recordStat(kind, seconds) {
    if (!(seconds > 0)) return;
    try {
      chrome.runtime.sendMessage({
        type: "cras:stat",
        kind,
        seconds,
        seriesId: seriesId() || "",
        seriesTitle: (ep.series && ep.series.title) || "",
        episodeId: ep.id || ""
      });
    } catch {
      /* extension reloaded */
    }
  }

  // ---- episode tracking ----------------------------------------------------

  function checkEpisode() {
    const id = Page.episodeIdFromUrl(location.pathname);
    if (id === ep.id) {
      if (id && (!ep.series || !ep.series.title)) {
        const found = Page.getSeries();
        if (found && (!ep.series || found.id === ep.series.id)) {
          if (!ep.series) ep.customStale = true;
          ep.series = found;
        }
      }
      return;
    }
    const previous = ep.id;
    cancelCountdown("silent");
    overlay.hideNotice();
    ep.id = id;
    ep.changedAt = Date.now();
    ep.segments = [];
    ep.hasData = false;
    ep.series = null;
    ep.segState = new Map();
    ep.postScene = false;
    ep.endHandled = false;
    ep.nativeSeenAt = new Map();
    ep.custom = [];
    ep.customDur = NaN;
    ep.customStale = true;
    ep.watchOpening = undefined;
    ep.openingRecorded = false;
    overlay.setMarkers([], 0);
    if (marking) {
      marking = null;
      overlay.hideToast();
    }
    ep.arrivedByAutoNext = autoAdvancing && !!id;
    // Choosing an episode yourself resets the binge counter.
    if (previous && id && !autoAdvancing && binge.count) setBinge(0);
    autoAdvancing = false;
    if (!id) return;

    log("episode", id);
    chrome.runtime.sendMessage({ type: "cras:getSkipEvents", episodeId: id }, (res) => {
      if (chrome.runtime.lastError || ep.id !== id) return;
      ep.segments = P.normalizeEvents(res && res.data);
      ep.hasData = ep.segments.length > 0;
      if (!ep.series && res && res.data && res.data.seriesId) {
        ep.series = { id: String(res.data.seriesId).toUpperCase(), title: "" };
      }
      ep.customStale = true;
      log("segments", ep.segments);
    });
  }

  function seriesId() {
    return ep.series && ep.series.id;
  }

  function eligible(type) {
    if (type === "intro" && watchingOpening()) return false;
    return P.isEligible(type, settings, seriesId());
  }

  function segKey(seg) {
    if (seg.source === "native") return `native:${seg.type}`;
    if (seg.type === "custom") return `custom:${seg.markId}`;
    return `${seg.type}@${seg.start}`;
  }

  // Crunchyroll's segments plus the viewer's own marks, in time order.
  function allSegments() {
    return ep.custom.length ? [...ep.segments, ...ep.custom].sort((a, b) => a.start - b.start) : ep.segments;
  }

  // ---- custom marks ----------------------------------------------------------

  function marksKey() {
    return seriesId() || `EP_${ep.id}`;
  }

  function refreshCustom() {
    const dur = video && video.duration > 0 ? video.duration : NaN;
    const list = [];
    const sid = seriesId();
    if (sid && settings.marks[sid]) list.push(...settings.marks[sid].list);
    if (settings.marks[`EP_${ep.id}`]) list.push(...settings.marks[`EP_${ep.id}`].list);
    ep.custom = P.resolveMarks(list, { episodeId: ep.id, segments: ep.segments, duration: dur });
    ep.customDur = dur;
    ep.customStale = false;
    // The mark being counted down was just removed.
    if (countdown && countdown.seg.type === "custom" && !ep.custom.some((c) => c.markId === countdown.seg.markId)) {
      cancelCountdown("silent");
    }
  }

  // Hotkey: first press marks the start, second press the end.
  function onMarkCommand(shortcut) {
    if (!ep.id || !video || !(video.duration > 0)) {
      overlay.toast("Open an episode to mark a part to skip", 2400);
      return;
    }
    const t = video.currentTime;
    if (!marking || marking.episodeId !== ep.id) {
      marking = { episodeId: ep.id, start: t };
      overlay.toast(`Skipping from ${C.formatTimestamp(t)}. Press ${shortcut} where it ends (Esc cancels)`, 0, true);
      return;
    }
    const a = Math.min(marking.start, t);
    const b = Math.max(marking.start, t);
    marking = null;
    if (b - a < 2) {
      overlay.toast("That's too short. Mark the start and end again", 2400);
      return;
    }
    saveMark(a, b);
  }

  function saveMark(a, b) {
    const sid = seriesId();
    const dur = video.duration;
    const id = C.newMarkId();
    const round = (x) => Math.round(x * 10) / 10;
    const mark = sid
      ? { id, s: P.anchorPoint(a, ep.segments, dur), e: P.anchorPoint(b, ep.segments, dur), label: "" }
      : { id, s: { a: "start", o: round(a) }, e: { a: "start", o: round(b) }, label: "", ep: ep.id };
    // Don't immediately skip the part we're standing in.
    ep.segState.set(`custom:${id}`, "done");
    const title = sid ? (ep.series && ep.series.title) || "" : Page.getEpisodeTitle();
    C.updateMarks(marksKey(), title, (list) => [...list, mark]);
    const where = sid ? `every episode of ${(ep.series && ep.series.title) || "this show"}` : "this episode";
    overlay.toast(`Skipping ${C.formatTimestamp(a)}–${C.formatTimestamp(b)} on ${where}`, 3800, true);
    log("mark", mark);
  }

  // ---- openings --------------------------------------------------------------

  function watchingOpening() {
    if (ep.watchOpening !== undefined) return ep.watchOpening;
    if (!settings.firstOpening) return false;
    const sid = seriesId();
    // Wait until the page shows the new episode's title before deciding.
    if (!sid || Date.now() - ep.changedAt < SETTLE_MS) return false;
    ep.watchOpening = P.shouldWatchOpening({
      enabled: true,
      record: openings[sid],
      season: Page.getSeason(),
      episodeNumber: Page.getEpisodeNumber()
    });
    if (ep.watchOpening) log("letting the opening play this time");
    return ep.watchOpening;
  }

  function recordOpening() {
    ep.openingRecorded = true;
    const sid = seriesId();
    if (!sid) return;
    const rec = openings[sid] || {};
    const season = Page.getSeason() || "";
    const seasons = [...new Set([...(Array.isArray(rec.seasons) ? rec.seasons : []), season])].slice(-20);
    const next = { ...openings, [sid]: { seasons, at: Date.now() } };
    const ids = Object.keys(next);
    if (ids.length > 300) {
      ids.sort((x, y) => (next[x].at || 0) - (next[y].at || 0));
      for (const old of ids.slice(0, ids.length - 300)) delete next[old];
    }
    openings = next;
    chrome.storage.local.set({ openings });
  }

  // ---- seek bar markers --------------------------------------------------------

  function updateMarkers() {
    if (!settings.enabled || !settings.seekMarkers || !video || !(video.duration > 0)) {
      overlay.setSeekBar(null, 0);
      return;
    }
    const now = Date.now();
    if (now - seekScanAt > (seekBar && seekBar.isConnected ? 3000 : 1000)) {
      seekScanAt = now;
      const found = Page.findSeekBar(video);
      if (found !== seekBar) log("seek bar", found);
      seekBar = found;
    }
    const dur = video.duration;
    const list = allSegments()
      .filter((sg) => eligible(sg.type) && stateOf(sg) !== "cancelled")
      .map((sg) => ({ start: sg.start, end: P.effectiveEnd(sg, dur) }));
    overlay.setMarkers(list, dur);
    overlay.setSeekBar(seekBar, seekBar ? Page.effectiveOpacity(seekBar) : 0);
  }

  function stateOf(seg) {
    return ep.segState.get(segKey(seg)) || "idle";
  }

  // ---- video ---------------------------------------------------------------

  function attachVideo(v) {
    if (v === video) return;
    if (video) {
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("ended", onEnded);
    }
    video = v;
    overlay.setVideo(v);
    if (v) {
      v.addEventListener("seeking", onSeeking);
      v.addEventListener("ended", onEnded);
    }
  }

  function selfSeek(target) {
    selfSeekUntil = Date.now() + 800;
    video.currentTime = target;
  }

  // The viewer scrubbed. Re-arm segments they went back before, and drop a
  // countdown whose segment they left.
  function onSeeking() {
    if (Date.now() < selfSeekUntil || !video) return;
    const t = video.currentTime;
    for (const seg of allSegments()) {
      if (t < seg.start - 0.5) ep.segState.delete(segKey(seg));
      if (seg.type === "credits" && t < seg.start) {
        ep.postScene = false;
        ep.endHandled = false;
      }
    }
    for (const [type, at] of ep.nativeSeenAt) {
      if (t < at - 2) {
        ep.segState.delete(`native:${type}`);
        ep.nativeSeenAt.delete(type);
      }
    }
    if (countdown && countdown.seg.source === "data") {
      const s = countdown.seg;
      if (t < s.start - 0.5 || t >= P.effectiveEnd(s, video.duration) - 0.25) cancelCountdown("silent");
    }
    if (countdown && countdown.seg.source === "end" && video.duration > 0 && t < video.duration - 3) {
      cancelCountdown("silent");
      ep.endHandled = false;
    }
  }

  function onEnded() {
    if (!settings.enabled || !ep.postScene || ep.endHandled) return;
    ep.endHandled = true;
    if (settings.autoNext) startCountdown({ type: "end", source: "end", start: 0, end: Infinity });
  }

  // ---- main loop -----------------------------------------------------------

  // False once the extension has been reloaded, updated or removed: this copy
  // of the script is orphaned and every chrome.* call would throw.
  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  let tickTimer = 0;
  let stopped = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(tickTimer);
    clearInterval(countdownTimer);
    countdown = null;
    restoreNativeButton();
    overlay.destroy();
    document.removeEventListener("keydown", onKeyDown, true);
    if (window.__crasStop === stop) window.__crasStop = null;
    log("stopped (extension reloaded or updated)");
  }
  window.__crasStop = stop;

  function tick() {
    if (!alive()) return stop();
    checkEpisode();
    attachVideo(Page.getMainVideo());
    if (!ep.id || !video) return;

    checkSleepTimer();
    if (!settings.enabled) return updateMarkers();
    if (Date.now() - ep.changedAt < SETTLE_MS || video.readyState < 2) return;

    const dur0 = video.duration > 0 ? video.duration : NaN;
    if (ep.customStale || !Object.is(dur0, ep.customDur)) refreshCustom();
    updateMarkers();

    // Remember that this show's opening has been heard.
    if (!ep.openingRecorded && watchingOpening()) {
      const intro = ep.segments.find((sg) => sg.type === "intro");
      const now = video.currentTime;
      if (intro && now >= intro.start + 5 && now < intro.end + 30) recordOpening();
    }

    if (ep.arrivedByAutoNext) {
      ep.arrivedByAutoNext = false;
      if (video.paused) video.play().catch(() => {});
    }

    if (countdown) {
      validateCountdown();
      return;
    }
    if (overlay.isNoticeVisible()) return;

    const t = video.currentTime;
    const dur = video.duration;

    // "Stop after this episode": pause just before the end so Crunchyroll's
    // own autoplay never kicks in.
    if (sleep.mode === "episode" && dur > 0 && t >= dur - 1 && !video.paused) return stopForGate("sleep");

    const seg = P.findTrigger(allSegments(), t, dur, eligible, stateOf);
    if (seg) return startCountdown(seg);

    // Post-credits scene finished: offer the next episode just before the end.
    if (ep.postScene && !ep.endHandled && settings.autoNext && dur > 0 && t >= dur - 1.5) {
      ep.endHandled = true;
      return startCountdown({ type: "end", source: "end", start: 0, end: Infinity });
    }

    scanNative(t);
  }

  // Fallback for episodes without skip-events data: react to Crunchyroll's
  // own skip buttons, for segment types the data doesn't cover.
  function scanNative(t) {
    const now = Date.now();
    if (now - lastNativeScan < NATIVE_SCAN_MS) return;
    lastNativeScan = now;
    nativeButtons = Page.findNativeSkipButtons(overlay.host);
    for (const { el, type } of nativeButtons) {
      if (ep.segments.some((s) => s.type === type)) continue;
      if (type === "intro" && !ep.openingRecorded && watchingOpening()) recordOpening();
      if (!eligible(type)) continue;
      const seg = { type, source: "native", el, start: t, end: Infinity };
      if (stateOf(seg) !== "idle") continue;
      if (!ep.nativeSeenAt.has(type)) ep.nativeSeenAt.set(type, t);
      return startCountdown(seg);
    }
  }

  // ---- countdown -----------------------------------------------------------

  function buildPlan(seg) {
    const dur = video.duration;
    const endSafe = (x) => (dur > 0 ? Math.min(x, dur - 0.3) : x);
    const nextAvailable = () => !!Page.findNextEpisode(ep.id);

    if (seg.source === "native") {
      return { action: "click", text: C.LABELS[seg.type], kind: "skip" };
    }
    if (seg.type === "intro" || seg.type === "recap") {
      return { action: "seek", target: endSafe(seg.end), text: C.LABELS[seg.type], kind: "skip" };
    }
    if (seg.type === "credits") {
      const p = P.planCredits({ credits: seg, segments: allSegments(), duration: dur, settings, eligible });
      if (p.kind === "next" && nextAvailable()) return { action: "next", text: C.LABELS.next, kind: "next" };
      return { action: "seek", target: endSafe(p.target), postScene: !!p.postScene, text: C.LABELS.credits, kind: "skip" };
    }
    if (seg.type === "custom") {
      const p = P.planCustom({ seg, segments: allSegments(), duration: dur, settings, eligible });
      if (p.kind === "next" && nextAvailable()) return { action: "next", text: C.LABELS.next, kind: "next" };
      return { action: "seek", target: endSafe(p.target), postScene: !!p.postScene, text: C.LABELS.custom, kind: "skip" };
    }
    if (seg.type === "preview") {
      const p = P.planPreview({ preview: seg, settings });
      if (p.kind === "next" && nextAvailable()) return { action: "next", text: C.LABELS.next, kind: "next" };
      return { action: "seek", target: endSafe(seg.end), text: C.LABELS.preview, kind: "skip" };
    }
    if (seg.type === "end") {
      return nextAvailable() ? { action: "next", text: C.LABELS.next, kind: "next" } : null;
    }
    return null;
  }

  function startCountdown(seg) {
    const plan = buildPlan(seg);
    if (!plan) {
      ep.segState.set(segKey(seg), "done");
      return;
    }
    countdown = { seg, plan, elapsed: 0, last: performance.now() };
    log("countdown", seg.type, plan);
    if (settings.delay <= 0) return execute();

    if (seg.source === "native") hideNativeButton(seg.el);
    else {
      const native = nativeButtons.find((b) => b.type === seg.type);
      if (native) hideNativeButton(native.el);
    }
    overlay.showCountdown({ text: plan.text, kind: plan.kind });
    clearInterval(countdownTimer);
    countdownTimer = setInterval(stepCountdown, 50);
  }

  function stepCountdown() {
    if (!countdown) return;
    if (!alive()) return stop();
    const now = performance.now();
    // Clamp so a throttled background tab doesn't jump straight to the end.
    const dt = Math.min(now - countdown.last, 1100);
    countdown.last = now;
    // Pausing freezes the countdown; it resumes when playback does.
    const frozen = !!video && video.paused && !video.ended;
    if (!frozen) countdown.elapsed += dt;
    const total = settings.delay * 1000;
    overlay.setProgress(countdown.elapsed / total, frozen);
    if (countdown.elapsed >= total) execute();
  }

  function validateCountdown() {
    const seg = countdown.seg;
    if (seg.source === "native") {
      // The native button vanished: the player finished that segment itself.
      // (Its visibility is ours to hide, so only removal/display/size count.)
      const el = seg.el;
      if (!el.isConnected || getComputedStyle(el).display === "none" || el.getBoundingClientRect().width < 4) {
        cancelCountdown("silent", "done");
      }
      return;
    }
    if (seg.source === "data") {
      const t = video.currentTime;
      if (t < seg.start - 0.5 || t >= P.effectiveEnd(seg, video.duration) - 0.25) cancelCountdown("silent");
    }
  }

  function cancelCountdown(reason, mark) {
    if (!countdown) return;
    clearInterval(countdownTimer);
    const { seg } = countdown;
    countdown = null;
    overlay.hideCountdown();
    restoreNativeButton();
    // A user cancel sticks for this episode (until they seek back before it).
    if (reason === "user") ep.segState.set(segKey(seg), "cancelled");
    else if (mark) ep.segState.set(segKey(seg), mark);
    if (reason === "user" && seg.type === "credits") ep.endHandled = true;
    log("cancel", seg.type, reason);
  }

  function execute() {
    if (!countdown) return;
    if (!alive()) return stop();
    clearInterval(countdownTimer);
    const { seg, plan } = countdown;
    countdown = null;
    overlay.hideCountdown();
    restoreNativeButton();
    ep.segState.set(segKey(seg), "done");
    if (!video) return;
    const t = video.currentTime;

    if (plan.action === "seek") {
      recordStat(seg.type, P.secondsSaved(t, plan.target));
      selfSeek(plan.target);
      if (plan.postScene) ep.postScene = true;
    } else if (plan.action === "click") {
      try {
        seg.el.click();
      } catch {
        /* gone */
      }
      // We don't know where the native button jumps to; measure it.
      setTimeout(() => video && recordStat(seg.type, P.secondsSaved(t, video.currentTime)), 900);
    } else if (plan.action === "next") {
      goNext(seg.type);
    }
  }

  // ---- next episode, binge limit, sleep timer -------------------------------

  function goNext(fromType) {
    const gate = P.nextEpisodeGate({ settings, binge, sleep });
    if (gate) return stopForGate(gate);

    const next = Page.findNextEpisode(ep.id);
    const dur = video.duration;
    recordStat(fromType === "end" ? "next" : fromType, dur > 0 ? P.secondsSaved(video.currentTime, dur) : 0);
    setBinge(binge.count + 1);
    if (!next) {
      // No next episode found: jump to the end and let Crunchyroll's own
      // autoplay take it from there.
      if (dur > 0) selfSeek(dur - 0.25);
      return;
    }
    autoAdvancing = true;
    const fromId = ep.id;
    log("next via", next.via, next.href || "");
    next.el.click();
    if (next.href) {
      // If the SPA router didn't pick the click up, navigate directly.
      setTimeout(() => {
        if (Page.episodeIdFromUrl(location.pathname) === fromId) location.assign(next.href);
      }, 2000);
    }
  }

  function stopForGate(gate) {
    video.pause();
    if (gate === "sleep") {
      clearSleep();
      overlay.showNotice({
        title: "Sleep timer",
        body: "Stopped at the end of the episode, like you asked.",
        actions: [{ text: "Keep watching", primary: true, onClick: () => goNext("credits") }, { text: "Dismiss" }]
      });
    } else {
      overlay.showNotice({
        title: "Still watching?",
        body: `You've auto-played ${binge.count} episode${binge.count === 1 ? "" : "s"} in a row.`,
        actions: [
          {
            text: "Next episode",
            primary: true,
            onClick: () => {
              setBinge(0);
              goNext("credits");
            }
          },
          { text: "Dismiss", onClick: () => setBinge(0) }
        ]
      });
    }
  }

  function checkSleepTimer() {
    if (sleep.mode !== "time" || !(sleep.until > 0) || Date.now() < sleep.until) return;
    clearSleep();
    if (!video.paused) video.pause();
    cancelCountdown("silent");
    overlay.showNotice({
      title: "Sleep timer",
      body: "Playback paused. Goodnight!",
      actions: [{ text: "Resume", primary: true, onClick: () => video && video.play().catch(() => {}) }]
    });
  }

  // ---- native button hiding -------------------------------------------------

  function hideNativeButton(el) {
    restoreNativeButton();
    if (!el) return;
    hiddenNative = { el, prev: el.style.visibility };
    el.style.visibility = "hidden";
  }

  function restoreNativeButton() {
    if (!hiddenNative) return;
    hiddenNative.el.style.visibility = hiddenNative.prev;
    hiddenNative = null;
  }

  // ---- keyboard --------------------------------------------------------------

  function onKeyDown(e) {
    if (!alive()) return stop();
    {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (marking && e.key === "Escape" && !countdown) {
        marking = null;
        overlay.toast("Marking cancelled", 1600);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!countdown || !overlay.isCountdownVisible()) return;
      if (e.key === "Escape") cancelCountdown("user");
      else if (e.key === "Enter") execute();
      else return;
      // Esc would also exit fullscreen in the player; we only meant the skip.
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  document.addEventListener("keydown", onKeyDown, true);

  // ---- popup bridge ----------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "cras:getContext") {
      checkEpisode();
      sendResponse({
        episodeId: ep.id,
        series: ep.series,
        marksKey: ep.id ? marksKey() : null,
        hasData: ep.hasData,
        segments: ep.segments.map(({ type, start, end }) => ({ type, start, end })),
        custom: ep.custom.map(({ start, end, label, markId }) => ({ start, end, label, markId })),
        watchOpening: !!ep.id && watchingOpening() && ep.segments.some((sg) => sg.type === "intro"),
        marking: !!marking,
        duration: video && video.duration > 0 ? video.duration : null,
        time: video ? video.currentTime : null,
        episodeTitle: Page.getEpisodeTitle()
      });
    } else if (msg.type === "cras:mark") {
      onMarkCommand(String(msg.shortcut || "the mark shortcut"));
      sendResponse(true);
    } else if (msg.type === "cras:skipOpening") {
      // "Skip it" from the popup: this opening counts as heard.
      ep.watchOpening = false;
      recordOpening();
      sendResponse(true);
    }
  });

  loadAll();
  tickTimer = setInterval(tick, 250);
  tick();
})();
