import './ui/styles.css'
import { DEFS, ID_TO_NUM, matColor } from './engine/materials.ts'
import { PRESETS } from './engine/grid.ts'
import type { Category } from './engine/types.ts'
import type { ColourMode, ViewMode } from './render/renderer.ts'
import type { FromWorker, ToWorker } from './worker/protocol.ts'
import { SCENES } from './share/scenes.ts'
import { B } from './engine/types.ts'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const CATEGORY_NAMES: Record<Category, string> = {
  powder: '분말', liquid: '액체', gas: '기체', solid: '고체', metal: '금속',
  electronic: '전자', explosive: '폭발물', energy: '에너지', nuclear: '핵', life: '생명', tool: '도구',
}
const CATEGORY_ORDER: Category[] = [
  'powder', 'liquid', 'gas', 'solid', 'metal', 'electronic',
  'explosive', 'energy', 'nuclear', 'life', 'tool',
]
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
  } else if (m.t === 'scene') {
    layer = m.layer
    $('layerLabel').textContent = `층 ${layer + 1}/${size.l}`
    setGroup('modeGroup', 'mode', m.mode)
    setGroup('viewGroup', 'view', 'slice')
    running = true
    $('playBtn').textContent = '⏸'
    showHint(m.name, m.hint)
  } else if (m.t === 'error') {
    console.error('[sandforge]', m.message)
    toast('오류: ' + m.message)
    $('probe').innerHTML = `<span class="warn">오류: ${m.message.split('\n')[0]}</span>`
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
      b.onpointerenter = () => peekInfo(n, b)
      b.onpointerleave = endPeek
      grid.append(b)
    }
    list.append(grid)
  }
}

const BEHAVIOUR_NAMES: [number, string][] = [
  [B.WALL, '파괴 불가'], [B.CLONE, '복제'], [B.VOID, '소멸'], [B.SPARK, '전하'],
  [B.PHOTON, '직진'], [B.NEUTRON, '핵분열 유발'], [B.HEATER, '발열'], [B.COOLER, '냉각'],
  [B.GROW, '성장'], [B.INFECT, '전염'], [B.ABSORB, '흡수'], [B.SEMI_N, 'N형'],
  [B.SEMI_P, 'P형'], [B.BATTERY, '전원'], [B.SWITCH, '스위치'], [B.VIA, '층간 도통'],
  [B.RADIO, '방사성'], [B.ANTIM, '쌍소멸'], [B.PUMP, '가압'], [B.VENT, '감압'],
  [B.CLOCK, '주기 발신'], [B.LAMP, '점등'], [B.SENSOR, '감지'], [B.EXPLODE, '폭발'],
  [B.CORRODE, '부식'], [B.GATE, '논리 게이트'], [B.MAGNET, '자성'], [B.HOLD, '신호 지연'],
]

const matName = (id: string): string => DEFS[ID_TO_NUM.get(id)!]?.name ?? id
const sideName = (v: string | null, fallback: string): string =>
  v === null ? fallback : v === '' ? '소멸' : matName(v)

/**
 * Hover preview. The info panel floats over the list, so it goes on the half
 * away from the hovered button — otherwise it would cover the button, fire
 * pointerleave and flicker.
 */
function peekInfo(n: number, el: HTMLElement): void {
  showInfo(n)
  const list = $('palList')
  const box = $('matInfo')
  const l = list.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const lower = r.top + r.height / 2 > l.top + l.height / 2
  box.style.top = lower ? `${list.offsetTop}px` : ''
  box.style.bottom = lower ? 'auto' : ''
  $('palette').classList.add('peek')
}

/** Hover over: fall back to the picked material, docked at the bottom. */
function endPeek(): void {
  const pal = $('palette')
  pal.classList.remove('peek')
  if (!pal.classList.contains('pinned')) return
  showInfo(current)
  const box = $('matInfo')
  box.style.top = box.style.bottom = ''
}

