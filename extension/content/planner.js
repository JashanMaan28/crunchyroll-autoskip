// Pure decision logic: no DOM, no chrome.* — unit-tested in test/planner.test.js.
(function (root) {
  const TYPES = ["recap", "intro", "credits", "preview"];

  // A countdown only starts if at least this much of the segment is left,
  // so we never flash a button for a segment that is about to end anyway.
  const MIN_REMAINING = 1;
  // Tolerance for "the preview starts right after the credits".
  const ADJACENT_SLOP = 2;

  // Turn Crunchyroll's skip-events JSON into a sorted list of segments.
  // Shape: { intro: { start, end, type, ... }, credits: {...}, recap: {}, preview: {} }
  // Empty objects and segments without both times are common and ignored.
  function normalizeEvents(json) {
    const out = [];
    if (!json || typeof json !== "object") return out;
    for (const type of TYPES) {
      const ev = json[type];
      if (!ev || typeof ev !== "object") continue;
      if (ev.start === null || ev.end === null || ev.start === undefined || ev.end === undefined) continue;
      const start = Number(ev.start);
      const end = Number(ev.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end - start < 1) continue;
      out.push({ type, start: Math.max(0, start), end, source: "data" });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // Is this segment type something we should skip right now, considering the
  // global toggles and the per-show "watch the OP/ED" exceptions?
  function isEligible(type, settings, seriesId) {
    if (!settings.enabled) return false;
    if (!settings.segments[type]) return false;
    const ex = seriesId && settings.showExceptions && settings.showExceptions[seriesId];
    if (ex && ex.keep && ex.keep[type]) return false;
    return true;
  }

  function effectiveEnd(seg, duration) {
    return Number.isFinite(duration) && duration > 0 ? Math.min(seg.end, duration) : seg.end;
  }

  // Which data segment (if any) should start a countdown at time t?
  // `stateOf(seg)` returns "idle" | "done" | "cancelled".
  function findTrigger(segments, t, duration, eligible, stateOf) {
    for (const seg of segments) {
      if (!eligible(seg.type)) continue;
      if (stateOf(seg) !== "idle") continue;
      const end = effectiveEnd(seg, duration);
      if (t >= seg.start - 0.25 && t < end - MIN_REMAINING) return seg;
    }
    return null;
  }

  // The "smart" credits decision.
  //  - autoNext off            -> just seek past the credits
  //  - real footage after them -> seek past the credits so the post-credits
  //                               scene plays (next episode is handled later)
  //  - nothing worth watching  -> go straight to the next episode
  // A preview right after the credits doesn't count as a scene when previews
  // are being skipped.
  function planCredits({ credits, segments, duration, settings, eligible }) {
    if (!settings.autoNext) return { kind: "seek", target: credits.end };
    const preview = segments.find(
      (s) => s.type === "preview" && s.start >= credits.end - ADJACENT_SLOP
    );
    const hasDuration = Number.isFinite(duration) && duration > 0;
    const contentEnd = preview && eligible("preview") ? preview.start : hasDuration ? duration : credits.end;
    const tail = contentEnd - credits.end;
    if (tail >= settings.postCreditsMin) {
      return { kind: "seek", target: credits.end, postScene: true };
    }
    return { kind: "next" };
  }

  function planPreview({ preview, settings }) {
    if (settings.autoNext) return { kind: "next" };
    return { kind: "seek", target: preview.end };
  }

  // Should the extension refuse to auto-advance right now?
  // Returns null when advancing is fine, otherwise a reason.
  function nextEpisodeGate({ settings, binge, sleep }) {
    if (sleep && sleep.mode === "episode") return "sleep";
    if (settings.bingeLimit > 0 && binge && binge.count >= settings.bingeLimit) return "binge";
    return null;
  }

  // Seconds of video a skip saved, for the stats counter.
  function secondsSaved(from, to) {
    const d = Number(to) - Number(from);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  const api = {
    TYPES,
    MIN_REMAINING,
    normalizeEvents,
    isEligible,
    effectiveEnd,
    findTrigger,
    planCredits,
    planPreview,
    nextEpisodeGate,
    secondsSaved
  };

  root.CRAS_planner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
