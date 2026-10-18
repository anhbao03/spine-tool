import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ALPHA_MODES, BaseTexture, BLEND_MODES } from 'pixi.js'
import {
  AttachmentType, TransformMode,
  type Attachment, type Color, type MeshAttachment, type PointAttachment, type RegionAttachment, type SkeletonData, type VertexAttachment,
} from '@pixi-spine/all-3.8'
import { buildTree, filterTree, gate, limitations, loadSkeleton, selId, type Sel, type TreeNode } from './spine'
import { Viewport } from './viewport'

interface Project {
  name: string; version: string; data: SkeletonData; warnings: string[]; tree: TreeNode[]
  textures: BaseTexture[]; urls: string[]
}

const dispose = (p: Project | null) => {
  p?.textures.forEach(t => t.destroy())
  p?.urls.forEach(u => URL.revokeObjectURL(u))
}

const names = (fs: File[]) => (fs.length ? fs.map(f => f.name).join(', ') : 'none')

// Files come from a picker or drop and are only read, so source files can never be overwritten.
async function importFiles(files: File[], pma: boolean): Promise<Project> {
  const skel = files.filter(f => /\.(json|skel)(\.bytes)?$/i.test(f.name))
  const atlases = files.filter(f => /\.atlas(\.txt)?$/i.test(f.name))
  if (skel.length !== 1) throw new Error(`Expected one skeleton .json file, got ${names(skel)}.`)
  if (atlases.length !== 1) throw new Error(`Expected one .atlas file, got ${names(atlases)}.`)
  const g = gate(skel[0].name, await skel[0].text())
  if (!g.ok) throw new Error(g.error)

  const p: Project = { name: skel[0].name.replace(/\.json$/i, ''), version: g.version, data: null!, warnings: limitations(g.json), tree: [], textures: [], urls: [] }
  try {
    // The atlas parser asks for pages synchronously, so decode every image first.
    const images = new Map<string, HTMLImageElement>()
    for (const f of files.filter(f => f.type.startsWith('image/'))) {
      const url = URL.createObjectURL(f)
      p.urls.push(url)
      const img = new Image()
      img.src = url
      await img.decode().catch(() => { throw new Error(`${f.name}: image could not be decoded.`) })
      images.set(f.name, img)
    }
    p.data = loadSkeleton(skel[0].name, g.json, atlases[0].name, await atlases[0].text(), page => {
      const img = images.get(page) ?? images.get(page.split('/').pop()!)
      if (!img) return undefined
      // 3.8 atlases carry no pma flag, so PMA is a user setting.
      const t = new BaseTexture(img, { alphaMode: pma ? ALPHA_MODES.PMA : ALPHA_MODES.UNPACK })
      p.textures.push(t)
      return t
    })
    p.tree = buildTree(p.data)
    return p
  } catch (e) { dispose(p); throw e }
}

const n = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(3)) : String(v))
const hex = (c: Color, alpha = true) =>
  (alpha ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b]).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
const color = (c: Color | null, alpha = true) =>
  c ? <><span className="swatch" style={{ background: `#${hex(c, false)}`, opacity: c.a }} />{hex(c, alpha)}</> : <span className="muted">none</span>
const BLEND: Record<number, string> = { [BLEND_MODES.NORMAL]: 'normal', [BLEND_MODES.ADD]: 'additive', [BLEND_MODES.MULTIPLY]: 'multiply', [BLEND_MODES.SCREEN]: 'screen' }
const TRANSFORM = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection']
const NONE = new Set<string>()
const empty = <span className="muted">(empty)</span>

