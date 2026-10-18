import type { BaseTexture } from 'pixi.js'
import { AtlasAttachmentLoader, SkeletonJson, TextureAtlas, type SkeletonData } from '@pixi-spine/all-3.8'

export type Sel =
  | { kind: 'bone'; name: string }
  | { kind: 'slot'; name: string }
  | { kind: 'attachment'; skin: string; slot: string; name: string }
  | null

export interface TreeNode { id: string; label: string; sel: NonNullable<Sel>; children: TreeNode[] }

export type Gate = { ok: true; version: string; json: any } | { ok: false; error: string }

// Runs before the runtime parser: the 3.8 runtime misparses other versions silently
// (3.7 JSON stores skins as an object and loads with zero skins).
export function gate(fileName: string, text: string): Gate {
  const fail = (msg: string): Gate => ({ ok: false, error: `${fileName}: ${msg}` })
  if (/\.skel(\.bytes)?$/i.test(fileName)) return fail('binary .skel is not supported yet. Export JSON from Spine 3.8.')
  let json: any
  try { json = JSON.parse(text) } catch (e) {
    return fail(`not valid JSON (${(e as Error).message}). Binary .skel is not supported yet.`)
  }
  const v = json?.skeleton?.spine
  if (typeof v !== 'string') return fail('missing skeleton.spine version; cannot verify this is Spine 3.8 data.')
  if (!v.startsWith('3.8.')) return fail(`Spine ${v} detected. Only 3.8.x is supported; the 3.8 runtime can misread other versions without an error.`)
  if (json.skins && !Array.isArray(json.skins)) return fail(`declares ${v} but "skins" is not an array (3.7 layout).`)
  return { ok: true, version: v, json }
}

// Valid 3.8 features the preview does not render faithfully: load in limited mode, after confirmation.
export function limitations(json: any): string[] {
  const out: string[] = []
  const dark = (json.slots ?? []).filter((s: any) => s.dark).map((s: any) => s.name)
  if (dark.length) out.push(`Two-color tint (dark color) is not rendered by the preview. Slots: ${dark.join(', ')}.`)
  const audio = Object.entries<any>(json.events ?? {}).filter(([, e]) => e.audio).map(([n]) => n)
  if (audio.length) out.push(`Audio events are listed but not played. Events: ${audio.join(', ')}.`)
  return out
}

export function loadSkeleton(
  jsonName: string, json: any, atlasName: string, atlasText: string,
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
  try { return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json) }
  catch (e) { throw new Error(`${jsonName}: ${(e as Error).message}`) }
}

export const selId = (s: Sel) =>
  !s ? '' : s.kind === 'attachment' ? `attachment:${JSON.stringify([s.skin, s.slot, s.name])}` : `${s.kind}:${s.name}`

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
