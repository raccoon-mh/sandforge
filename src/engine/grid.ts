import { EMPTY, matLife, matT0 } from './materials.ts'

/** Chunk edge in cells. 32 keeps the dirty bitmap small and the inner run cache-friendly. */
export const CH = 32
export const CH_SHIFT = 5

export const AMBIENT = 295

export interface GridSize { w: number; h: number; l: number }

export const PRESETS: Record<string, GridSize> = {
  small: { w: 320, h: 180, l: 4 },
  medium: { w: 480, h: 270, l: 8 },
  large: { w: 720, h: 405, l: 8 },
}

/**
 * Structure-of-arrays cell store plus the dirty-chunk bookkeeping that lets the
 * tick skip settled regions. A pile of sand that has come to rest costs nothing.
 */
export class Grid {
  readonly w: number
  readonly h: number
  readonly l: number
  readonly layerCells: number
  readonly cells: number
  readonly cx: number
  readonly cy: number
  readonly chunksPerLayer: number
  readonly chunkCount: number

  /** Material index per cell. */
  readonly type: Uint16Array
  /** Temperature in kelvin. */
  readonly temp: Float32Array
  /** Generic counter: fire lifetime, clock phase, sensor threshold, clone payload. */
  readonly life: Uint16Array
  /** Electrical charge level; 0 = not sparked. */
  readonly chg: Uint8Array
  /** Electrical refractory counter — stops a spark running straight back. */
  readonly cool: Uint8Array
  /** Per-cell colour jitter, fixed at spawn so piles do not shimmer. */
  readonly tint: Uint8Array
  /** Tick stamp of the last move, so a cell moves at most once per tick. */
  readonly stamp: Uint8Array
  /** Remaining burn ticks; 0 = not on fire. Kept apart from `life`, which
   *  several materials already use for their own counter. */
  readonly burning: Uint8Array

  /** 1 when the chunk needs simulating this tick. */
  readonly active: Uint8Array
  /** Accumulates wakeups for the next tick. */
  readonly nextActive: Uint8Array
  /** Bit c set = column c of this chunk holds something worth visiting.
   *  Lets a 4-cell-wide waterfall skip the other 28 columns of every chunk it
   *  falls through, which is most of the cost in a busy scene. */
  readonly colMask: Uint32Array
  readonly nextColMask: Uint32Array
  /** Same idea for rows. */
  readonly rowMask: Uint32Array
  readonly nextRowMask: Uint32Array
  /** 1 when the chunk still holds heat that has not settled to ambient. */
  readonly thermal: Uint8Array

  /** Set when a layer changed, so the renderer re-uploads only what moved. */
  readonly layerTouched: Uint8Array

  /** Running count of non-empty cells. Kept up to date by `set` so the HUD
   *  never has to walk a million cells. */
  filled = 0

  constructor(size: GridSize) {
    this.w = size.w; this.h = size.h; this.l = size.l
    this.layerCells = size.w * size.h
    this.cells = this.layerCells * size.l
    this.cx = Math.ceil(size.w / CH)
    this.cy = Math.ceil(size.h / CH)
    this.chunksPerLayer = this.cx * this.cy
    this.chunkCount = this.chunksPerLayer * size.l

    const n = this.cells
    this.type = new Uint16Array(n)
    this.temp = new Float32Array(n).fill(AMBIENT)
    this.life = new Uint16Array(n)
    this.chg = new Uint8Array(n)
    this.cool = new Uint8Array(n)
    this.tint = new Uint8Array(n)
    this.stamp = new Uint8Array(n)
    this.burning = new Uint8Array(n)

    this.active = new Uint8Array(this.chunkCount)
    this.nextActive = new Uint8Array(this.chunkCount)
    this.colMask = new Uint32Array(this.chunkCount)
    this.nextColMask = new Uint32Array(this.chunkCount)
    this.rowMask = new Uint32Array(this.chunkCount)
    this.nextRowMask = new Uint32Array(this.chunkCount)
    this.thermal = new Uint8Array(this.chunkCount)
    this.layerTouched = new Uint8Array(size.l).fill(1)
  }

