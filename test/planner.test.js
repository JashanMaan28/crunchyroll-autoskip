const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../extension/shared/defaults.js");
const P = require("../extension/content/planner.js");

const settings = (over = {}) => C.mergeSettings(over);
const eligibleFor = (s, seriesId) => (type) => P.isEligible(type, s, seriesId);

test("normalizeEvents: real Crunchyroll payload, empty objects ignored, sorted", () => {
  const json = {
    intro: { approverId: "123", end: 100, seriesId: "G62PEZ2E6", start: 57, title: "", type: "intro" },
    credits: { end: 3993, start: 3719, type: "credits" },
    preview: {},
    recap: {},
    lastUpdated: "2024-02-24T20:57:57.827Z",
    mediaId: "GM8F313NQ"
  };
  assert.deepEqual(P.normalizeEvents(json), [
    { type: "intro", start: 57, end: 100, source: "data" },
    { type: "credits", start: 3719, end: 3993, source: "data" }
  ]);
});

test("normalizeEvents: junk input", () => {
  assert.deepEqual(P.normalizeEvents(null), []);
  assert.deepEqual(P.normalizeEvents("x"), []);
  assert.deepEqual(P.normalizeEvents({ intro: { start: 10, end: 10.5 } }), []);
  assert.deepEqual(P.normalizeEvents({ intro: { start: "a", end: 4 } }), []);
  assert.deepEqual(P.normalizeEvents({ intro: { start: null, end: 40 } }), []);
});

test("findTrigger: fires inside a segment, not near its end, not when done", () => {
  const segs = P.normalizeEvents({ intro: { start: 83, end: 173 }, credits: { start: 1423, end: 1440 } });
  const s = settings();
  const idle = () => "idle";
  assert.equal(P.findTrigger(segs, 50, 1440, eligibleFor(s), idle), null);
  assert.equal(P.findTrigger(segs, 83, 1440, eligibleFor(s), idle).type, "intro");
  assert.equal(P.findTrigger(segs, 172.5, 1440, eligibleFor(s), idle), null);
  assert.equal(P.findTrigger(segs, 100, 1440, eligibleFor(s), () => "done"), null);
  assert.equal(P.findTrigger(segs, 1430, 1440, eligibleFor(s), idle).type, "credits");
});

test("findTrigger: end is clamped to the real duration", () => {
  const segs = P.normalizeEvents({ credits: { start: 1330, end: 1500 } });
  const s = settings();
  assert.equal(P.findTrigger(segs, 1419.5, 1420, eligibleFor(s), () => "idle"), null);
});

test("isEligible: toggles and per-show exceptions", () => {
  const s = settings({
    segments: { intro: true, recap: false, credits: true, preview: true },
    showExceptions: { SHOW1: { title: "Frieren", keep: { intro: true } } }
  });
  assert.equal(P.isEligible("intro", s, "OTHER"), true);
  assert.equal(P.isEligible("intro", s, "SHOW1"), false);
  assert.equal(P.isEligible("credits", s, "SHOW1"), true);
  assert.equal(P.isEligible("recap", s, "OTHER"), false);
  assert.equal(P.isEligible("intro", settings({ enabled: false }), "OTHER"), false);
});

test("planCredits: credits at the very end -> next episode", () => {
  const segs = P.normalizeEvents({ credits: { start: 1330, end: 1420 } });
  const s = settings();
  const plan = P.planCredits({ credits: segs[0], segments: segs, duration: 1425, settings: s, eligible: eligibleFor(s) });
  assert.equal(plan.kind, "next");
});

test("planCredits: a post-credits scene is kept", () => {
  const segs = P.normalizeEvents({ credits: { start: 1200, end: 1290 } });
  const s = settings();
  const plan = P.planCredits({ credits: segs[0], segments: segs, duration: 1420, settings: s, eligible: eligibleFor(s) });
  assert.deepEqual(plan, { kind: "seek", target: 1290, postScene: true });
});

test("planCredits: a skipped preview after the credits isn't a 'scene'", () => {
  const segs = P.normalizeEvents({ credits: { start: 1300, end: 1390 }, preview: { start: 1391, end: 1420 } });
  const s = settings();
  const plan = P.planCredits({ credits: segs[0], segments: segs, duration: 1420, settings: s, eligible: eligibleFor(s) });
  assert.equal(plan.kind, "next");
});

test("planCredits: preview kept when preview skipping is off", () => {
  const segs = P.normalizeEvents({ credits: { start: 1300, end: 1390 }, preview: { start: 1391, end: 1420 } });
  const s = settings({ segments: { intro: true, recap: true, credits: true, preview: false } });
  const plan = P.planCredits({ credits: segs[0], segments: segs, duration: 1420, settings: s, eligible: eligibleFor(s) });
  assert.equal(plan.kind, "seek");
  assert.equal(plan.postScene, true);
});

