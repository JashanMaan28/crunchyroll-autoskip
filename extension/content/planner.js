// Pure decision logic: no DOM, no chrome.* — unit-tested in test/planner.test.js.
(function (root) {
  const TYPES = ["recap", "intro", "credits", "preview"];

  // A countdown only starts if at least this much of the segment is left,
  // so we never flash a button for a segment that is about to end anyway.
  const MIN_REMAINING = 1;
  // Tolerance for "the preview starts right after the credits".
  const ADJACENT_SLOP = 2;
  // A custom mark this close to a known edge (credits end, episode end...)
  // snaps onto it, so it lands in the same place on every episode.
  const SNAP = 1.5;

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
    // Custom marks are opt-in one by one, so they're always on.
    if (type === "custom") return true;
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

  // Where a skip that ends at `from` should really land: straight through any
  // custom marks that start right there (e.g. a post-credits scene the
  // viewer marked), so it's one countdown instead of two.
  function chainEnd(from, segments, eligible) {
    let cur = from;
    for (let moved = true; moved; ) {
      moved = false;
      for (const s of segments) {
        if (s.type !== "custom" || !eligible("custom")) continue;
        if (s.start <= cur + ADJACENT_SLOP && s.end > cur + 0.01) {
          cur = s.end;
          moved = true;
        }
      }
    }
    return cur;
  }

  // Seconds of footage after `from` that will actually be watched: up to a
  // skipped preview (or the end), minus custom marks in between.
  function watchableAfter(from, segments, duration, eligible) {
    const hasDuration = Number.isFinite(duration) && duration > 0;
    const preview = segments.find((s) => s.type === "preview" && s.start >= from - ADJACENT_SLOP);
    const end = preview && eligible("preview") ? Math.max(from, preview.start) : hasDuration ? duration : from;
    if (end <= from) return 0;
    const spans = segments
      .filter((s) => s.type === "custom" && eligible("custom") && s.end > from && s.start < end)
      .map((s) => [Math.max(from, s.start), Math.min(end, s.end)])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cur = null;
    for (const [a, b] of spans) {
      if (!cur || a > cur[1]) {
        if (cur) covered += cur[1] - cur[0];
        cur = [a, b];
      } else cur[1] = Math.max(cur[1], b);
    }
    if (cur) covered += cur[1] - cur[0];
    return Math.max(0, end - from - covered);
  }

  // The "smart" credits decision.
  //  - autoNext off            -> just seek past the credits
  //  - real footage after them -> seek past the credits so the post-credits
  //                               scene plays (next episode is handled later)
  //  - nothing worth watching  -> go straight to the next episode
  // A preview right after the credits doesn't count as a scene when previews
  // are being skipped, and neither does anything the viewer marked to skip.
  function planCredits({ credits, segments, duration, settings, eligible }) {
    const target = chainEnd(credits.end, segments, eligible);
    if (!settings.autoNext) return { kind: "seek", target };
    if (watchableAfter(target, segments, duration, eligible) >= settings.postCreditsMin) {
      return { kind: "seek", target, postScene: true };
    }
    return { kind: "next", target };
  }

  // A custom mark: seek past it, or go to the next episode when nothing
  // worth watching is left after it.
  function planCustom({ seg, segments, duration, settings, eligible }) {
    const target = chainEnd(seg.end, segments, eligible);
    if (!settings.autoNext || !(Number.isFinite(duration) && duration > 0)) return { kind: "seek", target };
    const credits = segments.find((s) => s.type === "credits");
    const pastCredits = !credits || seg.start >= credits.start - ADJACENT_SLOP;
    if (pastCredits && watchableAfter(target, segments, duration, eligible) < settings.postCreditsMin) {
      return { kind: "next", target };
    }
    return { kind: "seek", target, postScene: !!credits && pastCredits };
  }

  // ---- custom marks ---------------------------------------------------------

  // Describe time `t` relative to the nearest known edge, so a mark made on
  // one episode lands on the same moment in the others.
  function anchorPoint(t, segments, duration) {
    const cands = [{ a: "start", at: 0 }];
    if (Number.isFinite(duration) && duration > 0) cands.push({ a: "end", at: duration });
    for (const s of segments) {
      if (!TYPES.includes(s.type)) continue;
      cands.push({ a: `${s.type}.start`, at: s.start }, { a: `${s.type}.end`, at: effectiveEnd(s, duration) });
    }
    let best = cands[0];
    for (const c of cands) if (Math.abs(t - c.at) < Math.abs(t - best.at)) best = c;
    let o = t - best.at;
    if (Math.abs(o) <= SNAP) o = 0;
    return { a: best.a, o: Math.round(o * 10) / 10 };
  }

  function resolvePoint(p, segments, duration) {
    const hasDuration = Number.isFinite(duration) && duration > 0;
    let at;
    if (p.a === "start") at = 0;
    else if (p.a === "end") {
      if (!hasDuration) return null;
      at = duration;
    } else {
      const [type, edge] = String(p.a).split(".");
      const seg = segments.find((s) => s.type === type);
      if (seg) at = edge === "start" ? seg.start : effectiveEnd(seg, duration);
      // No preview this time: "until the preview" means until the end.
      else if (type === "preview" && edge === "start" && hasDuration) at = duration;
      else return null;
    }
    let v = at + (Number(p.o) || 0);
    if (hasDuration) v = Math.min(v, duration);
    return Math.max(0, v);
  }

  // Turn stored marks into segments for this episode. Marks whose anchors
  // don't exist here (no credits data, say) are left out.
  function resolveMarks(list, { episodeId, segments, duration }) {
    const out = [];
    for (const m of list || []) {
      if (m.ep && m.ep !== episodeId) continue;
      const start = resolvePoint(m.s, segments, duration);
      const end = resolvePoint(m.e, segments, duration);
      if (start === null || end === null || end - start < 1) continue;
      out.push({ type: "custom", start, end, source: "data", label: m.label || "", markId: m.id });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // ---- openings -------------------------------------------------------------

  // Play the opening instead of skipping it? Yes for a show you've never
  // heard it on, on every episode 1, and on a season you haven't seen yet.
  // `record` = { seasons: [...] } saved the last time an opening played.
  function shouldWatchOpening({ enabled, record, season, episodeNumber }) {
    if (!enabled) return false;
    if (!record) return true;
    if (episodeNumber === 1) return true;
    const seasons = Array.isArray(record.seasons) ? record.seasons : [];
    return !!season && !seasons.includes(season);
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
    chainEnd,
    watchableAfter,
    planCredits,
    planCustom,
    anchorPoint,
    resolvePoint,
    resolveMarks,
    shouldWatchOpening,
    planPreview,
    nextEpisodeGate,
    secondsSaved
  };

  root.CRAS_planner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
