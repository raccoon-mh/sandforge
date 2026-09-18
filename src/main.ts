import './ui/styles.css'
import { DEFS, ID_TO_NUM, matColor } from './engine/materials.ts'
import { PRESETS } from './engine/grid.ts'
import type { Category } from './engine/types.ts'
import type { ColourMode, ViewMode } from './render/renderer.ts'
import type { FromWorker, ToWorker } from './worker/protocol.ts'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const CATEGORY_NAMES: Record<Category, string> = {
  powder: '분말', liquid: '액체', gas: '기체', solid: '고체',
  electronic: '전자', energy: '에너지', nuclear: '핵', life: '생명', tool: '도구',
}
const CATEGORY_ORDER: Category[] = ['powder', 'liquid', 'gas', 'solid', 'electronic', 'energy', 'nuclear', 'life', 'tool']
const PHASE_NAMES = ['고체', '분말', '액체', '기체', '에너지']
const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 8]

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')
const kelvin = (k: number) => `${k.toFixed(0)}K (${(k - 273.15).toFixed(0)}°C)`

// --- state -------------------------------------------------------------------

const size = PRESETS.medium
let current = ID_TO_NUM.get('SAND')!
let brush = 6
let layer = 0
let running = true
let viewport = { x: 0, y: 0, w: 1, h: 1 }
let dpr = Math.min(2, self.devicePixelRatio || 1)
const recent: number[] = ['SAND', 'WATR', 'WALL', 'FIRE', 'OIL', 'IRON', 'WIRE', 'NONE']
  .map(id => ID_TO_NUM.get(id)!)

// --- worker ------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>('view')
if (!('transferControlToOffscreen' in canvas)) {
  document.body.innerHTML =
    '<p style="padding:2rem;line-height:1.7">이 브라우저는 OffscreenCanvas 를 지원하지 않습니다.' +
    '<br>Chrome, Edge, Firefox 또는 Safari 16.4 이상에서 열어 주세요.</p>'
  throw new Error('OffscreenCanvas unsupported')
}

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' })
const send = (m: ToWorker, transfer?: Transferable[]) => worker.postMessage(m, transfer ?? [])

function canvasPixels(): { w: number; h: number } {
  const r = canvas.getBoundingClientRect()
  return { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)) }
}

/**
 * The letterboxed rectangle the grid occupies, in device pixels. Worked out
 * here rather than waiting for the worker to report it — otherwise the first
 * few hundred milliseconds of drawing land outside a placeholder viewport and
 * are silently dropped.
 */
function computeViewport(): void {
  const px = canvasPixels()
  const scale = Math.min(px.w / size.w, px.h / size.h)
  const w = Math.max(1, Math.round(size.w * scale))
  const h = Math.max(1, Math.round(size.h * scale))
  viewport = { x: ((px.w - w) / 2) | 0, y: ((px.h - h) / 2) | 0, w, h }
}

{
  const off = canvas.transferControlToOffscreen()
  const px = canvasPixels()
  send({ t: 'init', canvas: off, size, dpr, w: px.w, h: px.h }, [off])
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data
  if (m.t === 'telemetry') {
    const v = m.v
    const load = v.simMs + v.renderMs
    const cls = load > 14 ? ' class="warn"' : ''
    $('perf').innerHTML =
      `<span${cls}>${v.fps}fps · 시뮬 ${v.simMs.toFixed(1)}ms · 렌더 ${v.renderMs.toFixed(1)}ms</span>` +
      ` &nbsp;·&nbsp; 틱 ${v.tick.toLocaleString()} · 입자 ${v.filled.toLocaleString()}` +
      ` · 활성 ${v.activeChunks}/${v.chunkCount} 청크` +
      (v.sparks ? ` · 전기 ${v.sparks}` : '')
    if (running !== v.running) { running = v.running; $('playBtn').textContent = running ? '⏸' : '▶' }
  } else if (m.t === 'probe') {
    const d = DEFS[m.mat]
    $('probe').innerHTML =
      `(${m.x}, ${m.y}) 층${layer + 1} &nbsp; <b>${m.mat === 0 ? '빈 공간' : d.name}</b>` +
      ` &nbsp;·&nbsp; ${kelvin(m.temp)}` +
      ` &nbsp;·&nbsp; 압력 ${m.pressure.toFixed(1)}` +
      (m.charge ? ' &nbsp;·&nbsp; <b>통전</b>' : '') +
      (m.burning ? ' &nbsp;·&nbsp; <b>연소중</b>' : '')
  } else if (m.t === 'saved') {
    downloadSave(m.data)
  } else if (m.t === 'error') {
    toast('오류: ' + m.message)
  }
}