test("planCredits: autoNext off just seeks", () => {
  const segs = P.normalizeEvents({ credits: { start: 1330, end: 1420 } });
  const s = settings({ autoNext: false });
  const plan = P.planCredits({ credits: segs[0], segments: segs, duration: 1425, settings: s, eligible: eligibleFor(s) });
  assert.deepEqual(plan, { kind: "seek", target: 1420 });
});

test("planCredits: a short logo card after the credits isn't a scene", () => {
  const segs = P.normalizeEvents({ credits: { start: 1330, end: 1412 } });
  const s = settings();
  const plan = P.planCredits({ credits: segs[0], segments: segs, duration: 1420, settings: s, eligible: eligibleFor(s) });
  assert.equal(plan.kind, "next");
});

test("nextEpisodeGate: binge limit and sleep", () => {
  assert.equal(P.nextEpisodeGate({ settings: settings(), binge: { count: 9 }, sleep: null }), null);
  assert.equal(P.nextEpisodeGate({ settings: settings({ bingeLimit: 3 }), binge: { count: 3 }, sleep: null }), "binge");
  assert.equal(P.nextEpisodeGate({ settings: settings({ bingeLimit: 3 }), binge: { count: 2 }, sleep: null }), null);
  assert.equal(P.nextEpisodeGate({ settings: settings(), binge: { count: 0 }, sleep: { mode: "episode" } }), "sleep");
});

test("mergeSettings: clamps and fills defaults", () => {
  const s = C.mergeSettings({ delay: 99, segments: { intro: false, bogus: true }, bingeLimit: -4 });
  assert.equal(s.delay, 10);
  assert.equal(s.segments.intro, false);
  assert.equal(s.segments.credits, true);
  assert.equal("bogus" in s.segments, false);
  assert.equal(s.bingeLimit, 0);
  assert.equal(s.enabled, true);
});

test("formatting helpers", () => {
  assert.equal(C.formatDuration(0), "0s");
  assert.equal(C.formatDuration(95), "1m 35s");
  assert.equal(C.formatDuration(3 * 3600 + 5 * 60), "3h 05m");
  assert.equal(C.formatTimestamp(83), "1:23");
  assert.equal(C.formatTimestamp(3719), "1:01:59");
});

// ---- custom marks ---------------------------------------------------------

const DS = () =>
  // Demon Slayer-ish: credits, then a short "Taisho secret" scene, then a preview.
  P.normalizeEvents({
    intro: { start: 90, end: 180 },
    credits: { start: 1290, end: 1380 },
    preview: { start: 1410, end: 1440 }
  });

test("anchorPoint: snaps to the nearest known edge", () => {
  const segs = DS();
  assert.deepEqual(P.anchorPoint(1381.5, segs, 1440), { a: "credits.end", o: 0 });
  assert.deepEqual(P.anchorPoint(1409, segs, 1440), { a: "preview.start", o: 0 });
  assert.deepEqual(P.anchorPoint(1439.2, segs, 1440), { a: "end", o: 0 });
  assert.deepEqual(P.anchorPoint(700, segs, 1440), { a: "intro.end", o: 520 });
  assert.deepEqual(P.anchorPoint(30, [], 1440), { a: "start", o: 30 });
});

test("resolveMarks: same moment on another episode, missing anchors dropped", () => {
  const mark = { id: "m1", s: { a: "credits.end", o: 0 }, e: { a: "preview.start", o: 0 }, label: "Post-credits" };
  const other = P.normalizeEvents({ credits: { start: 1300, end: 1385 }, preview: { start: 1405, end: 1435 } });
  assert.deepEqual(P.resolveMarks([mark], { episodeId: "B", segments: other, duration: 1436 }), [
    { type: "custom", start: 1385, end: 1405, source: "data", label: "Post-credits", markId: "m1" }
  ]);
  // No preview here: "until the preview" means until the end.
  const noPreview = P.normalizeEvents({ credits: { start: 1300, end: 1385 } });
  assert.equal(P.resolveMarks([mark], { episodeId: "B", segments: noPreview, duration: 1420 })[0].end, 1420);
  // No credits data: can't place it, so it's left out.
  assert.deepEqual(P.resolveMarks([mark], { episodeId: "B", segments: [], duration: 1420 }), []);
  // Episode-only marks stay on their episode.
  const only = { id: "m2", s: { a: "start", o: 600 }, e: { a: "start", o: 640 }, ep: "A" };
  assert.equal(P.resolveMarks([only], { episodeId: "A", segments: [], duration: 1420 }).length, 1);
  assert.equal(P.resolveMarks([only], { episodeId: "B", segments: [], duration: 1420 }).length, 0);
});

