import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BaseTexture } from 'pixi.js'
import { AnimationState, AnimationStateData, Skeleton } from '@pixi-spine/all-3.8'
import { buildTree, filterTree, frameRate, gate, limitations, loadSkeleton, seekTrack, type TreeNode } from './spine'

const fx = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8')
// Node may hand back a view into a pooled buffer; the gate must cope with that.
const bytes = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url)) as Uint8Array
const utf8 = (s: string) => new TextEncoder().encode(s)
const json38 = fx('spineboy-3.8/spineboy-pro.json')
const atlas = fx('spineboy-3.8/spineboy.atlas')
const tex = () => new BaseTexture()
const pages = (p: string) => (p === 'spineboy.png' ? tex() : undefined)
const load = (json: any, pg = pages) => loadSkeleton('spineboy-pro.json', { format: 'json', json }, 'spineboy.atlas', atlas, pg)

describe('version gate (P1-08)', () => {
  it('accepts 3.8 JSON', () => {
    const g = gate('spineboy-pro.json', utf8(json38))
    expect(g.ok && g.format === 'json' && g.version).toBe('3.8.55')
  })
  it('accepts 3.8 binary, reading the version from the header', () => {
    const g = gate('spineboy-pro.skel', bytes('spineboy-3.8/spineboy-pro.skel'))
    expect(g.ok && g.format === 'binary' && g.version).toBe('3.8.55')
  })
  it.each([
    ['spineboy-3.7.json', '3.7.90'], ['spineboy-4.0.json', '4.0.31'],
    ['spineboy-3.7.skel', '3.7.90'], ['spineboy-4.0.skel', '4.0.31'],
  ])('rejects %s naming the version', (f, v) => {
    const g = gate(f, bytes(`version-mismatch/${f}`))
    expect(g.ok).toBe(false)
    expect(!g.ok && g.error).toContain(`Spine ${v} detected`)
  })
  it('rejects unreadable binaries and binary data named .json', () => {
    expect(gate('x.skel', new Uint8Array([0xff, 0xff, 0xff])).ok).toBe(false)
    const g = gate('x.json', bytes('spineboy-3.8/spineboy-pro.skel'))
    expect(!g.ok && g.error).toMatch(/not valid JSON/)
  })
  it('rejects 3.7 skins layout even if mislabeled 3.8', () => {
    const j = JSON.parse(fx('version-mismatch/spineboy-3.7.json'))
    j.skeleton.spine = '3.8.99'
    expect(gate('x.json', utf8(JSON.stringify(j))).ok).toBe(false)
  })
  it('is needed: the 3.8 runtime loads 3.7 data with zero skins and no error', () => {
    expect(load(JSON.parse(fx('version-mismatch/spineboy-3.7.json'))).skins.length).toBe(0)
  })
})

describe('binary import', () => {
  it('loads the same skeleton as the JSON export', () => {
    const g = gate('spineboy-pro.skel', bytes('spineboy-3.8/spineboy-pro.skel'))
    if (!g.ok) throw new Error(g.error)
    const bin = loadSkeleton('spineboy-pro.skel', g, 'spineboy.atlas', atlas, pages)
    const json = load(JSON.parse(json38))
    const names = (d: typeof bin) => ({
      bones: d.bones.map(b => b.name), slots: d.slots.map(s => s.name), skins: d.skins.map(s => s.getAttachments().length),
      animations: d.animations.map(a => `${a.name}:${a.duration.toFixed(3)}`), events: d.events.map(e => e.name),
    })
    expect(names(bin)).toEqual(names(json))
  })
})

describe('import (P1-01, P1-02)', () => {
  it('loads spineboy 3.8', () => {
    const d = load(JSON.parse(json38))
    expect(d.bones[0].name).toBe('root')
    expect(d.skins.map(s => s.name)).toEqual(['default'])
    expect(d.animations.map(a => a.name)).toContain('run')
  })
  it('names the missing atlas page', () => {
    expect(() => load(JSON.parse(json38), () => undefined)).toThrow(/spineboy\.atlas: .*"spineboy\.png"/)
  })
  it('names the JSON file and missing region', () => {
    const j = JSON.parse(json38)
    const head = j.skins[0].attachments.head.head
    head.path = 'no-such-region'
    expect(() => load(j)).toThrow(/spineboy-pro\.json: Region not found in atlas: no-such-region/)
  })
})

