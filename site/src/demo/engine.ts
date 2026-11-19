// The demo's controller. It mirrors extension/content/content.js, but drives
// a simulated video instead of Crunchyroll's player. The decisions come from
// the extension's own planner (CRAS_planner), its defaults (CRAS) and its
// countdown button (CRAS_overlay), copied in at build time by scripts/sync.mjs.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Seg = { type: string; start: number; end: number; source: string; label?: string; markId?: string }
type Plan = { action: 'seek' | 'next'; target?: number; postScene?: boolean; text: string; kind: 'skip' | 'next' }
type Countdown = { seg: Seg; plan: Plan; elapsed: number; last: number }

const g = globalThis as any
const P = () => g.CRAS_planner
const C = () => g.CRAS

export type SceneKind = 'recap' | 'opening' | 'story' | 'credits' | 'scene' | 'preview'
export type Episode = {
  id: string
  n: number
  title: string
  dur: number
  events: Record<string, { start: number; end: number }>
  /** Footage after the credits that isn't in the skip data: a post-credits scene. */
  scene?: { start: number; end: number }
}

export const SERIES = { id: 'GSKYWARD01', title: 'Skyward Lantern' }

export const EPISODES: Episode[] = [
  {
    id: 'DEMO00001', n: 1, title: 'Lanterns', dur: 240,
    events: { intro: { start: 6, end: 36 }, credits: { start: 180, end: 210 }, preview: { start: 210, end: 240 } },
  },
  {
    id: 'DEMO00002', n: 2, title: 'The Long Night', dur: 240,
    events: { recap: { start: 0, end: 14 }, intro: { start: 14, end: 44 }, credits: { start: 180, end: 206 }, preview: { start: 222, end: 240 } },
    scene: { start: 206, end: 222 },
  },
  {
    id: 'DEMO00003', n: 3, title: 'Paper Moons', dur: 240,
    events: { recap: { start: 0, end: 12 }, intro: { start: 12, end: 42 }, credits: { start: 186, end: 216 }, preview: { start: 216, end: 240 } },
  },
]

export function sceneAt(ep: Episode, t: number): SceneKind {
  const e = ep.events
  const within = (s?: { start: number; end: number }) => !!s && t >= s.start && t < s.end
  if (within(e.recap)) return 'recap'
  if (within(e.intro)) return 'opening'
  if (within(e.credits)) return 'credits'
  if (within(ep.scene)) return 'scene'
  if (within(e.preview)) return 'preview'
  return 'story'
}

/** A video element stand-in: the same properties and events the controller uses. */
export class SimVideo extends EventTarget {
  duration = NaN
  paused = true
  ended = false
  playbackRate = 1
  private t = 0
  private raf = 0
  private last = 0

  get currentTime() { return this.t }
  set currentTime(v: number) {
    this.t = Math.max(0, Math.min(this.duration || 0, v))
    this.ended = false
    this.dispatchEvent(new Event('seeking'))
    this.dispatchEvent(new Event('timeupdate'))
  }

  load(duration: number) {
    this.pause()
    this.duration = duration
    this.t = 0
    this.ended = false
    this.dispatchEvent(new Event('timeupdate'))
  }