function Props({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return <><h3>{title}</h3><table><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></>
}

function attachmentRows(a: Attachment): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [['type', AttachmentType[a.type]]]
  const region = (r: RegionAttachment | MeshAttachment) => rows.push(['atlas region', r.path ?? a.name])
  if (a.type === AttachmentType.Region) {
    const r = a as RegionAttachment
    region(r)
    rows.push(['x', n(r.x)], ['y', n(r.y)], ['rotation (°)', n(r.rotation)], ['scaleX', n(r.scaleX)], ['scaleY', n(r.scaleY)], ['width', n(r.width)], ['height', n(r.height)], ['color', color(r.color)])
  } else if (a.type === AttachmentType.Mesh || a.type === AttachmentType.LinkedMesh) {
    const m = a as MeshAttachment
    region(m)
    if (m.getParentMesh()) rows.push(['parent mesh', m.getParentMesh().name])
    rows.push(['vertices', m.worldVerticesLength / 2], ['triangles', m.triangles.length / 3], ['hull vertices', m.hullLength / 2], ['weighted', m.bones ? 'yes' : 'no'], ['color', color(m.color)])
  } else if (a.type === AttachmentType.Point) {
    const p = a as PointAttachment
    rows.push(['x', n(p.x)], ['y', n(p.y)], ['rotation (°)', n(p.rotation)])
  } else {
    const v = a as VertexAttachment
    rows.push(['vertices', v.worldVerticesLength / 2], ['weighted', v.bones ? 'yes' : 'no'])
  }
  return rows
}

function Inspector({ project, sel, vp }: { project: Project; sel: Sel; vp: Viewport }) {
  const sk = vp.spine?.skeleton
  if (!sel || !sk) return <p className="muted">Select a Bone, Slot, or Attachment in the tree or on the canvas.</p>
  if (sel.kind === 'bone') {
    const b = sk.findBone(sel.name)!
    const d = b.data
    return <>
      <Props title={`Bone · ${d.name}`} rows={[['parent', d.parent?.name ?? <span className="muted">none (root)</span>], ['transform', TRANSFORM[d.transformMode] ?? TransformMode[d.transformMode]], ['length', n(d.length)]]} />
      <Props title="Setup pose · source data · local" rows={[['x', n(d.x)], ['y', n(d.y)], ['rotation (°)', n(d.rotation)], ['scaleX', n(d.scaleX)], ['scaleY', n(d.scaleY)], ['shearX (°)', n(d.shearX)], ['shearY (°)', n(d.shearY)]]} />
      <Props title="Current pose · runtime · local" rows={[['x', n(b.x)], ['y', n(b.y)], ['rotation (°)', n(b.rotation)], ['scaleX', n(b.scaleX)], ['scaleY', n(b.scaleY)], ['shearX (°)', n(b.shearX)], ['shearY (°)', n(b.shearY)]]} />
      {/* pixi-spine computes world space y-down; flip back to Spine's y-up for display. */}
      <Props title="Current pose · runtime · world (Spine y-up)" rows={[['x', n(b.worldX)], ['y', n(-b.worldY)], ['rotation (°)', n(-b.getWorldRotationX())]]} />
    </>
  }
  const slotName = sel.kind === 'slot' ? sel.name : sel.slot
  const slot = sk.findSlot(slotName)!
  const d = slot.data
  const current = slot.getAttachment()
  if (sel.kind === 'slot') return <>
    <Props title={`Slot · ${d.name}`} rows={[['bone', d.boneData.name], ['blend', BLEND[d.blendMode] ?? String(d.blendMode)]]} />
    <Props title="Setup pose · source data" rows={[['attachment', d.attachmentName ?? empty], ['color', color(d.color)], ['dark (two-color)', color(d.darkColor, false)]]} />
    <Props title="Current · runtime" rows={[['attachment', current?.name ?? empty], ['color', color(slot.color)], ['dark (two-color)', color(slot.darkColor, false)]]} />
  </>
  const skin = project.data.findSkin(sel.skin)
  const att = skin?.getAttachment(d.index, sel.name)
  if (!att) return <p className="muted">Attachment not found.</p>
  return <>
    <Props title={`Attachment · ${sel.name}`} rows={[['skin', sel.skin], ['slot', slotName], ['shown now', current === att ? 'yes' : 'no (not the slot’s current attachment)']]} />
    <Props title="Source data · slot-bone local space" rows={attachmentRows(att)} />
  </>
}

