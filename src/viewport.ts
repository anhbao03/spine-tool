import { Application, Container, Graphics, Point } from 'pixi.js'
import { AttachmentType, Spine, type Attachment, type MeshAttachment, type RegionAttachment, type SkeletonData, type Slot } from '@pixi-spine/all-3.8'
import type { Sel } from './spine'

const HIGHLIGHT = 0x00e5ff

// Coordinates here are Spine-container local space, which pixi-spine keeps y-down.
function geometry(slot: Slot, att: Attachment | null): { v: number[]; tris: number[]; hull: number } | null {
  if (!att) return null
  if (att.type === AttachmentType.Region) {
    const v = new Array<number>(8)
    ;(att as RegionAttachment).computeWorldVertices(slot.bone, v, 0, 2)
    return { v, tris: [0, 1, 2, 2, 3, 0], hull: 4 }
  }
  if (att.type === AttachmentType.Mesh || att.type === AttachmentType.LinkedMesh) {
    const m = att as MeshAttachment
    const v = new Array<number>(m.worldVerticesLength)
    m.computeWorldVertices(slot, 0, m.worldVerticesLength, v, 0, 2)
    return { v, tris: Array.from(m.triangles), hull: m.hullLength / 2 }
  }
  return null
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
  spine: Spine | null = null
  playing = false
  sel: Sel = null
  onPick?: (s: Sel) => void

  constructor(host: HTMLElement) {
    this.app = new Application({ resizeTo: host, background: '#262626', antialias: true, resolution: devicePixelRatio, autoDensity: true })
    host.appendChild(this.app.view as HTMLCanvasElement)
    this.app.stage.addChild(this.world)
    this.app.ticker.add(() => {
      if (!this.spine) return
      this.spine.update(this.playing ? this.app.ticker.deltaMS / 1000 : 0)
      this.drawOverlay()
    })
    this.bindInput(this.app.view as HTMLCanvasElement)
  }

  destroy() { this.unload(); this.app.destroy(true) }

  load(data: SkeletonData) {
    this.unload()
    const s = new Spine(data)
    s.autoUpdate = false
    this.spine = s
    this.world.addChild(s, this.overlay)
    s.update(0)
    this.fit()
  }

  unload() {
    this.world.removeChildren()
    this.spine?.destroy({ children: true })
    this.spine = null
    this.playing = false
    this.sel = null
  }

  setAnimation(name: string) {
    const s = this.spine
    if (!s) return
    s.skeleton.setToSetupPose()
    s.state.setAnimation(0, name, true)
    s.update(0)
  }

  get entry() { return this.spine?.state.tracks[0] ?? null }

  time() {
    const e = this.entry
    return e ? { t: e.getAnimationTime(), d: e.animation.duration } : null
  }

  seek(t: number) {
    const e = this.entry
    if (!e) return
    // ponytail: clamp just below the end, since a looping entry wraps t === duration back to 0.
    t = Math.max(0, Math.min(t, e.animation.duration - 1e-4))
    // Move animationLast with the time so a seek crosses no events (plan P2-05).
    e.trackTime = t
    e.animationLast = e.nextAnimationLast = t
    this.spine!.update(0)
  }

  restart() { this.seek(0); this.playing = true }

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