// --- palette -----------------------------------------------------------------

function buildPalette(filter = ''): void {
  const q = filter.trim().toLowerCase()
  const list = $('palList')
  list.innerHTML = ''
  for (const cat of CATEGORY_ORDER) {
    const items = DEFS.filter(d =>
      d.cat === cat && (!q ||
        d.name.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) ||
        (d.desc ?? '').toLowerCase().includes(q)))
    if (!items.length) continue
    const head = document.createElement('div')
    head.className = 'cat'
    head.textContent = `${CATEGORY_NAMES[cat]} · ${items.length}`
    list.append(head)
    const grid = document.createElement('div')
    grid.className = 'grid'
    for (const d of items) {
      const n = ID_TO_NUM.get(d.id)!
      const b = document.createElement('button')
      b.className = 'mat' + (n === current ? ' on' : '')
      b.dataset.mat = String(n)
      b.title = `${d.name} (${d.id})`
      b.innerHTML = `<span class="swatch" style="background:${hex(matColor[n])}"></span><span class="nm">${d.name}</span>`
      b.onclick = () => pick(n)
      b.onpointerenter = () => showInfo(n)
      grid.append(b)
    }
    list.append(grid)
  }
}

function showInfo(n: number): void {
  const d = DEFS[n]
  const box = $('matInfo')
  box.hidden = false
  const rows: [string, string][] = [
    ['상태', PHASE_NAMES[d.phase]],
    ['밀도', d.density >= 1e8 ? '고정' : d.density.toLocaleString()],
  ]
  if (d.hi !== undefined && d.hiInto) rows.push([`${d.hi}K 이상`, DEFS[ID_TO_NUM.get(d.hiInto)!].name])
  if (d.lo !== undefined && d.loInto) rows.push([`${d.lo}K 이하`, DEFS[ID_TO_NUM.get(d.loInto)!].name])
  if (d.burn) rows.push(['발화점', `${d.burnT}K`])
  if (d.cond) rows.push(['전기전도', `${Math.round(d.cond * 100)}%`])
  if (d.tK !== undefined) rows.push(['열전도', `${Math.round(d.tK * 100)}%`])
  if (d.reacts?.length) {
    for (const r of d.reacts) {
      const other = DEFS[ID_TO_NUM.get(r.with)!]?.name ?? r.with
      const a = r.into[0] === null ? d.name : r.into[0] === '' ? '소멸' : DEFS[ID_TO_NUM.get(r.into[0])!].name
      const b = r.into[1] === null ? other : r.into[1] === '' ? '소멸' : DEFS[ID_TO_NUM.get(r.into[1])!].name
      rows.push([`+ ${other}`, `→ ${a} + ${b}`])
    }
  }
  box.innerHTML =
    `<h4>${d.name} <span style="color:#6f7684;font-weight:400">${d.id}</span></h4>` +
    (d.desc ? `<div>${d.desc}</div>` : '') +
    '<dl>' + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>'
}

