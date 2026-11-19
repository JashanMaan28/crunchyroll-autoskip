import { Bar, Stage, Window, type Act } from '../kit'
import opening from '../assets/show-opening.webp'
import episode from '../assets/show-episode.webp'
import credits from '../assets/show-credits.webp'
import { SkipButton } from './SkipButton'
import './hero.css'

// The hero: an episode of a made-up show in a browser. The opening starts,
// the Skip Intro button fills for 3 seconds and the playhead jumps past it.
// Later the ending starts, Next Episode fills, and the next episode begins.
//
// Beats: opening plays (1:03) -> button rises -> fills over 3s -> jump to
// 2:32, rooftop scene -> hold -> cut to the ending at 21:30 -> Next Episode
// fills -> fade to the next episode -> fade back to the start of the loop.
//
// Real strings: the show, the episode, the time, the button's label. The
// page under the player is placeholder.

type Scene = 'opening' | 'episode' | 'credits'
type S = {
  scene: Scene
  t: number
  /** The button is showing */
  btn: boolean
  /** What it says, set while it's hidden so the label never changes in view */
  kind: 'intro' | 'next'
  fill: number
  pressed: boolean
  ep: 5 | 6
  black: boolean
}

const DUR = 24 * 60
// Skip zones on the seek bar: recap + opening, then ending + preview.
const ZONES = [
  [0, 152],
  [1290, 1440],
]

const initial: S = { scene: 'opening', t: 63, btn: false, kind: 'intro', fill: 0, pressed: false, ep: 5, black: false }
const poster: S = { ...initial, t: 65, btn: true, fill: 0.55 }

async function play(a: Act<S>, from: number, seconds: number) {
  for (let i = 1; i <= seconds; i++) {
    await a.wait(1000)
    a.put({ t: from + i })
  }
}

async function countdown(a: Act<S>, kind: 'intro' | 'next', from: number) {
  a.mark(kind)
  await a.snap({ kind, fill: 0 })
  await a.set({ btn: true })
  await a.wait(80)
  a.put({ fill: 1 })
  await play(a, from, 3)
  a.put({ pressed: true })
  await a.wait(140)
  a.put({ pressed: false, btn: false })
}

async function script(a: Act<S>) {
  await play(a, 63, 1)
  await countdown(a, 'intro', 64)
  a.put({ t: 152, scene: 'episode' })
  await play(a, 152, 3)

  // Twenty minutes later: the ending.
  await a.set({ black: true })
  await a.wait(420)
  await a.snap({ t: 1291, scene: 'credits', fill: 0 })
  await a.set({ black: false })
  await a.wait(900)
  await countdown(a, 'next', 1292)

  // The next episode starts.
  await a.set({ black: true })
  await a.wait(420)
  await a.snap({ ep: 6, t: 0, scene: 'opening', fill: 0 })
  await a.set({ black: false })
  await a.wait(1600)
  await a.set({ black: true })
  await a.wait(420)
  await a.snap({ ...initial, black: true })
  await a.set({ black: false })
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Player({ s, compact }: { s: S; compact: boolean }) {
  const p = s.t / DUR
  const label = s.kind === 'next' ? 'Next Episode' : 'Skip Intro'
  return (
    <div className="hd-player" data-compact={compact || undefined}>
      <div className="hd-frames">
        <img src={opening} alt="" data-on={s.scene === 'opening' || undefined} />
        <img src={episode} alt="" data-on={s.scene === 'episode' || undefined} />
        <img src={credits} alt="" data-on={s.scene === 'credits' || undefined} />
        <div className="hd-roll" data-on={s.scene === 'credits' || undefined}>
          {[96, 140, 0, 120, 88, 0, 132, 104, 0, 112, 150, 92, 0, 128, 84].map((w, i) =>
            w ? <Bar key={i} w={w} h={6} r={3} tone={2} /> : <i key={i} />,
          )}
        </div>
      </div>
      <div className="hd-black" data-on={s.black || undefined} />
      <div className="hd-top">
        <div className="hd-show">Skyward Lantern</div>
        <div className="hd-ep">{s.ep === 5 ? 'S1 E5 · The Long Night' : 'S1 E6 · Paper Moons'}</div>
      </div>
      <div className="hd-dock" data-on={s.btn || undefined}>
        <SkipButton label={label} kind={s.kind === 'next' ? 'next' : 'skip'} fill={s.fill} pressed={s.pressed} />
      </div>
      <div className="hd-controls">
        <div className="hd-seek">
          <div className="hd-track" />
          <div className="hd-played" data-snap style={{ transform: `scaleX(${p})` }} />
          {ZONES.map(([a, b]) => (
            <i key={a} className="hd-zone" style={{ left: `${(a / DUR) * 100}%`, width: `${((b - a) / DUR) * 100}%` }} />
          ))}
          <div className="hd-knob" data-snap style={{ left: `${p * 100}%` }} />
        </div>
        <div className="hd-row">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
          <span className="hd-time" data-snap>{time(s.t)} <span>/ 24:00</span></span>
          <span className="hd-sp" />
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </div>
    </div>
  )
}

export default function HeroDemo() {
  return (
    <Stage<S>
      width={1040}
      height={640}
      compact={{ below: 640, width: 358, height: 202 }}
      theme="dark"
      initial={initial}
      poster={poster}
      script={script}
      className="hd"
    >
      {(s, _rect, layout) =>
        layout === 'compact' ? (
          <Player s={s} compact />
        ) : (
          <Window url="crunchyroll.com/watch" urlShape="pill" className="hd-win">
            <Player s={s} compact={false} />
            <div className="hd-page">
              <div className="hd-page__title">
                <Bar w={220} h={10} r={5} tone={3} />
                <Bar w={140} h={7} r={3.5} tone={2} />
              </div>
              <div className="hd-page__eps">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="hd-page__ep">
                    <Bar w={168} h={94} r={8} tone={1} />
                    <Bar w={[120, 96, 132, 104][i]!} h={7} r={3.5} tone={2} />
                  </div>
                ))}
              </div>
            </div>
          </Window>
        )
      }
    </Stage>
  )
}
