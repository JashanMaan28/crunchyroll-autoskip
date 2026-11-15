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
  assert.deepEqual(plan, { kind: "next" });
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
  assert.deepEqual(plan, { kind: "next" });
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
  assert.deepEqual(plan, { kind: "next" });
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
