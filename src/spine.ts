import type { BaseTexture } from 'pixi.js'
import {
  AtlasAttachmentLoader, AttachmentType, BinaryInput, Bone, CurveTimeline, DeformTimeline, EventTimeline, SkeletonBinary, SkeletonJson, TextureAtlas,
  type Animation, type Attachment, type ClippingAttachment, type MeshAttachment, type RegionAttachment, type Skeleton, type SkeletonData,
  type Slot, type SlotData, type TrackEntry,
} from '@pixi-spine/all-3.8'

export type Sel =
  | { kind: 'bone'; name: string }
  | { kind: 'slot'; name: string }
  | { kind: 'attachment'; skin: string; slot: string; name: string }
  | null

export interface TreeNode { id: string; label: string; sel: NonNullable<Sel>; children: TreeNode[] }

export type SkeletonSource = { format: 'json'; json: any } | { format: 'binary'; bytes: Uint8Array }
export type Gate = ({ ok: true; version: string } & SkeletonSource) | { ok: false; error: string }

const looksLikeVersion = (v: unknown): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)
const versionError = (v: string) =>
  v.startsWith('3.8.') ? null : `Spine ${v} detected. Only 3.8.x is supported; the 3.8 runtime can misread other versions without an error.`

// Binary header: 3.x writes the hash and version as strings; 4.x writes an 8-byte hash, then the version string.
export function binaryVersion(bytes: Uint8Array): string | null {
  for (const hashBytes of [0, 8]) {
    try {
      const input = new BinaryInput(bytes)
      if (hashBytes) for (let i = 0; i < hashBytes; i++) input.readByte()
      else input.readString()
      const v = input.readString()
      if (looksLikeVersion(v)) return v
    } catch { /* not this layout */ }
  }
  return null
}

// Runs before the runtime parser: the 3.8 runtime misparses other versions silently
// (3.7 JSON stores skins as an object and loads with zero skins).
export function gate(fileName: string, data: Uint8Array): Gate {
  const fail = (msg: string): Gate => ({ ok: false, error: `${fileName}: ${msg}` })
  if (/\.skel(\.bytes)?$/i.test(fileName)) {
    // BinaryInput reads data.buffer from byte 0, so the bytes must not be a view into a larger buffer.
    const bytes = data.byteOffset || data.byteLength !== data.buffer.byteLength ? data.slice() : data
    const v = binaryVersion(bytes)
    if (!v) return fail('not a readable Spine binary (no version found in the header).')
    const bad = versionError(v)
    if (bad) return fail(bad)
    if (v === '3.8.75') return fail('Spine 3.8.75 binaries are not readable by the 3.8 runtime. Re-export with a newer 3.8 editor.')
    return { ok: true, version: v, format: 'binary', bytes }
  }
  let json: any
  try { json = JSON.parse(new TextDecoder().decode(data)) } catch (e) {
    return fail(`not valid JSON (${(e as Error).message}). Binary exports must use the .skel extension.`)
  }
  const v = json?.skeleton?.spine
  if (typeof v !== 'string') return fail('missing skeleton.spine version; cannot verify this is Spine 3.8 data.')
  const bad = versionError(v)
  if (bad) return fail(bad)
  if (json.skins && !Array.isArray(json.skins)) return fail(`declares ${v} but "skins" is not an array (3.7 layout).`)
  return { ok: true, version: v, format: 'json', json }
}

// Valid 3.8 features the preview does not render faithfully: load in limited mode, after confirmation.
export function limitations(d: SkeletonData): string[] {
  const out: string[] = []
  const dark = d.slots.filter(s => s.darkColor).map(s => s.name)
  if (dark.length) out.push(`Two-color tint (dark color) is not rendered by the preview. Slots: ${dark.join(', ')}.`)
  const audio = d.events.filter(e => e.audioPath).map(e => e.name)
  if (audio.length) out.push(`Audio events are listed but not played. Events: ${audio.join(', ')}.`)
  return out
}

export function loadSkeleton(
  skelName: string, src: SkeletonSource, atlasName: string, atlasText: string,
  pageTexture: (page: string) => BaseTexture | undefined,
): SkeletonData {
  let atlas: TextureAtlas
  try {
    atlas = new TextureAtlas(atlasText, (page, done) => {
      const t = pageTexture(page)
      if (!t) throw new Error(`atlas page image "${page}" was not provided.`)
      done(t)
    })
  } catch (e) { throw new Error(`${atlasName}: ${(e as Error).message}`) }
  const loader = new AtlasAttachmentLoader(atlas)
  try {
    return src.format === 'json' ? new SkeletonJson(loader).readSkeletonData(src.json) : new SkeletonBinary(loader).readSkeletonData(src.bytes)
  } catch (e) { throw new Error(`${skelName}: ${(e as Error).message}`) }
}

export const selId = (s: Sel) =>
  !s ? '' : s.kind === 'attachment' ? `attachment:${JSON.stringify([s.skin, s.slot, s.name])}` : `${s.kind}:${s.name}`

// Keeps nodes whose label contains the query (case-insensitive) plus their ancestors.
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  return nodes.flatMap(n => {
    const children = filterTree(n.children, q)
    return children.length || n.label.toLowerCase().includes(q) ? [{ ...n, children }] : []
  })
}

