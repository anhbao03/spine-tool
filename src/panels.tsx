import { useMemo, useState, type ReactNode } from 'react'
import { MixBlend } from '@pixi-spine/all-3.8'
import { keyMarks, metrics, type Sel } from './spine'
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

// Full-width frame ruler: a tick per frame, labelled frame numbers, key and event markers, and the playhead.
// A transparent native range input on top does the seeking, so keyboard and tests keep working.
export function Timeline({ vp }: { vp: Viewport }) {
  const e = vp.entry, f = vp.fps
  const anim = e?.animation
  // Re-render on seek so the controlled range shows the new time at once; otherwise React restores the
  // stale value and the following change event seeks back to it.
  const [, rerender] = useState(0)
  const seek = (x: number) => { vp.seek(x); rerender(r => r + 1) }
  const marks = useMemo(() => (anim ? keyMarks(anim) : { keys: [], events: [] }), [anim])
  const d = anim?.duration ?? 0, fps = f?.fps ?? 30, t = e?.getAnimationTime() ?? 0
  const frames = Math.round(d * fps)
  const pct = (x: number) => `${d ? (x / d) * 100 : 0}%`
  // ponytail: label density assumes a ruler of ~1000 px; measure it if labels crowd on narrow screens.
  const label = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => frames / s <= 25) ?? 1000
  const minor = Math.max(1, Math.ceil(frames / 500))
  const ticks: ReactNode[] = []
  for (let i = 0; i <= frames; i += minor) ticks.push(<i key={i} className={i % label ? 'tick' : 'tick major'} style={{ left: pct(i / fps) }}>
    {i % label ? null : <span>{i}</span>}
  </i>)
  return <>
    <div className="ruler">
      {ticks}
      {marks.keys.map(k => <i key={k} className="keymark" style={{ left: pct(k) }} />)}
      <i className="head" style={{ left: pct(t) }} />
      <input type="range" disabled={!e} min={0} max={d || 1} step={0.001} value={t}
        onChange={ev => seek(+ev.target.value)} aria-label="Animation time" />
    </div>
    <div className="lane" aria-label="Events on this animation">
      {marks.events.map((ev, i) => <button key={i} className="evmark" style={{ left: pct(ev.time) }} title={`${ev.name} · ${n(ev.time)} s · frame ${n(ev.time * fps)}`}
        onClick={() => seek(ev.time)}>{ev.name}</button>)}
    </div>
  </>
}

// Per-frame runtime cost, as in the Spine editor's Metrics view. Animation counts are for track 0.
export function MetricsPanel({ vp }: { vp: Viewport }) {
  const sk = vp.spine?.skeleton
  if (!sk) return null
  const m = metrics(sk, vp.entry?.animation ?? null)
  return <>
    <Props title="Skeleton" rows={[
      ['Bones', m.bones], ['Bone transforms', m.boneTransforms], ['Constraints', m.constraints], ['Slots', m.slots],
    ]} />
    <Props title="Attachments" rows={[
      ['Total', m.attachments], ['Visible', m.visible], ['Vertices', m.vertices], ['Vertex transforms', m.vertexTransforms],
      ['Triangles', m.triangles], ['Area (sq px at scale 1)', Math.round(m.area).toLocaleString()],
      ['Clipping polygons', m.clipping], ['Clipped triangles', m.clipped],
    ]} />
    <Props title={`Animation${vp.entry ? ` · ${vp.entry.animation.name}` : ''}`} rows={[
      ['Timelines', m.timelines], ['Keys', m.keys], ['Bezier curves', m.bezier], ['Deform vertices', m.deform],
    ]} />
  </>
}
