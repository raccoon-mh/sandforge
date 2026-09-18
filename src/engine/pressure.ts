import type { Grid } from './grid.ts'

/** Pressure runs on a grid a quarter the linear size of the cell grid. */
export const P_SHIFT = 2

/**
 * Scalar pressure plus the velocity it drives. Solving this per cell is both
 * expensive and unstable; a coarse field is what makes explosions feel like
 * explosions without blowing up the timestep.
 */
export class PressureField {
  readonly pw: number
  readonly ph: number
  readonly perLayer: number
  readonly p: Float32Array
  readonly next: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  /** True while the whole field is at rest — the step is then skipped entirely. */
  quiet = true
  private readonly grid: Grid

  constructor(grid: Grid) {
    this.grid = grid
    this.pw = Math.ceil(grid.w / (1 << P_SHIFT))
    this.ph = Math.ceil(grid.h / (1 << P_SHIFT))
    this.perLayer = this.pw * this.ph
    const n = this.perLayer * grid.l
    this.p = new Float32Array(n)
    this.next = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
  }

  index(x: number, y: number, z: number): number {
    return z * this.perLayer + (y >> P_SHIFT) * this.pw + (x >> P_SHIFT)
  }

  at(x: number, y: number, z: number): number {
    return this.p[this.index(x, y, z)]
  }

  add(x: number, y: number, z: number, amount: number): void {
    if (amount === 0) return
    this.p[this.index(x, y, z)] += amount
    this.quiet = false
  }

  /** A blast: pressure falling off with distance, in coarse cells. */
  impulse(x: number, y: number, z: number, amount: number, radius: number): void {
    this.quiet = false
    const cxc = x >> P_SHIFT, cyc = y >> P_SHIFT
    const r = Math.max(1, radius >> P_SHIFT)
    const base = z * this.perLayer
    for (let dy = -r; dy <= r; dy++) {
      const py = cyc + dy
      if (py < 0 || py >= this.ph) continue
      for (let dx = -r; dx <= r; dx++) {
        const px = cxc + dx
        if (px < 0 || px >= this.pw) continue
        const d2 = dx * dx + dy * dy
        if (d2 > r * r) continue
        this.p[base + py * this.pw + px] += amount / (1 + d2)
      }
    }
  }

  clear(): void {
    this.p.fill(0); this.vx.fill(0); this.vy.fill(0)
    this.quiet = true
  }

  /**
   * One relaxation step. `spread` moves pressure outward, `decay` bleeds it off
   * so a sealed chamber does not ring forever, and the gradient drives velocity.
   */
  step(): void {
    if (this.quiet) return
    const { pw, ph, perLayer, p, next, vx, vy } = this
    const layers = this.grid.l
    const spread = 0.34, decay = 0.992, accel = 0.42, damp = 0.9
    let peak = 0

    for (let z = 0; z < layers; z++) {
      const base = z * perLayer
      for (let y = 0; y < ph; y++) {
        const row = base + y * pw
        for (let x = 0; x < pw; x++) {
          const i = row + x
          const c = p[i]
          const l = x > 0 ? p[i - 1] : c
          const r = x < pw - 1 ? p[i + 1] : c
          const u = y > 0 ? p[i - pw] : c
          const d = y < ph - 1 ? p[i + pw] : c
          const np = (c + (l + r + u + d - 4 * c) * spread * 0.25) * decay
          next[i] = np
          const nvx = (vx[i] + (l - r) * accel) * damp
          const nvy = (vy[i] + (u - d) * accel) * damp
          vx[i] = nvx; vy[i] = nvy
          const mag = Math.abs(np) + Math.abs(nvx) + Math.abs(nvy)
          if (mag > peak) peak = mag
        }
      }
    }
    p.set(next)
    // Below this the field is indistinguishable from still air; stop stepping it.
    if (peak < 0.01) { p.fill(0); vx.fill(0); vy.fill(0); this.quiet = true }
  }
}
