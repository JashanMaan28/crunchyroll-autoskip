// Main controller: watches the current episode, decides when to show the
// countdown, and carries out skips / next-episode jumps.
(() => {
  if (window.top !== window || window.__crasLoaded) return;
  window.__crasLoaded = true;

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
    nativeSeenAt: new Map()
  };

  let video = null;
  let countdown = null; // { seg, plan, elapsed, last }
  let countdownTimer = 0;
  let selfSeekUntil = 0;
  let autoAdvancing = false;
  let lastNativeScan = 0;
  let nativeButtons = [];
  let hiddenNative = null;

  const overlay = globalThis.CRAS_overlay.createOverlay({
    onSkipNow: () => countdown && execute(),
    onCancel: () => cancelCountdown("user")
  });

  // ---- storage -------------------------------------------------------------

  function loadAll() {
    chrome.storage.sync.get(null, (s) => {
      settings = C.mergeSettings(s);
    });
    chrome.storage.local.get(["sleep", "binge"], (s) => {
      if (s.sleep) sleep = s.sleep;
      if (s.binge) binge = s.binge;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      const wasEnabled = settings.enabled;
      chrome.storage.sync.get(null, (s) => {
        settings = C.mergeSettings(s);
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
      chrome.runtime.sendMessage({ type: "cras:stat", kind, seconds });
    } catch {
      /* extension reloaded */
    }
  }

  // ---- episode tracking ----------------------------------------------------

  function checkEpisode() {
    const id = Page.episodeIdFromUrl(location.pathname);
    if (id === ep.id) {
      if (id && !ep.series) ep.series = Page.getSeries();
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
      log("segments", ep.segments);
    });
  }

  function seriesId() {
    return ep.series && ep.series.id;
  }

  function eligible(type) {
    return P.isEligible(type, settings, seriesId());
  }

  function segKey(seg) {
    return seg.source === "native" ? `native:${seg.type}` : `${seg.type}@${seg.start}`;
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
    for (const seg of ep.segments) {
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

  function tick() {
    checkEpisode();
    attachVideo(Page.getMainVideo());
    if (!ep.id || !video) return;

    checkSleepTimer();
    if (!settings.enabled) return;
    if (Date.now() - ep.changedAt < SETTLE_MS || video.readyState < 2) return;

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

    const seg = P.findTrigger(ep.segments, t, dur, eligible, stateOf);
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
      const p = P.planCredits({ credits: seg, segments: ep.segments, duration: dur, settings, eligible });
      if (p.kind === "next" && nextAvailable()) return { action: "next", text: C.LABELS.next, kind: "next" };
      return { action: "seek", target: endSafe(seg.end), postScene: !!p.postScene, text: C.LABELS.credits, kind: "skip" };
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

  document.addEventListener(
    "keydown",
    (e) => {
      if (!countdown || !overlay.isCountdownVisible()) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") cancelCountdown("user");
      else if (e.key === "Enter") execute();
      else return;
      // Esc would also exit fullscreen in the player; we only meant the skip.
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );

  // ---- popup bridge ----------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "cras:getContext") {
      checkEpisode();
      sendResponse({
        episodeId: ep.id,
        series: ep.series,
        hasData: ep.hasData,
        segments: ep.segments.map(({ type, start, end }) => ({ type, start, end })),
        duration: video && video.duration > 0 ? video.duration : null,
        time: video ? video.currentTime : null,
        episodeTitle: Page.getEpisodeTitle()
      });
    }
  });

  loadAll();
  setInterval(tick, 250);
  tick();
})();
