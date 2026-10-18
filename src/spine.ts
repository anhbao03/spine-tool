import type { BaseTexture } from 'pixi.js'
import { AtlasAttachmentLoader, BinaryInput, SkeletonBinary, SkeletonJson, TextureAtlas, type SkeletonData, type TrackEntry } from '@pixi-spine/all-3.8'

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

// Frame step for single-stepping; skeleton fps is nonessential data in 3.8.
export const frameRate = (d: SkeletonData) => ({ fps: d.fps || 30, exported: d.fps > 0 })
