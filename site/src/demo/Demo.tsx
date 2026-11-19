import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react'
import { Pause, Play, Plus, RotateCcw, X } from 'lucide-react'
import opening from '../assets/show-opening.webp'
import episode from '../assets/show-episode.webp'
import credits from '../assets/show-credits.webp'
import { EPISODES, Engine, SERIES, sceneAt, type SceneKind } from './engine'
import './demo.css'

const fmt = (s: number) => {
  const v = Math.max(0, Math.floor(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}
const fmtSaved = (s: number) => {
  const v = Math.round(s)
  return v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`
}

const PART: Record<SceneKind, string> = {
  recap: 'Recap',
  opening: 'Opening',
  story: 'Episode',
  credits: 'Ending',
  scene: 'After the credits',
  preview: 'Next time',
}
const SEG_NAME: Record<string, string> = { recap: 'Recap', intro: 'Opening', credits: 'Credits', preview: 'Preview', custom: 'Your skip' }

const NAMES = ['Original story', 'Director', 'Series composition', 'Character design', 'Art direction', 'Music', 'Animation production', 'Opening theme', 'Ending theme']
const PEOPLE = ['Mio Tanabe', 'Ren Okuda', 'Sae Morikawa', 'Kenta Ishida', 'Hana Ueno', 'Daichi Sato', 'Studio Hoshizora', 'Lantern Days', 'Paper Moon']

function Frame({ kind, epN }: { kind: SceneKind; epN: number }) {
  return (
    <div className="dm-frames" aria-hidden="true">
      <img src={opening} alt="" data-on={kind === 'opening' || undefined} />
      <img src={opening} alt="" className="dm-gray" data-on={kind === 'preview' || undefined} />
      <img src={episode} alt="" data-on={kind === 'story' || undefined} />
      <img src={episode} alt="" className="dm-sepia" data-on={kind === 'recap' || undefined} />
      <img src={episode} alt="" className="dm-night" data-on={kind === 'scene' || undefined} />
      <img src={credits} alt="" data-on={kind === 'credits' || undefined} />
      {kind === 'credits' && (
        <div className="dm-roll" key={epN}>
          {NAMES.map((n, i) => (
            <div key={n}><span>{n}</span>{PEOPLE[i]}</div>
          ))}
        </div>
      )}
      {(kind === 'recap' || kind === 'preview') && <div className="dm-caption">{kind === 'recap' ? 'Previously' : 'Next time'}</div>}
    </div>
  )
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="dm-toggle">
      <span className="dm-toggle__text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export default function Demo() {
  const engine = useMemo(() => new Engine(), [])
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const playerRef = useRef<HTMLDivElement>(null)
  const seekRef = useRef<HTMLDivElement>(null)
  const [scrub, setScrub] = useState<number | null>(null)

  useEffect(() => {
    engine.attach(playerRef.current, seekRef.current)
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement
      if (e.key === ' ' && !/^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(tgt.tagName) && !tgt.isContentEditable) {
        e.preventDefault()
        engine.togglePlay()
        return
      }
      engine.onKey(e)
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      engine.destroy()
    }
  }, [engine])

  const ep = EPISODES[s.epIndex]!
  const t = scrub ?? s.t
  const kind = sceneAt(ep, t)
  const st = s.settings

  const seekTo = (e: RPointerEvent<HTMLDivElement>) => {
    const r = seekRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * ep.dur
  }

  const rows = [
    ...s.segments.map((g) => ({ ...g, key: g.type })),
    ...s.custom.map((g) => ({ ...g, key: `c-${g.markId}` })),
  ].sort((a, b) => a.start - b.start)

  return (
    <div className="dm">
      <div className="dm-main">
        <div
          className="dm-player"
          ref={playerRef}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.dm-controls')) return
            engine.togglePlay()
          }}
        >
          <Frame kind={kind} epN={ep.n} />
          <div className="dm-top">
            <div>
              <div className="dm-show">{SERIES.title}</div>
              <div className="dm-ep">S1 E{ep.n} · {ep.title}</div>
            </div>
            <span className="dm-part">{PART[kind]}</span>
          </div>
          {s.paused && !s.ended && (
            <div className="dm-bigplay" aria-hidden="true"><Play size={28} fill="currentColor" strokeWidth={0} /></div>
          )}
          <div className="dm-controls">
            <button type="button" className="dm-icon" onClick={() => engine.togglePlay()} aria-label={s.paused ? 'Play' : 'Pause'}>
              {s.paused ? <Play size={18} fill="currentColor" strokeWidth={0} /> : <Pause size={18} fill="currentColor" strokeWidth={0} />}
            </button>
            <div
              className="dm-seek"
              ref={seekRef}
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={ep.dur}
              aria-valuenow={Math.round(t)}
              aria-valuetext={`${fmt(t)} of ${fmt(ep.dur)}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                setScrub(seekTo(e))
              }}
              onPointerMove={(e) => scrub !== null && setScrub(seekTo(e))}
              onPointerUp={(e) => {
                engine.seek(seekTo(e))
                setScrub(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') engine.seek(s.t + 5)
                else if (e.key === 'ArrowLeft') engine.seek(s.t - 5)
                else return
                e.preventDefault()
              }}
            >
              <div className="dm-track" />
              <div className="dm-played" style={{ transform: `scaleX(${t / ep.dur})` }} />
              <div className="dm-knob" style={{ left: `${(t / ep.dur) * 100}%` }} />
            </div>
            <span className="dm-time">{fmt(t)} <span>/ {fmt(ep.dur)}</span></span>
            <div className="dm-rate" role="group" aria-label="Playback speed">
              {[1, 2, 4].map((r) => (
                <button key={r} type="button" aria-pressed={s.rate === r} onClick={() => engine.setRate(r)}>{r}×</button>
              ))}
            </div>
          </div>
        </div>

        <div className="dm-under">
          <div className="dm-eps" role="group" aria-label="Episodes">
            {EPISODES.map((e, i) => (
              <button key={e.id} type="button" aria-pressed={s.epIndex === i} onClick={() => engine.loadEpisode(i, true)}>
                <span>Episode {e.n}</span>
                <small>{e.title}</small>
              </button>
            ))}
          </div>
          <p className="dm-keys">
            <kbd className="kbd">Space</kbd> play or pause · <kbd className="kbd">Enter</kbd> skip now · <kbd className="kbd">Esc</kbd> watch instead · <span className="keys"><kbd className="kbd">Alt</kbd><kbd className="kbd">Shift</kbd><kbd className="kbd">M</kbd></span> mark a part
          </p>
        </div>

        <section className="dm-log" aria-labelledby="dm-log-title">
          <div className="dm-log__head">
            <h2 id="dm-log-title">What Autoskip did</h2>
            <p><b>{fmtSaved(s.saved)}</b> saved</p>
          </div>
          {s.log.length === 0 ? (
            <p className="dm-log__empty">Press play. Episode 1 is your first time watching this show, so its opening plays. Episodes 2 and 3 show the rest.</p>
          ) : (
            <ol aria-live="polite">
              {s.log.map((l) => (
                <li key={l.id} data-tone={l.tone}>
                  <span className="dm-log__at">{l.at}</span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <aside className="dm-panel" aria-label="Autoskip settings">
        <div className="dm-panel__head">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} width="28" height="28" alt="" />
          <div>
            <div className="dm-panel__name">Autoskip</div>
            <div className="dm-panel__sub">{st.enabled ? 'On' : 'Off'} for this demo</div>
          </div>
          <label className="dm-switch" aria-label="Auto-skip">
            <input type="checkbox" role="switch" checked={st.enabled} onChange={(e) => engine.setSetting({ enabled: e.target.checked })} />
            <i aria-hidden="true" />
          </label>
        </div>

        <div className="dm-card">
          <div className="dm-card__title">{SERIES.title}</div>
          <div className="dm-card__sub">S1 E{ep.n} · {ep.title}</div>
          <div className="dm-mini" aria-hidden="true">
            {rows.map((r) => (
              <i key={r.key} style={{ left: `${(r.start / ep.dur) * 100}%`, width: `${((r.end - r.start) / ep.dur) * 100}%` }} />
            ))}
            <b style={{ left: `${(t / ep.dur) * 100}%` }} />
          </div>
          <ul className="dm-segs">
            {rows.map((r) => {
              const custom = r.type === 'custom'
              const kept = !custom && engine.isKept(r.type)
              const once = r.type === 'intro' && s.watchOpening && !kept && st.segments.intro
              const off = !custom && !st.segments[r.type]
              return (
                <li key={r.key}>
                  <span className="dm-dot" data-off={kept || off || once || undefined} />
                  <span className="dm-segs__name">{custom ? r.label || SEG_NAME.custom : SEG_NAME[r.type]}</span>
                  <span className="dm-segs__time">{fmt(r.start)}–{fmt(r.end)}</span>
                  {custom ? (
                    <button type="button" className="dm-chip" onClick={() => engine.removeMark(r.markId!)}>
                      <X size={12} strokeWidth={2} /> Remove
                    </button>
                  ) : off ? (
                    <span className="dm-chip dm-chip--quiet">Off</span>
                  ) : (
                    <button
                      type="button"
                      className="dm-chip"
                      data-watch={kept || once || undefined}
                      onClick={() => (once ? engine.skipOpening() : engine.setKeep(r.type, !kept))}
                      title={once ? 'Skip the opening from now on' : kept ? 'Skip this on every episode' : 'Watch this on every episode'}
                    >
                      {kept ? 'Watch' : once ? 'Once' : 'Skip'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <button type="button" className="dm-mark" data-active={s.marking !== null || undefined} onClick={() => engine.mark()}>
            <Plus size={14} strokeWidth={2} />
            {s.marking === null ? 'Mark a part to skip' : `Started at ${fmt(s.marking)}. Mark the end`}
          </button>
        </div>

        <div className="dm-group">
          <div className="dm-group__label">Skip</div>
          <Toggle label="Recap" on={st.segments.recap} onChange={(v) => engine.setSegment('recap', v)} />
          <Toggle label="Opening" on={st.segments.intro} onChange={(v) => engine.setSegment('intro', v)} />
          <Toggle label="Credits" on={st.segments.credits} onChange={(v) => engine.setSegment('credits', v)} />
          <Toggle label="Preview" on={st.segments.preview} onChange={(v) => engine.setSegment('preview', v)} />
        </div>
        <div className="dm-group">
          <div className="dm-group__label">Playback</div>
          <Toggle label="Smart next episode" hint="Watches post-credits scenes first" on={st.autoNext} onChange={(v) => engine.setSetting({ autoNext: v })} />
          <Toggle label="Play new openings once" hint="First time per show, and every episode 1" on={st.firstOpening} onChange={(v) => engine.setSetting({ firstOpening: v })} />
          <Toggle label="Show skips on the seek bar" on={st.seekMarkers} onChange={(v) => engine.setSetting({ seekMarkers: v })} />
        </div>
        <button type="button" className="dm-reset" onClick={() => engine.reset()}>
          <RotateCcw size={14} strokeWidth={2} /> Reset the demo
        </button>
      </aside>
    </div>
  )
}
