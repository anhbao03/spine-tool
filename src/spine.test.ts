import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BaseTexture } from 'pixi.js'
import { Skeleton } from '@pixi-spine/all-3.8'
import { buildTree, filterTree, gate, limitations, loadSkeleton, type TreeNode } from './spine'

const fx = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8')
const json38 = fx('spineboy-3.8/spineboy-pro.json')
const atlas = fx('spineboy-3.8/spineboy.atlas')
const tex = () => new BaseTexture()
const load = (json: any, pages = (p: string) => (p === 'spineboy.png' ? tex() : undefined)) =>
  loadSkeleton('spineboy-pro.json', json, 'spineboy.atlas', atlas, pages)

describe('version gate (P1-08)', () => {
  it('accepts 3.8', () => {
    const g = gate('spineboy-pro.json', json38)
    expect(g.ok && g.version).toBe('3.8.55')
  })
  it.each([['spineboy-3.7.json', '3.7.'], ['spineboy-4.0.json', '4.0.']])('rejects %s naming the version', (f, v) => {
    const g = gate(f, fx(`version-mismatch/${f}`))
    expect(g.ok).toBe(false)
    expect(!g.ok && g.error).toContain(`Spine ${v}`)
  })
  it('rejects binary .skel clearly', () => {
    const g = gate('spineboy-3.8.skel', 'binary')
    expect(!g.ok && g.error).toMatch(/binary \.skel is not supported/)
  })
  it('rejects 3.7 skins layout even if mislabeled 3.8', () => {
    const j = JSON.parse(fx('version-mismatch/spineboy-3.7.json'))
    j.skeleton.spine = '3.8.99'
    expect(gate('x.json', JSON.stringify(j)).ok).toBe(false)
  })
  it('is needed: the 3.8 runtime loads 3.7 data with zero skins and no error', () => {
    expect(load(JSON.parse(fx('version-mismatch/spineboy-3.7.json'))).skins.length).toBe(0)
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
    const w = limitations({ slots: [{ name: 'a', dark: '000000' }], events: { step: { audio: 'step.ogg' } } })
    expect(w).toHaveLength(2)
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