function renderRecent(): void {
  const rail = $('recent')
  rail.innerHTML = ''
  recent.forEach((n, k) => {
    const d = DEFS[n]
    const b = document.createElement('div')
    b.className = 'chip' + (n === current ? ' on' : '')
    b.style.background = n === 0
      ? 'repeating-linear-gradient(45deg,#2a2e37 0 6px,#1b1e25 6px 12px)'
      : hex(matColor[n])
    b.title = d.name
    b.innerHTML = `<span class="key">${k + 1}</span><span>${d.name.slice(0, 4)}</span>`
    b.onclick = () => pick(n)
    rail.append(b)
  })
}

function pick(n: number): void {
  current = n
  const at = recent.indexOf(n)
  if (at >= 0) recent.splice(at, 1)
  recent.unshift(n)
  if (recent.length > 8) recent.length = 8
  renderRecent()
  showInfo(n)
  for (const el of document.querySelectorAll<HTMLElement>('.mat')) {
    el.classList.toggle('on', el.dataset.mat === String(n))
  }
}

// --- pointer -----------------------------------------------------------------

function toCell(ev: PointerEvent): { x: number; y: number } | null {
  const r = canvas.getBoundingClientRect()
  const px = (ev.clientX - r.left) * dpr - viewport.x
  const py = (ev.clientY - r.top) * dpr - viewport.y
  if (px < 0 || py < 0 || px >= viewport.w || py >= viewport.h) return null
  return {
    x: Math.min(size.w - 1, Math.max(0, Math.floor(px / viewport.w * size.w))),
    y: Math.min(size.h - 1, Math.max(0, Math.floor(py / viewport.h * size.h))),
  }
}

let drawing = false
let last: { x: number; y: number } | null = null
let probeAt = 0

canvas.addEventListener('pointerdown', ev => {
  const c = toCell(ev)
  if (!c) return
  canvas.setPointerCapture(ev.pointerId)
  drawing = true
  last = c
  send({ t: 'stroke', x0: c.x, y0: c.y, x1: c.x, y1: c.y, mat: ev.shiftKey ? 0 : current, radius: brush })
})

canvas.addEventListener('pointermove', ev => {
  const c = toCell(ev)
  moveRing(ev)
  if (!c) return
  if (drawing && last) {
    send({ t: 'stroke', x0: last.x, y0: last.y, x1: c.x, y1: c.y, mat: ev.shiftKey ? 0 : current, radius: brush })
    last = c
  }
  const now = performance.now()
  if (now - probeAt > 80) { probeAt = now; send({ t: 'probe', x: c.x, y: c.y }) }
})

for (const e of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  canvas.addEventListener(e, () => { drawing = false; last = null })
}
canvas.addEventListener('pointerleave', () => { $('brushRing').style.opacity = '0' })

function moveRing(ev: PointerEvent): void {
  const r = canvas.getBoundingClientRect()
  const ring = $('brushRing')
  const cellPx = viewport.w / size.w / dpr
  const d = Math.max(6, brush * 2 * cellPx)
  ring.style.width = ring.style.height = `${d}px`
  ring.style.left = `${ev.clientX - r.left}px`
  ring.style.top = `${ev.clientY - r.top}px`
  ring.style.opacity = '1'
}

canvas.addEventListener('wheel', ev => {
  ev.preventDefault()
  setBrush(brush + (ev.deltaY < 0 ? 1 : -1))
}, { passive: false })

// --- controls ----------------------------------------------------------------

function setBrush(v: number): void {
  brush = Math.max(1, Math.min(40, v))
  $<HTMLInputElement>('brush').value = String(brush)
  $('brushOut').textContent = String(brush)
}

function setLayer(v: number): void {
  layer = Math.max(0, Math.min(size.l - 1, v))
  $('layerLabel').textContent = `층 ${layer + 1}/${size.l}`
  send({ t: 'view', layer })
}

function setGroup(id: string, attr: string, value: string): void {
  for (const b of document.querySelectorAll<HTMLElement>(`#${id} button`)) {
    b.classList.toggle('on', b.dataset[attr] === value)
  }
}