  /** Cell index from coordinates. Callers are expected to have bounds-checked. */
  idx(x: number, y: number, z: number): number {
    return (z * this.h + y) * this.w + x
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  chunkOf(x: number, y: number, z: number): number {
    return z * this.chunksPerLayer + (y >> CH_SHIFT) * this.cx + (x >> CH_SHIFT)
  }

  /**
   * Wake the region this cell can affect: its own chunk (columns and rows
   * lx-1..lx+1, ly-1..ly+1) and, when it sits on a chunk border, the touching
   * edge of the neighbouring chunk. Only border cells pay for the extra writes.
   */
  wake(x: number, y: number, z: number): void {
    const na = this.nextActive, cm = this.nextColMask, rm = this.nextRowMask
    const bx = x >> CH_SHIFT, by = y >> CH_SHIFT
    const base = z * this.chunksPerLayer
    const lx = x & (CH - 1), ly = y & (CH - 1)

    const bitX = 1 << lx, bitY = 1 << ly
    const spanX = bitX | (bitX >>> 1) | (bitX << 1)
    const spanY = bitY | (bitY >>> 1) | (bitY << 1)

    const self = base + by * this.cx + bx
    na[self] = 1; cm[self] |= spanX; rm[self] |= spanY
    this.layerTouched[z] = 1

    const atLeft = lx === 0 && bx > 0
    const atRight = lx === CH - 1 && bx < this.cx - 1
    const atTop = ly === 0 && by > 0
    const atBottom = ly === CH - 1 && by < this.cy - 1
    if (!atLeft && !atRight && !atTop && !atBottom) return

    const EDGE_HI = 1 << (CH - 1)
    if (atLeft) { const c = self - 1; na[c] = 1; cm[c] |= EDGE_HI; rm[c] |= spanY }
    if (atRight) { const c = self + 1; na[c] = 1; cm[c] |= 1; rm[c] |= spanY }
    if (atTop) { const c = self - this.cx; na[c] = 1; rm[c] |= EDGE_HI; cm[c] |= spanX }
    if (atBottom) { const c = self + this.cx; na[c] = 1; rm[c] |= 1; cm[c] |= spanX }
    if (atLeft && atTop) { const c = self - this.cx - 1; na[c] = 1; cm[c] |= EDGE_HI; rm[c] |= EDGE_HI }
    if (atRight && atTop) { const c = self - this.cx + 1; na[c] = 1; cm[c] |= 1; rm[c] |= EDGE_HI }
    if (atLeft && atBottom) { const c = self + this.cx - 1; na[c] = 1; cm[c] |= EDGE_HI; rm[c] |= 1 }
    if (atRight && atBottom) { const c = self + this.cx + 1; na[c] = 1; cm[c] |= 1; rm[c] |= 1 }
  }

  /** Mark a chunk (and its neighbours) as holding unsettled heat. */
  wakeThermal(x: number, y: number, z: number): void {
    const t = this.thermal
    const bx = x >> CH_SHIFT, by = y >> CH_SHIFT
    const base = z * this.chunksPerLayer
    for (let dy = -1; dy <= 1; dy++) {
      const ny = by + dy
      if (ny < 0 || ny >= this.cy) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = bx + dx
        if (nx < 0 || nx >= this.cx) continue
        t[base + ny * this.cx + nx] = 1
      }
    }
  }

  /** Place a material, resetting the per-cell state that belongs to the old one. */
  set(i: number, mat: number, x: number, y: number, z: number, temp?: number): void {
    const was = this.type[i]
    if (was === EMPTY && mat !== EMPTY) this.filled++
    else if (was !== EMPTY && mat === EMPTY) this.filled--
    this.type[i] = mat
    this.temp[i] = temp ?? (mat === EMPTY ? AMBIENT : matT0[mat])
    this.life[i] = matLife[mat]
    this.chg[i] = 0
    this.cool[i] = 0
    this.burning[i] = 0
    this.tint[i] = (Math.random() * 255) | 0
    this.wake(x, y, z)
    if (this.temp[i] !== AMBIENT) this.wakeThermal(x, y, z)
  }

  clear(): void {
    this.type.fill(EMPTY)
    this.temp.fill(AMBIENT)
    this.life.fill(0)
    this.chg.fill(0)
    this.cool.fill(0)
    this.burning.fill(0)
    this.active.fill(0)
    this.nextActive.fill(0)
    this.colMask.fill(0)
    this.nextColMask.fill(0)
    this.rowMask.fill(0)
    this.nextRowMask.fill(0)
    this.thermal.fill(0)
    this.filled = 0
  }

  /** Full recount. Only used after loading a save, where cells are written in bulk. */
  recount(): void {
    const t = this.type
    let n = 0
    for (let i = 0; i < t.length; i++) if (t[i] !== EMPTY) n++
    this.filled = n
  }
}