function showInfo(n: number): void {
  const d = DEFS[n]
  const box = $('matInfo')
  box.hidden = false

  const rows: [string, string][] = [
    ['분류', CATEGORY_NAMES[d.cat]],
    ['상태', PHASE_NAMES[d.phase]],
    ['밀도', d.density >= 1e8 ? '고정' : d.density.toLocaleString()],
  ]
  // Phase changes read as melt/boil or freeze/condense depending on which way
  // the material is going, which is more useful than a raw threshold.
  if (d.hi !== undefined && d.hiInto) {
    const up = DEFS[ID_TO_NUM.get(d.hiInto)!]
    const verb = d.phase === 0 ? (up.phase === 2 ? '녹는점' : '변화') : d.phase === 2 ? '끓는점' : '변화'
    rows.push([verb, `${d.hi}K → ${up.name}`])
  }
  if (d.lo !== undefined && d.loInto) {
    const dn = DEFS[ID_TO_NUM.get(d.loInto)!]
    const verb = d.phase === 2 ? '어는점' : d.phase === 3 ? '응축' : '변화'
    rows.push([verb, `${d.lo}K → ${dn.name}`])
  }
  if (d.burn) {
    rows.push(['발화점', `${d.burnT}K`])
    rows.push(['연소 후', d.burnInto === '' || d.burnInto === undefined ? '소멸' : matName(d.burnInto)])
    if (d.burnHeat) rows.push(['연소 열', `+${d.burnHeat}K`])
  }
  if (d.cond) rows.push(['전기전도', `${Math.round(d.cond * 100)}%`])
  rows.push(['열전도', `${Math.round((d.tK ?? 0.1) * 100)}%`])
  if (d.hcap !== undefined && d.hcap !== 1) rows.push(['열용량', `${d.hcap}×`])
  rows.push(['경도', `${Math.round((d.hard ?? 0.3) * 100)}%`])
  if (d.disp) rows.push(['확산', `${d.disp}칸/틱`])
  if (d.slide) rows.push(['안식각', `${Math.round(d.slide * 100)}%`])
  if (d.t0 !== undefined && d.t0 !== 295) rows.push(['생성 온도', `${d.t0}K`])

  const bits = BEHAVIOUR_NAMES.filter(([bit]) => (d.behav ?? 0) & bit).map(([, name]) => name)
  if (bits.length) rows.push(['특성', bits.join(' · ')])

  const reactions = (d.reacts ?? []).map(r => {
    const other = matName(r.with)
    const a = sideName(r.into[0], d.name)
    const b = sideName(r.into[1], other)
    const cond = r.minT !== undefined ? ` (${r.minT}K 이상)` : r.maxT !== undefined ? ` (${r.maxT}K 이하)` : ''
    const heat = r.heat ? (r.heat > 0 ? ` +${r.heat}K` : ` ${r.heat}K`) : ''
    return `<li><span class="rx-in">${d.name} + ${other}</span><span class="rx-out">→ ${a} + ${b}${cond}${heat}</span></li>`
  })

  box.innerHTML =
    `<h4>${d.name} <span class="code">${d.id}</span></h4>` +
    (d.desc ? `<div class="blurb">${d.desc}</div>` : '') +
    '<dl>' + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>' +
    (reactions.length ? `<div class="rx-head">반응 ${reactions.length}가지</div><ul class="rx">${reactions.join('')}</ul>` : '')
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
  $('palette').classList.add('pinned')
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

// --- examples ----------------------------------------------------------------

function buildExamples(): void {
  const list = $('exList')
  list.innerHTML = ''
  for (const sc of SCENES) {
    const b = document.createElement('button')
    b.className = 'ex'
    b.innerHTML = `<b>${sc.name}</b><span>${sc.hint}</span>`
    b.onclick = () => { send({ t: 'scene', id: sc.id }); $('examples').hidden = true }
    list.append(b)
  }
}

function showHint(name: string, hint: string): void {
  const el = $('hint')
  el.innerHTML = `<b>${name}</b> — ${hint}<button title="닫기">✕</button>`
  el.hidden = false
  el.querySelector('button')!.onclick = () => { el.hidden = true }
}

$('examplesBtn').onclick = () => { $('examples').hidden = false }
$('exClose').onclick = () => { $('examples').hidden = true }
$('examples').onclick = ev => { if (ev.target === $('examples')) $('examples').hidden = true }

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
  else if (k === 'x' || k === 'X') $('examplesBtn').click()
  else if (k === 'Escape') { $('examples').hidden = true }
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
buildExamples()
buildPalette()
renderRecent()
setBrush(brush)
setLayer(0)
showInfo(current)
