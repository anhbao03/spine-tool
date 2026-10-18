import { Application, Container, Graphics, Point, Text } from 'pixi.js'
import {
  AttachmentType, Spine, SpineDebugRenderer,
  type Attachment, type Event, type SkeletonData, type Slot, type TrackEntry,
} from '@pixi-spine/all-3.8'
import { frameRate, geometry, seekTrack, type Sel } from './spine'

const HIGHLIGHT = 0x00e5ff
const BONE = 0x76ff03
const HIERARCHY = 0x9e9e9e
const MAX_EVENTS = 500

export const OVERLAYS = {
  bones: 'Bones', names: 'Bone names', hierarchy: 'Hierarchy',
  regions: 'Regions', meshes: 'Meshes', bboxes: 'Bounding boxes', clipping: 'Clipping', paths: 'Paths',
} as const
export type Overlay = keyof typeof OVERLAYS

export interface LoggedEvent {
  seq: number; name: string; time: number; trackTime: number; animation: string
  int: number; float: number; string: string; audio: string; volume: number; balance: number
}

function inTriangle(v: number[], a: number, b: number, c: number, x: number, y: number) {
  const s = (i: number, j: number) => (v[j * 2] - v[i * 2]) * (y - v[i * 2 + 1]) - (v[j * 2 + 1] - v[i * 2 + 1]) * (x - v[i * 2])
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

export class Viewport {
  app: Application
  world = new Container()
  overlay = new Graphics()
  bones = new Graphics()
  labels = new Container()
  debug = new SpineDebugRenderer()
  overlays = Object.fromEntries(Object.keys(OVERLAYS).map(k => [k, false])) as Record<Overlay, boolean>
  spine: Spine | null = null
  playing = false
  speed = 1
  loop = true
  mix = 0
  sel: Sel = null
  events: LoggedEvent[] = []
  private seq = 0
  onPick?: (s: Sel) => void

  constructor(host: HTMLElement) {
    // SpineDebugRenderer starts with every overlay on; bones are drawn by drawBones() instead.
    this.debug.drawBones = false
    this.setOverlay('regions', false)
    this.app = new Application({ resizeTo: host, background: '#262626', antialias: true, resolution: devicePixelRatio, autoDensity: true })
    host.appendChild(this.app.view as HTMLCanvasElement)
    this.app.stage.addChild(this.world)
    this.app.ticker.add(() => {
      if (!this.spine) return
      // Debug line widths are in skeleton units; keep them ~1.5 px on screen at any zoom.
      this.debug.lineWidth = 1.5 / this.world.scale.x
      this.spine.update(this.playing ? this.app.ticker.deltaMS / 1000 * this.speed : 0)
      this.drawOverlay()
      this.drawBones()
    })
    this.bindInput(this.app.view as HTMLCanvasElement)
    // resizeTo only tracks window resizes; panel drags change the host size too.
    this.resizer.observe(host)
  }

  private resizer = new ResizeObserver(() => this.app.resize())

  destroy() { this.resizer.disconnect(); this.unload(); this.app.destroy(true) }

  load(data: SkeletonData) {
    this.unload()
    const s = new Spine(data)
    s.autoUpdate = false
    s.debug = this.debug
    s.stateData.defaultMix = this.mix
    s.state.addListener({ event: (entry, e) => this.logEvent(entry, e) })
    this.spine = s
    for (const b of data.bones)
      this.labels.addChild(new Text(b.name, { fontSize: 11, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }))
    this.world.addChild(s, this.bones, this.labels, this.overlay)
    s.update(0)
    this.fit()
  }

  unload() {
    this.world.removeChildren()
    this.spine?.destroy({ children: true })
    this.labels.removeChildren().forEach(l => l.destroy())
    this.bones.clear()
    this.spine = null
    this.playing = false
    this.sel = null
    this.events = []
  }

  setOverlay(k: Overlay, on: boolean) {
    this.overlays[k] = on
    const d = this.debug, o = this.overlays
    d.drawRegionAttachments = o.regions
    d.drawMeshHull = d.drawMeshTriangles = o.meshes
    d.drawBoundingBoxes = o.bboxes
    d.drawClipping = o.clipping
    d.drawPaths = o.paths
  }

  setMix(seconds: number) {
    this.mix = seconds
    if (this.spine) this.spine.stateData.defaultMix = seconds
  }

  get fps() { return this.spine ? frameRate(this.spine.skeleton.data) : null }

  // Forward steps advance like playback (events in the stepped range fire); backward steps seek and fire none.
  step(dir: 1 | -1) {
    const e = this.entry, f = this.fps
    if (!e || !f) return
    this.playing = false
    if (dir > 0) this.spine!.update(1 / f.fps)
    else this.seek(e.getAnimationTime() - 1 / f.fps)
  }

  private logEvent(entry: TrackEntry, e: Event) {
    const d = e.data
    this.events.push({
      seq: ++this.seq, name: d.name, time: e.time, trackTime: entry.trackTime, animation: entry.animation.name,
      int: e.intValue, float: e.floatValue, string: e.stringValue, audio: d.audioPath, volume: e.volume, balance: e.balance,
    })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
  }

  setAnimation(name: string) {
    const s = this.spine
    if (!s) return
    // Without mixing, start from the setup pose so the previous animation leaves nothing behind.
    if (!this.mix) s.skeleton.setToSetupPose()
    s.state.setAnimation(0, name, this.loop)
    s.update(0)
  }

  // Applies to the playing entry too, so turning loop off finishes the current cycle and holds the last frame.
  setLoop(on: boolean) {
    this.loop = on
    if (this.entry) this.entry.loop = on
  }

  get entry() { return this.spine?.state.tracks[0] ?? null }

  time() {
    const e = this.entry
    return e ? { t: e.getAnimationTime(), d: e.animation.duration } : null
  }

  seek(t: number) {
    const e = this.entry
    if (!e) return
    seekTrack(e, t)
    this.spine!.update(0)
  }

  // Restarting re-sets the animation, so its time-0 events fire as they would in a game.
  restart() {
    const e = this.entry
    if (!e) return
    this.setAnimation(e.animation.name)
    this.playing = true
  }

  zoomAt(x: number, y: number, f: number) {
    const w = this.world
    const s = Math.min(20, Math.max(0.05, w.scale.x * f))
    const k = s / w.scale.x
    w.position.set(x - (x - w.x) * k, y - (y - w.y) * k)
    w.scale.set(s)
  }

  zoom(f: number) { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, f) }

  // Fits the current pose's bounds; skeleton width/height are nonessential in 3.8 and may be absent.
  fit() {
    if (!this.spine) return
    const b = this.spine.getLocalBounds()
    const { width: W, height: H } = this.app.screen
    if (!b.width || !b.height) return this.reset()
    const z = Math.min((W * 0.8) / b.width, (H * 0.8) / b.height)
    this.world.scale.set(z)
    this.world.position.set(W / 2 - (b.x + b.width / 2) * z, H / 2 - (b.y + b.height / 2) * z)
  }

  // Default view: 100% zoom, skeleton origin at bottom-centre of the canvas.
  reset() {
    this.world.scale.set(1)
    this.world.position.set(this.app.screen.width / 2, this.app.screen.height * 0.85)
  }

  pick(sx: number, sy: number): Sel {
    const s = this.spine
    if (!s) return null
    const p = s.toLocal(new Point(sx, sy))
    const order = s.skeleton.drawOrder
    for (let i = order.length - 1; i >= 0; i--) {
      const g = geometry(order[i], order[i].getAttachment())
      if (!g) continue
      for (let t = 0; t < g.tris.length; t += 3)
        if (inTriangle(g.v, g.tris[t], g.tris[t + 1], g.tris[t + 2], p.x, p.y)) return { kind: 'slot', name: order[i].data.name }
    }
    let best: Sel = null, bestD = 10 / this.world.scale.x
    for (const b of s.skeleton.bones) {
      const d = Math.hypot(b.worldX - p.x, b.worldY - p.y)
      if (d < bestD) { bestD = d; best = { kind: 'bone', name: b.data.name } }
    }
    return best
  }

  private drawOverlay() {
    const g = this.overlay, s = this.spine!, sel = this.sel
    g.clear()
    if (!sel) return
    const w = 2 / this.world.scale.x
    if (sel.kind === 'bone') {
      const b = s.skeleton.findBone(sel.name)
      if (b) g.lineStyle(w, HIGHLIGHT).drawCircle(b.worldX, b.worldY, 6 * w)
      return
    }
    const slot = s.skeleton.findSlot(sel.kind === 'slot' ? sel.name : sel.slot)
    const att = slot?.getAttachment()
    // Only outline an attachment while it is the one shown; another mesh would read this slot's deform.
    if (!slot || !att || (sel.kind === 'attachment' && att.name !== sel.name)) return
    const geo = geometry(slot, att)
    if (!geo) return
    g.lineStyle(w, HIGHLIGHT)
    g.moveTo(geo.v[0], geo.v[1])
    for (let i = 1; i < geo.hull; i++) g.lineTo(geo.v[i * 2], geo.v[i * 2 + 1])
    g.closePath()
  }

  private drawBones() {
    const g = this.bones, o = this.overlays, sk = this.spine!.skeleton, z = this.world.scale.x
    g.clear()
    this.labels.visible = o.names
    const w = 1.5 / z
    sk.bones.forEach((b, i) => {
      if (o.hierarchy && b.parent)
        g.lineStyle(w, HIERARCHY, 0.7).moveTo(b.parent.worldX, b.parent.worldY).lineTo(b.worldX, b.worldY)
      if (o.bones) {
        g.lineStyle(w, BONE)
        // Bone tip = origin + length along the bone's world x axis (pixi matrix a, b).
        const m = b.matrix, len = b.data.length
        if (len) g.moveTo(b.worldX, b.worldY).lineTo(b.worldX + len * m.a, b.worldY + len * m.b)
        g.drawCircle(b.worldX, b.worldY, 3 * w)
      }
      if (o.names) {
        const l = this.labels.children[i]
        l.position.set(b.worldX + 4 * w, b.worldY - 14 / z)
        l.scale.set(1 / z)
      }
    })
  }

  private bindInput(c: HTMLCanvasElement) {
    let drag: { x: number; y: number; moved: boolean } | null = null
    c.addEventListener('pointerdown', e => { drag = { x: e.offsetX, y: e.offsetY, moved: false }; c.setPointerCapture(e.pointerId) })
    c.addEventListener('pointermove', e => {
      if (!drag) return
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      this.world.position.set(this.world.x + dx, this.world.y + dy)
      drag.x = e.offsetX
      drag.y = e.offsetY
    })
    c.addEventListener('pointerup', e => {
      if (drag && !drag.moved) this.onPick?.(this.pick(e.offsetX, e.offsetY))
      drag = null
    })
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)) }, { passive: false })
  }
}