test("planCredits: a marked post-credits scene sends you to the next episode", () => {
  const segs = DS();
  const s = settings();
  const el = eligibleFor(s);
  // Unmarked: the 30s scene between credits and preview plays.
  const before = P.planCredits({ credits: segs[1], segments: segs, duration: 1440, settings: s, eligible: el });
  assert.deepEqual(before, { kind: "seek", target: 1380, postScene: true });
  // Marked: credits + scene are skipped in one go.
  const mark = { id: "m1", s: { a: "credits.end", o: 0 }, e: { a: "preview.start", o: 0 } };
  const all = [...segs, ...P.resolveMarks([mark], { episodeId: "A", segments: segs, duration: 1440 })];
  const after = P.planCredits({ credits: segs[1], segments: all, duration: 1440, settings: s, eligible: el });
  assert.equal(after.kind, "next");
  assert.equal(after.target, 1410);
});

test("planCustom: mid-episode mark seeks, end-of-episode mark goes next", () => {
  const segs = DS();
  const s = settings();
  const el = eligibleFor(s);
  const mid = { type: "custom", start: 600, end: 640, source: "data" };
  assert.deepEqual(P.planCustom({ seg: mid, segments: [...segs, mid], duration: 1440, settings: s, eligible: el }), {
    kind: "seek",
    target: 640,
    postScene: false
  });
  const tail = { type: "custom", start: 1380, end: 1410, source: "data" };
  assert.equal(P.planCustom({ seg: tail, segments: [...segs, tail], duration: 1440, settings: s, eligible: el }).kind, "next");
  // autoNext off: just seek.
  const off = settings({ autoNext: false });
  assert.deepEqual(P.planCustom({ seg: tail, segments: [...segs, tail], duration: 1440, settings: off, eligible: eligibleFor(off) }), {
    kind: "seek",
    target: 1410
  });
});

test("watchableAfter: subtracts marks, stops at a skipped preview", () => {
  const segs = DS();
  const s = settings();
  const el = eligibleFor(s);
  assert.equal(P.watchableAfter(1380, segs, 1440, el), 30);
  const mark = { type: "custom", start: 1380, end: 1395, source: "data" };
  assert.equal(P.watchableAfter(1380, [...segs, mark], 1440, el), 15);
});

test("custom marks are eligible whenever auto-skip is on", () => {
  assert.equal(P.isEligible("custom", settings(), "X"), true);
  assert.equal(P.isEligible("custom", settings({ enabled: false }), "X"), false);
});

// ---- openings ---------------------------------------------------------------

test("shouldWatchOpening: first time, episode 1, new season", () => {
  const w = (o) => P.shouldWatchOpening({ enabled: true, season: null, episodeNumber: 5, ...o });
  assert.equal(w({ record: undefined }), true);
  assert.equal(w({ record: { seasons: [""] } }), false);
  assert.equal(w({ record: { seasons: [""] }, episodeNumber: 1 }), true);
  assert.equal(w({ record: { seasons: ["S1"] }, season: "S2" }), true);
  assert.equal(w({ record: { seasons: ["S1", "S2"] }, season: "S2" }), false);
  assert.equal(P.shouldWatchOpening({ enabled: false, record: undefined }), false);
});

// ---- settings & recap -------------------------------------------------------

test("mergeSettings: collects valid marks from their own keys", () => {
  const good = { id: "a", s: { a: "start", o: 1 }, e: { a: "end", o: 0 } };
  const s = C.mergeSettings({
    "marks.SHOW1": { title: "Demon Slayer", list: [good, { id: "bad" }] },
    "marks.EMPTY": { list: [] },
    "other.key": 1
  });
  assert.deepEqual(s.marks, { SHOW1: { title: "Demon Slayer", list: [good] } });
  assert.equal(s.firstOpening, true);
  assert.equal(s.seekMarkers, true);
});

test("summarizeWeek: last 7 days, distinct episodes, top shows", () => {
  const now = new Date(2026, 10, 14, 20, 0);
  const today = C.dayKey(now);
  const old = C.dayKey(new Date(2026, 10, 1));
  const y = C.dayKey(new Date(2026, 10, 13));
  const stats = {
    days: { [today]: 300, [y]: 120, [old]: 999 },
    eps: { [today]: ["E1", "E2"], [y]: ["E2", "E3"], [old]: ["E9"] },
    shows: { [today]: { DS: 200, FR: 100 }, [y]: { FR: 120 }, [old]: { XX: 999 } },
    titles: { DS: "Demon Slayer", FR: "Frieren" }
  };
  const w = C.summarizeWeek(stats, now);
  assert.equal(w.days.length, 7);
  assert.equal(w.days[6].key, today);
  assert.equal(w.total, 420);
  assert.equal(w.episodes, 3);
  assert.deepEqual(w.shows.map((x) => [x.title, x.seconds]), [["Frieren", 220], ["Demon Slayer", 200]]);
});
