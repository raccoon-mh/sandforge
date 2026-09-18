import type { ColourMode, ViewMode } from '../render/renderer.ts'
import type { GridSize } from '../engine/grid.ts'

export type ToWorker =
  | { t: 'init'; canvas: OffscreenCanvas; size: GridSize; dpr: number; w: number; h: number }
  | { t: 'resize'; w: number; h: number }
  | { t: 'stroke'; x0: number; y0: number; x1: number; y1: number; mat: number; radius: number }
  | { t: 'run'; running: boolean }
  | { t: 'stepOnce' }
  | { t: 'speed'; value: number }
  | { t: 'view'; layer?: number; view?: ViewMode; mode?: ColourMode; tiltX?: number; tiltY?: number; glow?: number }
  | { t: 'probe'; x: number; y: number }
  | { t: 'clear' }
  | { t: 'scene'; id: string }
  | { t: 'gravity'; value: number }
  | { t: 'save' }
  | { t: 'load'; data: ArrayBuffer }

export interface Telemetry {
  fps: number
  simMs: number
  renderMs: number
  tick: number
  filled: number
  activeChunks: number
  chunkCount: number
  sparks: number
  running: boolean
}

export type FromWorker =
  | { t: 'ready'; w: number; h: number; l: number }
  | { t: 'telemetry'; v: Telemetry }
  | { t: 'probe'; x: number; y: number; mat: number; temp: number; pressure: number; charge: number; burning: number }
  | { t: 'saved'; data: ArrayBuffer }
  | { t: 'scene'; id: string; name: string; hint: string; layer: number; mode: ColourMode }
  | { t: 'error'; message: string }