describe('skeleton tree (P1-03)', () => {
  const d = load(JSON.parse(json38))
  const all: TreeNode[] = []
  const walk = (ns: TreeNode[]) => ns.forEach(n => { all.push(n); walk(n.children) })
  walk(buildTree(d))
  it('contains every bone, slot, and attachment exactly once', () => {
    const count = (k: string) => all.filter(n => n.sel.kind === k).length
    expect(count('bone')).toBe(d.bones.length)
    expect(count('slot')).toBe(d.slots.length)
    expect(count('attachment')).toBe(d.skins.reduce((s, k) => s + k.getAttachments().length, 0))
    expect(new Set(all.map(n => n.id)).size).toBe(all.length)
  })
  it('nests slots under their bone', () => {
    const head = all.find(n => n.id === 'bone:head')!
    expect(head.children.some(c => c.id === 'slot:head')).toBe(true)
  })
})

describe('limitations', () => {
  it('flags dark tint and audio events', () => {
    const j = JSON.parse(json38)
    j.slots[0].dark = '000000'
    j.events.footstep.audio = 'step.ogg'
    expect(limitations(load(j))).toHaveLength(2)
    expect(limitations(load(JSON.parse(json38)))).toEqual([])
  })
})

describe('world space display (P1-04)', () => {
  it('pixi-spine world is y-down; negating y and rotation gives Spine y-up values', () => {
    const sk = new Skeleton(load(JSON.parse(json38)))
    sk.updateWorldTransform()
    const root = sk.findBone('root')!, hip = sk.findBone('hip')!
    expect(-root.getWorldRotationX()).toBeCloseTo(0.28) // root rotation in the JSON
    expect(-hip.worldY).toBeGreaterThan(200) // hip sits ~247 units above root in Spine
  })
})

describe('tree search', () => {
  const tree = buildTree(load(JSON.parse(json38)))
  const ids = (ns: TreeNode[]): string[] => ns.flatMap(n => [n.id, ...ids(n.children)])
  it('keeps matches and their ancestors only, case-insensitive', () => {
    const got = ids(filterTree(tree, '  HAIR3 '))
    expect(got).toContain('bone:hair3')
    expect(got).toContain('bone:head') // ancestor
    expect(got).not.toContain('bone:hair1') // sibling branch
  })
  it('returns the full tree for an empty query and nothing for no match', () => {
    expect(filterTree(tree, ' ')).toBe(tree)
    expect(filterTree(tree, 'zzz')).toEqual([])
  })
})

describe('playback events (P2-04, P2-05)', () => {
  const data = load(JSON.parse(json38))
  const setup = () => {
    const skeleton = new Skeleton(data)
    const state = new AnimationState(new AnimationStateData(data))
    const fired: string[] = []
    state.addListener({ event: (_, e) => fired.push(`${e.data.name}@${+e.time.toFixed(4)}`), complete: () => fired.push('complete') })
    const entry = state.setAnimation(0, 'run', true)
    const tick = (dt: number) => { state.update(dt); state.apply(skeleton) }
    return { entry, fired, tick }
  }

  it('playback fires each footstep once per loop, in order, including the one at 0', () => {
    const { fired, tick } = setup()
    for (let i = 0; i < 48; i++) tick(1 / 30) // 1.6 s = two loops of the 0.8 s run
    expect(fired.filter(f => f !== 'complete')).toEqual(['footstep@0', 'footstep@0.3667', 'footstep@0', 'footstep@0.3667'])
  })

  it('seeking forward or backward fires no events and no loop completion', () => {
    const { entry, fired, tick } = setup()
    tick(0)
    fired.length = 0
    for (const t of [0.5, 0.1, 0.79, 0.37, 0]) { seekTrack(entry, t); tick(0) }
    expect(fired).toEqual([])
    expect(entry.getAnimationTime()).toBe(0)
  })

  it('seek to the end shows the end pose instead of wrapping to 0', () => {
    const { entry, tick } = setup()
    seekTrack(entry, 5)
    tick(0)
    expect(entry.getAnimationTime()).toBeCloseTo(0.8, 3)
  })

  it('uses the default 30 fps when fps was not exported', () => {
    expect(frameRate(data)).toEqual({ fps: 30, exported: false })
  })
})
