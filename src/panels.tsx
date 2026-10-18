import type { ReactNode } from 'react'
import { MixBlend } from '@pixi-spine/all-3.8'
import type { Sel } from './spine'
import type { Viewport } from './viewport'

export const n = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(3)) : String(v))
export const muted = (s: string) => <span className="muted">{s}</span>

export function Props({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return <><h3>{title}</h3><table><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></>
}

// P2-03: everything here is runtime state from AnimationState / TrackEntry, not source data.
export function AnimationStatePanel({ vp }: { vp: Viewport }) {
  const s = vp.spine
  const tracks = s?.state.tracks.filter(Boolean) ?? []
  if (!s || !tracks.length) return <p className="muted">No animation on any track.</p>
  return <>{tracks.map(e => <Props key={e.trackIndex} title={`Track ${e.trackIndex} · runtime`} rows={[
    ['animation', e.animation.name],
    ['playback', vp.playing ? 'playing' : 'paused'],
    ['loop', String(e.loop)],
    ['animation time', `${n(e.getAnimationTime())} / ${n(e.animation.duration)} s`],
    ['trackTime', n(e.trackTime)],
    ['animationStart / End', `${n(e.animationStart)} / ${n(e.animationEnd)}`],
    ['timeScale (entry × state)', `${n(e.timeScale)} × ${n(s.state.timeScale)}`],
    ['alpha', n(e.alpha)],
    ['mixDuration / mixTime', `${n(e.mixDuration)} / ${n(e.mixTime)}`],
    ['mixing from', e.mixingFrom?.animation.name ?? muted('none')],
    // 3.8 AnimationState always applies track 0 with MixBlend.first, whatever the entry says.
    ['mixBlend', e.trackIndex === 0 ? <>{MixBlend[e.mixBlend]} {muted('(track 0 applies as first)')}</> : MixBlend[e.mixBlend]],
    ['holdPrevious', String(e.holdPrevious)],
    ['event / attachment / drawOrder threshold', `${n(e.eventThreshold)} / ${n(e.attachmentThreshold)} / ${n(e.drawOrderThreshold)}`],
  ]} />)}</>
}

// P2-02: current attachment per slot, in current draw order (front first).
export function SlotMonitor({ vp, selected, select }: { vp: Viewport; selected: string; select: (s: Sel) => void }) {
  const sk = vp.spine?.skeleton
  if (!sk) return null
  return <table className="monitor"><tbody>
    {[...sk.drawOrder].reverse().map(slot => {
      const name = slot.data.name, att = slot.getAttachment()?.name ?? null
      const changed = att !== (slot.data.attachmentName ?? null)
      return <tr key={name} className={selected === `slot:${name}` ? 'on' : undefined} onClick={() => select({ kind: 'slot', name })}>
        <td>{name}</td>
        <td className={changed ? 'diff' : undefined} title={changed ? `Setup pose: ${slot.data.attachmentName ?? '(empty)'}` : undefined}>
          {att ?? muted('(empty)')}
        </td>
      </tr>
    })}
  </tbody></table>
}

// P2-05: events fired by AnimationState. Starting an animation fires its time-0 events (as in a game);
// playback and forward steps fire events they pass; seeking and backward steps fire none.
export function EventMonitor({ vp }: { vp: Viewport }) {
  const ev = vp.events
  return <>
    <p className="muted small">
      Fired when an animation starts (time-0 keys), during playback, and on forward steps. Seeking and stepping back fire nothing.{' '}
      <button disabled={!ev.length} onClick={() => { vp.events = [] }}>Clear</button>
    </p>
    {!ev.length ? <p className="muted">No events yet.</p> : <table className="monitor"><tbody>
      {[...ev].reverse().map(e => <tr key={e.seq}>
        <td>#{e.seq} {e.name}</td>
        <td>
          key {n(e.time)} s · track {n(e.trackTime)} s · {e.animation}
          {e.int !== 0 && <> · int {e.int}</>}
          {e.float !== 0 && <> · float {n(e.float)}</>}
          {e.string && <> · “{e.string}”</>}
          {e.audio && <> · audio {e.audio} (vol {n(e.volume)}, bal {n(e.balance)})</>}
        </td>
      </tr>)}
    </tbody></table>}
  </>
}