function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  return i < 0 ? <>{text}</> : <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

function Tree({ nodes, depth, sel, q, collapsed, toggle, select }: {
  nodes: TreeNode[]; depth: number; sel: string; q: string; collapsed: Set<string>; toggle: (id: string) => void; select: (s: Sel) => void
}) {
  return <>{nodes.map(nd => {
    const open = !collapsed.has(nd.id)
    return <div key={nd.id}>
      <button id={nd.id} className={`row${nd.id === sel ? ' on' : ''}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => select(nd.sel)}
        aria-expanded={nd.children.length ? open : undefined}>
        <span className="caret" onClick={e => { e.stopPropagation(); toggle(nd.id) }}>{nd.children.length ? (open ? '▾' : '▸') : ''}</span>
        <span className={`kind k-${nd.sel.kind}`}>{nd.sel.kind[0].toUpperCase()}</span>
        <span><Mark text={nd.label} q={q} /></span>
      </button>
      {open && nd.children.length > 0 && <Tree nodes={nd.children} depth={depth + 1} sel={sel} q={q} collapsed={collapsed} toggle={toggle} select={select} />}
    </div>
  })}</>
}

function App() {
  const host = useRef<HTMLDivElement>(null)
  const vpRef = useRef<Viewport | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [pending, setPending] = useState<Project | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [pma, setPma] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [anim, setAnim] = useState('')
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [query, setQuery] = useState('')
  const [, tick] = useState(0)

  useEffect(() => {
    let v: Viewport
    try { v = new Viewport(host.current!) } catch (e) {
      setErrors([`Preview unavailable: ${(e as Error).message} WebGL must be enabled.`])
      return
    }
    v.onPick = setSel
    vpRef.current = v
    // Runtime values are polled for the UI (10 Hz); rendering itself runs on the Pixi ticker.
    const id = setInterval(() => tick(t => t + 1), 100)
    return () => { clearInterval(id); v.destroy() }
  }, [])

  const parents = useMemo(() => {
    const m = new Map<string, string>()
    const walk = (ns: TreeNode[], parent?: string) => ns.forEach(c => { if (parent) m.set(c.id, parent); walk(c.children, c.id) })
    walk(project?.tree ?? [])
    return m
  }, [project])

  const id = selId(sel)
  useEffect(() => {
    if (vpRef.current) vpRef.current.sel = sel
    // Expand ancestors so a canvas pick is visible in the tree.
    setCollapsed(c => {
      const next = new Set(c)
      for (let p = parents.get(id); p; p = parents.get(p)) next.delete(p)
      return next.size === c.size ? c : next
    })
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }))
  }, [id, query === ''])

  const q = query.trim()
  const shown = useMemo(() => filterTree(project?.tree ?? [], q), [project, q])

  const vp = vpRef.current

  function show(p: Project) {
    const vp = vpRef.current!
    setProject(old => { dispose(old); return p })
    setPending(null)
    setSel(null)
    setCollapsed(new Set())
    vp.load(p.data)
    const first = p.data.animations[0]?.name ?? ''
    setAnim(first)
    if (first) vp.setAnimation(first)
  }

  async function open(fs: File[], usePma = pma) {
    if (!fs.length) return
    try {
      const p = await importFiles(fs, usePma)
      setFiles(fs)
      setErrors([])
      if (p.warnings.length) { dispose(pending); setPending(p) } else show(p)
    } catch (e) { setErrors(es => [...es, (e as Error).message]) }
  }

  function close() {
    vpRef.current?.unload()
    setProject(old => { dispose(old); return null })
    setSel(null)
    setFiles([])
  }

  const time = vp?.time()
  const animations = project?.data.animations ?? []

  return <div className="app" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); open([...e.dataTransfer.files]) }}>
    <header>
      <span className="title">Spine Inspector{project && <span className="muted"> · {project.name} · Spine {project.version}</span>}</span>
      <input ref={input} type="file" multiple hidden accept=".json,.atlas,.txt,.png,.jpg,.jpeg,.webp,.skel"
        onChange={e => { open([...(e.target.files ?? [])]); e.target.value = '' }} />
      <button onClick={() => input.current?.click()}>Import…</button>
      <label title="3.8 atlases do not record premultiplied alpha; match the export setting.">
        <input type="checkbox" checked={pma} onChange={e => { setPma(e.target.checked); if (project) open(files, e.target.checked) }} /> Premultiplied alpha
      </label>
      <button disabled={!project} onClick={close}>Close</button>
      <span className="muted">|</span>
      <button disabled={!project} onClick={() => vp?.zoom(1.25)} aria-label="Zoom in">+</button>
      <button disabled={!project} onClick={() => vp?.zoom(0.8)} aria-label="Zoom out">−</button>
      <button disabled={!project} onClick={() => vp?.fit()}>Fit</button>
      <button disabled={!project} onClick={() => vp?.reset()} title="100% zoom, origin at bottom centre">Reset view</button>
    </header>

    <div className="msgs">
      {errors.map((m, i) => <div key={i} className="msg err" role="alert"><span>{m}</span><button onClick={() => setErrors(es => es.filter((_, j) => j !== i))}>Dismiss</button></div>)}
      {pending && <div className="msg warn" role="alert">
        <span>{pending.name} (Spine {pending.version}) uses features the preview does not fully support:{'\n'}{pending.warnings.map(w => `• ${w}`).join('\n')}</span>
        <button onClick={() => show(pending)}>Continue in limited mode</button>
        <button onClick={() => { dispose(pending); setPending(null) }}>Cancel</button>
      </div>}
      {project && project.warnings.length > 0 && !pending && <div className="msg warn"><span>Limited mode: {project.warnings.join(' ')}</span></div>}
    </div>

    <nav className="tree" aria-label="Skeleton tree">
      <input className="search" type="search" placeholder="Find bone, slot, attachment…" aria-label="Find in skeleton tree"
        disabled={!project} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQuery('')} />
      {!project ? <p className="muted pad">No project loaded.</p>
        : !shown.length ? <p className="muted pad">No matches for “{q}”.</p>
        // While searching, every match path is shown expanded.
        : <Tree nodes={shown} depth={0} sel={id} q={q} collapsed={q ? NONE : collapsed} select={setSel}
            toggle={k => !q && setCollapsed(c => { const s = new Set(c); s.has(k) ? s.delete(k) : s.add(k); return s })} />}
    </nav>

    <div className="stage">
      <div ref={host} />
      {!project && <div className="drop">Drop a Spine 3.8 export here<br />(.json + .atlas + page images)</div>}
    </div>

    <aside className="inspector" aria-label="Inspector">
      {project && vp ? <Inspector project={project} sel={sel} vp={vp} /> : <p className="muted">Nothing to inspect.</p>}
    </aside>

    <div className="bar">
      <select disabled={!animations.length} value={anim} onChange={e => { setAnim(e.target.value); vp?.setAnimation(e.target.value) }} aria-label="Animation">
        {animations.length ? animations.map(a => <option key={a.name}>{a.name}</option>) : <option>No animations</option>}
      </select>
      <button disabled={!time} onClick={() => { if (vp) vp.playing = !vp.playing }}>{vp?.playing ? 'Pause' : 'Play'}</button>
      <button disabled={!time} onClick={() => vp?.restart()}>Restart</button>
      <input type="range" disabled={!time} min={0} max={time?.d ?? 1} step={0.001} value={time?.t ?? 0}
        onChange={e => vp?.seek(+e.target.value)} aria-label="Animation time" />
      <span className="time">{time ? `${time.t.toFixed(3)} / ${time.d.toFixed(3)} s` : '—'}</span>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