export function buildTree(d: SkeletonData): TreeNode[] {
  const node = (sel: NonNullable<Sel>, label: string): TreeNode => ({ id: selId(sel), label, sel, children: [] })
  const bones = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  // Spine orders bones parent-first, so the parent node always exists.
  for (const b of d.bones) {
    const n = node({ kind: 'bone', name: b.name }, b.name)
    bones.set(b.name, n)
    ;(b.parent ? bones.get(b.parent.name)!.children : roots).push(n)
  }
  const slots = d.slots.map(s => {
    const n = node({ kind: 'slot', name: s.name }, s.name)
    bones.get(s.boneData.name)!.children.push(n)
    return n
  })
  const multiSkin = d.skins.length > 1
  for (const skin of d.skins) for (const e of skin.getAttachments()) {
    const slot = d.slots[e.slotIndex].name
    slots[e.slotIndex].children.push(node({ kind: 'attachment', skin: skin.name, slot, name: e.name }, multiSkin ? `${e.name} [${skin.name}]` : e.name))
  }
  return roots
}

// Moves a track to time t without firing events or loop completions (plan P2-05): the next
// apply only fires events in (animationLast, t], so every "last" marker moves with the time.
export function seekTrack(e: TrackEntry, t: number) {
  // ponytail: clamp just below the end, since a looping entry wraps t === duration back to 0.
  t = Math.max(0, Math.min(t, e.animation.duration - 1e-4))
  e.trackTime = e.trackLast = e.nextTrackLast = t
  e.animationLast = e.nextAnimationLast = t
}

// Key times across all timelines (deduped, sorted) and events, for the timeline ruler.
// Every 3.8 timeline stores getFrameCount() keys of equal stride in `frames`, time first.
export function keyMarks(anim: Animation) {
  const keys = new Set<number>(), events: { time: number; name: string }[] = []
  for (const t of anim.timelines) {
    if (t instanceof EventTimeline) { for (const e of t.events) events.push({ time: e.time, name: e.data.name }); continue }
    const tl = t as unknown as { frames: ArrayLike<number>; getFrameCount(): number }
    const c = tl.getFrameCount(), stride = tl.frames.length / c
    for (let i = 0; i < c; i++) keys.add(tl.frames[i * stride])
  }
  return { keys: [...keys].sort((a, b) => a - b), events }
}

// Frame step for single-stepping; skeleton fps is nonessential data in 3.8.
export const frameRate = (d: SkeletonData) => ({ fps: d.fps || 30, exported: d.fps > 0 })

// Coordinates here are Spine-container local space, which pixi-spine keeps y-down.
export function geometry(slot: Slot, att: Attachment | null): { v: number[]; tris: number[]; hull: number } | null {
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

// Runtime cost of the current pose and animation, after the Spine editor's Metrics view.
// Attachment metrics follow what a renderer draws this frame: active bones, draw order, clip ranges.
export function metrics(sk: Skeleton, anim: Animation | null) {
  const a = { visible: 0, vertices: 0, vertexTransforms: 0, triangles: 0, area: 0, clipping: 0, clipped: 0 }
  let clipEnd: SlotData | null = null
  for (const slot of sk.drawOrder) {
    if (!slot.bone.active) continue
    const att = slot.getAttachment()
    // Runtimes ignore a clipping attachment while another clip range is open.
    if (att?.type === AttachmentType.Clipping && !clipEnd) { a.clipping++; clipEnd = (att as ClippingAttachment).endSlot }
    const g = geometry(slot, att)
    if (g) {
      const verts = g.v.length / 2, tris = g.tris.length / 3, bones = (att as MeshAttachment).bones
      a.visible++
      a.vertices += verts
      // Weighted mesh: one transform per bone influence; `bones` is [count, index × count, ...] per vertex.
      a.vertexTransforms += bones ? bones.length - verts : verts
      a.triangles += tris
      if (clipEnd) a.clipped += tris
      for (let i = 0; i < g.tris.length; i += 3) {
        const [p, q, r] = [g.tris[i] * 2, g.tris[i + 1] * 2, g.tris[i + 2] * 2], v = g.v
        a.area += Math.abs((v[q] - v[p]) * (v[r + 1] - v[p + 1]) - (v[r] - v[p]) * (v[q + 1] - v[p + 1])) / 2
      }
    }
    if (clipEnd === slot.data) clipEnd = null
  }
  const frames = (t: object) => (t as { getFrameCount(): number }).getFrameCount()
  let keys = 0, bezier = 0, deform = 0
  for (const t of anim?.timelines ?? []) {
    keys += frames(t)
    // The last key has no curve to the next one.
    if (t instanceof CurveTimeline) for (let i = 0; i < frames(t) - 1; i++) if (t.getCurveType(i) === CurveTimeline.BEZIER) bezier++
    if (t instanceof DeformTimeline) for (const f of t.frameVertices) deform += f.length / 2
  }
  return {
    bones: sk.bones.filter(b => b.active).length,
    // World transforms computed per frame: one per bone in the update cache, plus one per bone each constraint
    // (IK, transform, path) transforms again.
    boneTransforms: sk._updateCache.reduce((n, u) => n + (u instanceof Bone ? 1 : (u as unknown as { bones: Bone[] }).bones.length), 0),
    constraints: [...sk.ikConstraints, ...sk.transformConstraints, ...sk.pathConstraints].filter(c => c.isActive()).length,
    slots: sk.slots.length,
    attachments: sk.data.skins.reduce((n, s) => n + s.getAttachments().length, 0),
    ...a,
    timelines: anim?.timelines.length ?? 0, keys, bezier, deform,
  }
}
