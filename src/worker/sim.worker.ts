/// <reference lib="webworker" />
import { Sim } from '../engine/sim.ts'
import { Renderer, type ColourMode, type ViewMode } from '../render/renderer.ts'
import { decode, encode } from '../share/save.ts'
import { buildScene } from '../share/scenes.ts'
import type { FromWorker, Telemetry, ToWorker } from './protocol.ts'

// The worker owns the grid AND the canvas. Nothing large ever crosses the
// thread boundary, which matters because GitHub Pages cannot set the headers
// SharedArrayBuffer would need.

let sim: Sim | null = null
let renderer: Renderer | null = null
let running = true
let speed = 1
let frameAccum = 0

const view = {
  layer: 0,
  view: 'slice' as ViewMode,
  mode: 'material' as ColourMode,
  tiltX: 0.06,
  tiltY: 0.03,
  glow: 0.8,
}

const TARGET_MS = 1000 / 60
let simMs = 0, renderMs = 0, frameMs = 16.7
let lastFrame = 0, lastTelemetry = 0

function post(m: FromWorker, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(m, transfer ?? [])
}

function loop(): void {
  const now = performance.now()
  const dt = lastFrame === 0 ? 16.7 : now - lastFrame
  lastFrame = now
  // Smooth the frame *time* and invert it at the end. Averaging instantaneous
  // fps instead reports the fast frames and hides the slow ones, which is how
  // a loop running at a real 40fps ends up claiming 140.
  frameMs = frameMs * 0.9 + Math.min(500, dt) * 0.1

  if (sim && renderer) {
    const t0 = performance.now()
    if (running) {
      frameAccum += speed
      // Above 1x we run several ticks per frame; below 1x we skip frames.
      // Capped so a slow machine degrades by simulating less, not by hanging.
      let budget = Math.min(8, Math.floor(frameAccum))
      frameAccum -= budget
      while (budget-- > 0) sim.step()
    }
    const t1 = performance.now()
    renderer.render(view)
    const t2 = performance.now()
    simMs = simMs * 0.85 + (t1 - t0) * 0.15
    renderMs = renderMs * 0.85 + (t2 - t1) * 0.15

    if (now - lastTelemetry > 250) {
      lastTelemetry = now
      const s = sim.stats()
      const v: Telemetry = {
        fps: Math.round(1000 / Math.max(0.5, frameMs)), simMs, renderMs, tick: s.tick, filled: s.filled,
        activeChunks: s.activeChunks, chunkCount: s.chunkCount, sparks: s.sparks, running,
      }
      post({ t: 'telemetry', v })
    }
  }
  // Pace to the display rate instead of spinning. requestAnimationFrame does
  // not exist in a dedicated worker, so the budget is kept by hand — without
  // it the loop saturates a core and the machine gets hot for no extra frames.
  const spent = performance.now() - now
  setTimeout(loop, Math.max(0, TARGET_MS - spent))
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  try {
    switch (m.t) {
      case 'init': {
        sim = new Sim(m.size)
        renderer = new Renderer(m.canvas, sim)
        renderer.resize(m.w, m.h)
        post({ t: 'ready', w: m.size.w, h: m.size.h, l: m.size.l })
        loop()
        break
      }
      case 'resize':
        renderer?.resize(m.w, m.h)
        break
      case 'stroke':
        sim?.paintLine(m.x0, m.y0, m.x1, m.y1, view.layer, m.mat, m.radius)
        break
      case 'run':
        running = m.running
        break
      case 'stepOnce':
        sim?.step()
        break
      case 'speed':
        speed = m.value
        break
      case 'view':
        if (m.layer !== undefined) view.layer = m.layer
        if (m.view !== undefined) view.view = m.view
        if (m.mode !== undefined) view.mode = m.mode
        if (m.tiltX !== undefined) view.tiltX = m.tiltX
        if (m.tiltY !== undefined) view.tiltY = m.tiltY
        if (m.glow !== undefined) view.glow = m.glow
        break
      case 'probe': {
        if (!sim) break
        const p = sim.probe(m.x, m.y, view.layer)
        post({
          t: 'probe', x: m.x, y: m.y, mat: p.mat, temp: p.temp,
          pressure: p.pressure, charge: p.charge, burning: p.burning,
        })
        break
      }
      case 'clear':
        sim?.reset()
        break
      case 'scene': {
        if (!sim) break
        const scene = buildScene(sim, m.id)
        if (!scene) { post({ t: 'error', message: `예제 '${m.id}' 가 없습니다` }); break }
        // A scene knows which layer and which overlay it is meant to be read in.
        view.layer = scene.layer ?? 0
        view.mode = scene.mode ?? 'material'
        view.view = 'slice'
        running = true
        post({ t: 'scene', id: scene.id, name: scene.name, hint: scene.hint, layer: view.layer, mode: view.mode })
        break
      }
      case 'gravity':
        break
      case 'save': {
        if (!sim) break
        const data = encode(sim.grid)
        post({ t: 'saved', data }, [data])
        break
      }
      case 'load': {
        if (!sim) break
        decode(m.data).apply(sim.grid)
        break
      }
    }
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