$('playBtn').onclick = () => { running = !running; $('playBtn').textContent = running ? '⏸' : '▶'; send({ t: 'run', running }) }
$('stepBtn').onclick = () => { if (running) $('playBtn').click(); send({ t: 'stepOnce' }) }
$('layerUp').onclick = () => setLayer(layer + 1)
$('layerDown').onclick = () => setLayer(layer - 1)
$('clearBtn').onclick = () => { send({ t: 'clear' }); toast('격자를 비웠습니다') }
$('paletteBtn').onclick = () => $('palette').classList.add('open')
$('palClose').onclick = () => $('palette').classList.remove('open')

$<HTMLInputElement>('speed').oninput = ev => {
  const v = SPEEDS[+(ev.target as HTMLInputElement).value]
  $('speedLabel').textContent = `${v}×`
  send({ t: 'speed', value: v })
}
$<HTMLInputElement>('brush').oninput = ev => setBrush(+(ev.target as HTMLInputElement).value)
$<HTMLInputElement>('search').oninput = ev => buildPalette((ev.target as HTMLInputElement).value)

for (const b of document.querySelectorAll<HTMLElement>('#viewGroup button')) {
  b.onclick = () => { setGroup('viewGroup', 'view', b.dataset.view!); send({ t: 'view', view: b.dataset.view as ViewMode }) }
}
for (const b of document.querySelectorAll<HTMLElement>('#modeGroup button')) {
  b.onclick = () => { setGroup('modeGroup', 'mode', b.dataset.mode!); send({ t: 'view', mode: b.dataset.mode as ColourMode }) }
}

// --- save / load -------------------------------------------------------------

function downloadSave(data: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `sandforge-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.sfg`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('실험을 저장했습니다')
}

$('saveBtn').onclick = () => send({ t: 'save' })
$('loadBtn').onclick = () => $<HTMLInputElement>('fileInput').click()
$<HTMLInputElement>('fileInput').onchange = async ev => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const data = await file.arrayBuffer()
  send({ t: 'load', data }, [data])
  toast(`${file.name} 을(를) 불러왔습니다`)
}

let toastTimer = 0
function toast(msg: string): void {
  const el = $('toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { el.hidden = true }, 2200)
}

// --- keyboard ----------------------------------------------------------------

addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.target instanceof HTMLInputElement) return
  const k = ev.key
  if (k === ' ') { ev.preventDefault(); $('playBtn').click() }
  else if (k === 'f' || k === 'F') $('stepBtn').click()
  else if (k === '[') setBrush(brush - 1)
  else if (k === ']') setBrush(brush + 1)
  else if (k === 'q' || k === 'Q') setLayer(layer - 1)
  else if (k === 'e' || k === 'E') setLayer(layer + 1)
  else if (k >= '1' && k <= '8') { const n = recent[+k - 1]; if (n !== undefined) pick(n) }
  else if (k === 'v' || k === 'V') {
    const order: ViewMode[] = ['slice', 'stack', 'tilt']
    const cur = document.querySelector<HTMLElement>('#viewGroup .on')!.dataset.view as ViewMode
    document.querySelector<HTMLElement>(`#viewGroup [data-view="${order[(order.indexOf(cur) + 1) % 3]}"]`)!.click()
  } else if (k === 'c' || k === 'C') {
    const order: ColourMode[] = ['material', 'thermal', 'pressure', 'circuit']
    const cur = document.querySelector<HTMLElement>('#modeGroup .on')!.dataset.mode as ColourMode
    document.querySelector<HTMLElement>(`#modeGroup [data-mode="${order[(order.indexOf(cur) + 1) % 4]}"]`)!.click()
  }
})

// --- resize ------------------------------------------------------------------

const ro = new ResizeObserver(() => {
  dpr = Math.min(2, self.devicePixelRatio || 1)
  const px = canvasPixels()
  computeViewport()
  send({ t: 'resize', w: px.w, h: px.h })
})
ro.observe($('stage'))

// --- go ----------------------------------------------------------------------

computeViewport()
buildPalette()
renderRecent()
setBrush(brush)
setLayer(0)
showInfo(current)