  play() {
    if (!this.paused) return
    if (this.ended || this.t >= this.duration) this.t = 0
    this.ended = false
    this.paused = false
    this.last = performance.now()
    this.dispatchEvent(new Event('play'))
    const step = (now: number) => {
      if (this.paused) return
      const dt = Math.min(now - this.last, 250) / 1000
      this.last = now
      this.t = Math.min(this.duration, this.t + dt * this.playbackRate)
      this.dispatchEvent(new Event('timeupdate'))
      if (this.t >= this.duration) {
        this.paused = true
        this.ended = true
        this.dispatchEvent(new Event('pause'))
        this.dispatchEvent(new Event('ended'))
        return
      }
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  pause() {
    cancelAnimationFrame(this.raf)
    if (this.paused) return
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

export type LogEntry = { id: number; at: string; text: string; tone?: 'skip' | 'watch' | 'info' }

export type Snapshot = {
  epIndex: number
  t: number
  paused: boolean
  rate: number
  settings: any
  segments: Seg[]
  custom: Seg[]
  watchOpening: boolean
  marking: number | null
  saved: number
  log: LogEntry[]
  ended: boolean
}

export class Engine {
  video = new SimVideo()
  settings: any
  overlay: any
  private player: HTMLElement | null = null
  private seekBar: HTMLElement | null = null
  private epIndex = 0
  private segments: Seg[] = []
  private custom: Seg[] = []
  private segState = new Map<string, string>()
  private countdown: Countdown | null = null
  private timer = 0
  private postScene = false
  private endHandled = false
  private watchOpening: boolean | undefined
  private openingRecorded = false
  private heard: string[] | null = null
  private marks: any[] = []
  private marking: number | null = null
  private selfSeekUntil = 0
  private saved = 0
  private log: LogEntry[] = []
  private logId = 0
  private announcedOpening = false
  private listeners = new Set<() => void>()
  private snap: Snapshot
  private finished = false

  constructor() {
    this.settings = C().mergeSettings({})
    this.overlay = g.CRAS_overlay.createOverlay({
      onSkipNow: () => this.execute(),
      onCancel: () => this.cancelCountdown('user'),
    })
    this.video.addEventListener('seeking', () => this.onSeeking())
    this.video.addEventListener('ended', () => this.onEnded())
    for (const e of ['timeupdate', 'play', 'pause']) this.video.addEventListener(e, () => this.emit())
    this.snap = this.makeSnapshot()
    this.loadEpisode(0, false)
    this.timer = window.setInterval(() => this.tick(), 100)
  }

  attach(player: HTMLElement | null, seekBar: HTMLElement | null) {
    this.player = player
    this.seekBar = seekBar
    this.overlay.setVideo(player)
  }

  // ---- store for React --------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  private emit() {
    this.snap = this.makeSnapshot()
    for (const fn of this.listeners) fn()
  }
  private makeSnapshot(): Snapshot {
    return {
      epIndex: this.epIndex,
      t: this.video.currentTime,
      paused: this.video.paused,
      rate: this.video.playbackRate,
      settings: this.settings,
      segments: this.segments,
      custom: this.custom,
      watchOpening: this.watchingOpening(),
      marking: this.marking,
      saved: this.saved,
      log: this.log,
      ended: this.finished,
    }
  }

  get episode() { return EPISODES[this.epIndex]! }

  private note(text: string, tone?: LogEntry['tone']) {
    const at = C().formatTimestamp(this.video.currentTime)
    this.log = [{ id: ++this.logId, at: `E${this.episode.n} ${at}`, text, tone }, ...this.log].slice(0, 40)
  }

  // ---- episodes ---------------------------------------------------------------
  loadEpisode(i: number, autoplay: boolean) {
    this.cancelCountdown('silent')
    this.overlay.hideNotice()
    this.epIndex = i
    const ep = this.episode
    this.video.load(ep.dur)
    this.segments = P().normalizeEvents(ep.events)
    this.segState.clear()
    this.postScene = false
    this.endHandled = false
    this.watchOpening = undefined
    this.openingRecorded = false
    this.announcedOpening = false
    this.marking = null
    this.finished = false
    this.refreshCustom()
    if (autoplay) this.video.play()
    this.emit()
  }

  // ---- settings -----------------------------------------------------------------
  setSetting(patch: any) {
    this.settings = C().mergeSettings({ ...this.settings, ...patch, marks: undefined })
    this.emit()
  }
  setSegment(type: string, on: boolean) {
    this.setSetting({ segments: { ...this.settings.segments, [type]: on } })
  }
  /** The popup's per-show Skip/Watch toggle. */
  setKeep(type: string, keep: boolean) {
    const cur = this.settings.showExceptions[SERIES.id] || { title: SERIES.title, keep: {} }
    const next = { ...cur, keep: { ...cur.keep, [type]: keep } }
    this.setSetting({ showExceptions: { ...this.settings.showExceptions, [SERIES.id]: next } })
  }
  isKept(type: string) {
    const ex = this.settings.showExceptions[SERIES.id]
    return !!(ex && ex.keep && ex.keep[type])
  }
  /** The popup's "Once" button: count this opening as heard and skip it. */
  skipOpening() {
    this.watchOpening = false
    this.openingRecorded = true
    this.heard = ['S1']
    this.note('Opening counted as heard. It’s skipped from now on', 'info')
    this.emit()
  }
  setRate(r: number) {
    this.video.playbackRate = r
    this.emit()
  }
  reset() {
    this.settings = C().mergeSettings({})
    this.marks = []
    this.heard = null
    this.saved = 0
    this.log = []
    this.loadEpisode(0, false)
  }

  // ---- playback -------------------------------------------------------------------
  togglePlay() {
    if (this.video.paused) {
      if (this.finished) this.loadEpisode(0, true)
      else this.video.play()
    } else this.video.pause()
  }
  seek(t: number) {
    this.video.currentTime = t
  }
  private selfSeek(t: number) {
    this.selfSeekUntil = Date.now() + 800
    this.video.currentTime = t
  }

  // ---- the controller, as in content.js ---------------------------------------------
  private allSegments() {
    return this.custom.length ? [...this.segments, ...this.custom].sort((a, b) => a.start - b.start) : this.segments
  }
  private segKey(seg: Seg) {
    return seg.type === 'custom' ? `custom:${seg.markId}` : `${seg.type}@${seg.start}`
  }
  private stateOf = (seg: Seg) => this.segState.get(this.segKey(seg)) || 'idle'

  watchingOpening(): boolean {
    if (this.watchOpening !== undefined) return this.watchOpening
    if (!this.settings.firstOpening) return false
    return P().shouldWatchOpening({
      enabled: true,
      record: this.heard ? { seasons: this.heard } : undefined,
      season: 'S1',
      episodeNumber: this.episode.n,
    })
  }

  private eligible = (type: string) => {
    if (type === 'intro' && this.watchingOpening()) return false
    return P().isEligible(type, this.settings, SERIES.id)
  }

  private refreshCustom() {
    this.custom = P().resolveMarks(this.marks, { episodeId: this.episode.id, segments: this.segments, duration: this.episode.dur })
    if (this.countdown && this.countdown.seg.type === 'custom' && !this.custom.some((c) => c.markId === this.countdown!.seg.markId)) {
      this.cancelCountdown('silent')
    }
  }

  private updateMarkers() {
    if (!this.settings.enabled || !this.settings.seekMarkers) {
      this.overlay.setSeekBar(null, 0)
      return
    }
    const dur = this.video.duration
    const list = this.allSegments()
      .filter((s) => this.eligible(s.type) && this.stateOf(s) !== 'cancelled')
      .map((s) => ({ start: s.start, end: P().effectiveEnd(s, dur) }))
    this.overlay.setMarkers(list, dur)
    this.overlay.setSeekBar(this.seekBar, this.seekBar ? 1 : 0)
  }

  private tick() {
    if (!this.player) return
    this.updateMarkers()
    if (!this.settings.enabled) return

    const t = this.video.currentTime
    const dur = this.video.duration
    const intro = this.segments.find((s) => s.type === 'intro')

    // Decide once per episode, like the extension does after the page settles.
    if (this.watchOpening === undefined && intro) {
      this.watchOpening = this.watchingOpening()
      if (this.watchOpening && !this.announcedOpening) {
        this.announcedOpening = true
        this.note(this.heard ? 'Episode 1: the opening plays this time' : 'First time watching this show: the opening plays once', 'watch')
        this.emit()
      }
    }
    if (!this.openingRecorded && this.watchOpening && intro && t >= intro.start + 5 && t < intro.end + 30) {
      this.openingRecorded = true
      this.heard = ['S1']
      this.note('Opening heard. From now on it’s skipped', 'info')
      this.emit()
    }

    if (this.countdown) {
      const seg = this.countdown.seg
      if (seg.source === 'data' && (t < seg.start - 0.5 || t >= P().effectiveEnd(seg, dur) - 0.25)) this.cancelCountdown('silent')
      return
    }
    if (this.overlay.isNoticeVisible()) return

    const seg = P().findTrigger(this.allSegments(), t, dur, this.eligible, this.stateOf)
    if (seg) return this.startCountdown(seg)

    if (this.postScene && !this.endHandled && this.settings.autoNext && dur > 0 && t >= dur - 1.5) {
      this.endHandled = true
      this.startCountdown({ type: 'end', source: 'end', start: 0, end: Infinity })
    }
  }

  private nextAvailable() {
    return this.epIndex < EPISODES.length - 1
  }

  private buildPlan(seg: Seg): Plan | null {
    const dur = this.video.duration
    const L = C().LABELS
    const endSafe = (x: number) => (dur > 0 ? Math.min(x, dur - 0.3) : x)
    const s = this.settings
    if (seg.type === 'intro' || seg.type === 'recap') return { action: 'seek', target: endSafe(seg.end), text: L[seg.type], kind: 'skip' }
    if (seg.type === 'credits') {
      const p = P().planCredits({ credits: seg, segments: this.allSegments(), duration: dur, settings: s, eligible: this.eligible })
      if (p.kind === 'next' && this.nextAvailable()) return { action: 'next', text: L.next, kind: 'next' }
      return { action: 'seek', target: endSafe(p.target), postScene: !!p.postScene, text: L.credits, kind: 'skip' }
    }
    if (seg.type === 'custom') {
      const p = P().planCustom({ seg, segments: this.allSegments(), duration: dur, settings: s, eligible: this.eligible })
      if (p.kind === 'next' && this.nextAvailable()) return { action: 'next', text: L.next, kind: 'next' }
      return { action: 'seek', target: endSafe(p.target), postScene: !!p.postScene, text: L.custom, kind: 'skip' }
    }
    if (seg.type === 'preview') {
      const p = P().planPreview({ preview: seg, settings: s })
      if (p.kind === 'next' && this.nextAvailable()) return { action: 'next', text: L.next, kind: 'next' }
      return { action: 'seek', target: endSafe(seg.end), text: L.preview, kind: 'skip' }
    }
    if (seg.type === 'end') return this.nextAvailable() ? { action: 'next', text: L.next, kind: 'next' } : null
    return null
  }

  private cdTimer = 0
  private startCountdown(seg: Seg) {
    const plan = this.buildPlan(seg)
    if (!plan) {
      this.segState.set(this.segKey(seg), 'done')
      return
    }
    this.countdown = { seg, plan, elapsed: 0, last: performance.now() }
    if (this.settings.delay <= 0) return this.execute()
    this.overlay.showCountdown({ text: plan.text, kind: plan.kind })
    clearInterval(this.cdTimer)
    this.cdTimer = window.setInterval(() => this.stepCountdown(), 50)
  }

  private stepCountdown() {
    const cd = this.countdown
    if (!cd) return
    const now = performance.now()
    const dt = Math.min(now - cd.last, 1100)
    cd.last = now
    const frozen = this.video.paused && !this.video.ended
    if (!frozen) cd.elapsed += dt
    const total = this.settings.delay * 1000
    this.overlay.setProgress(cd.elapsed / total, frozen)
    if (cd.elapsed >= total) this.execute()
  }

  cancelCountdown(reason: 'user' | 'silent') {
    const cd = this.countdown
    if (!cd) return
    clearInterval(this.cdTimer)
    this.countdown = null
    this.overlay.hideCountdown()
    if (reason === 'user') {
      this.segState.set(this.segKey(cd.seg), 'cancelled')
      if (cd.seg.type === 'credits') this.endHandled = true
      this.note(`Cancelled. The ${this.label(cd.seg)} plays this time`, 'watch')
      this.emit()
    }
  }

  private label(seg: Seg) {
    if (seg.type === 'custom') return seg.label || 'marked part'
    return ({ intro: 'opening', recap: 'recap', credits: 'credits', preview: 'preview', end: 'end' } as Record<string, string>)[seg.type] || seg.type
  }

  execute() {
    const cd = this.countdown
    if (!cd) return
    clearInterval(this.cdTimer)
    this.countdown = null
    this.overlay.hideCountdown()
    this.segState.set(this.segKey(cd.seg), 'done')
    const t = this.video.currentTime
    const { plan, seg } = cd
    if (plan.action === 'seek') {
      const s = P().secondsSaved(t, plan.target)
      this.saved += s
      this.selfSeek(plan.target!)
      if (plan.postScene) {
        this.postScene = true
        this.note(`Skipped the credits. There’s a scene after them, so it plays`, 'skip')
      } else this.note(`Skipped the ${this.label(seg)}, ${Math.round(s)}s saved`, 'skip')
    } else {
      const dur = this.video.duration
      this.saved += P().secondsSaved(t, dur)
      this.note(seg.type === 'end' ? 'Scene over. On to the next episode' : `Nothing after the ${this.label(seg)}. On to the next episode`, 'skip')
      this.loadEpisode(this.epIndex + 1, true)
    }
    this.emit()
  }

  private onSeeking() {
    if (Date.now() < this.selfSeekUntil) return
    const t = this.video.currentTime
    for (const seg of this.allSegments()) {
      if (t < seg.start - 0.5) this.segState.delete(this.segKey(seg))
      if (seg.type === 'credits' && t < seg.start) {
        this.postScene = false
        this.endHandled = false
      }
    }
    this.finished = false
    const cd = this.countdown
    if (cd && cd.seg.source === 'data' && (t < cd.seg.start - 0.5 || t >= P().effectiveEnd(cd.seg, this.video.duration) - 0.25)) this.cancelCountdown('silent')
    if (cd && cd.seg.source === 'end' && t < this.video.duration - 3) {
      this.cancelCountdown('silent')
      this.endHandled = false
    }
  }

  private onEnded() {
    if (this.settings.enabled && this.postScene && !this.endHandled && this.settings.autoNext && this.nextAvailable()) {
      this.endHandled = true
      this.startCountdown({ type: 'end', source: 'end', start: 0, end: Infinity })
      return
    }
    if (!this.nextAvailable()) {
      this.finished = true
      this.overlay.showNotice({
        title: 'That was the last episode',
        body: 'Pick an episode to watch it again, or change a setting and see what Autoskip does differently.',
        actions: [{ text: 'Start over', primary: true, onClick: () => this.loadEpisode(0, true) }],
      })
      this.emit()
    }
  }

  // ---- custom skips, as the Alt+Shift+M command does ----------------------------
  mark() {
    const t = this.video.currentTime
    if (this.marking === null) {
      this.marking = t
      this.overlay.toast(`Skipping from ${C().formatTimestamp(t)}. Press Alt+Shift+M where it ends (Esc cancels)`, 0, true)
      this.emit()
      return
    }
    const a = Math.min(this.marking, t)
    const b = Math.max(this.marking, t)
    this.marking = null
    if (b - a < 2) {
      this.overlay.toast('That’s too short. Mark the start and end again', 2400)
      this.emit()
      return
    }
    const dur = this.video.duration
    const id = C().newMarkId()
    this.marks = [...this.marks, { id, s: P().anchorPoint(a, this.segments, dur), e: P().anchorPoint(b, this.segments, dur), label: '' }]
    this.segState.set(`custom:${id}`, 'done')
    this.refreshCustom()
    const range = `${C().formatTimestamp(a)}–${C().formatTimestamp(b)}`
    this.overlay.toast(`Skipping ${range} on every episode of ${SERIES.title}`, 3800, true)
    this.note(`Marked ${range} to skip on every episode`, 'info')
    this.emit()
  }
  cancelMarking() {
    if (this.marking === null) return false
    this.marking = null
    this.overlay.toast('Marking cancelled', 1600)
    this.emit()
    return true
  }
  removeMark(id: string) {
    this.marks = this.marks.filter((m) => m.id !== id)
    this.refreshCustom()
    this.emit()
  }

  onKey(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement | null
    if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return
    if (e.altKey && e.shiftKey && e.code === 'KeyM') {
      e.preventDefault()
      return this.mark()
    }
    if (e.key === 'Escape' && !this.countdown && this.cancelMarking()) return e.preventDefault()
    if (this.countdown && this.overlay.isCountdownVisible()) {
      if (e.key === 'Escape') this.cancelCountdown('user')
      else if (e.key === 'Enter') this.execute()
      else return
      e.preventDefault()
    }
  }

  destroy() {
    clearInterval(this.timer)
    clearInterval(this.cdTimer)
    this.video.pause()
    this.overlay.destroy()
  }
}
