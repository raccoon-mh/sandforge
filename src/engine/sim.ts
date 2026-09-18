import { Grid, AMBIENT, CH, CH_SHIFT, type GridSize } from './grid.ts'
import { PressureField } from './pressure.ts'
import { B, Gate, Phase } from './types.ts'
import {
  EMPTY, ID_TO_NUM,
  matPhase, matDensity, matDisp, matSlide, matTK, matHcap, matLo, matLoInto,
  matHi, matHiInto, matBurn, matBurnT, matBurnInto, matBurnHeat, matFlameT, matCond, matHard,
  matLife, matBehav, matDecay, matDies, matReactive, matSelfActive, matIgniter, matGate,
  ruleStart, ruleCount, ruleWith, ruleSelf, ruleOther, ruleP, ruleMinT, ruleMaxT, ruleHeat,
} from './materials.ts'

function M(id: string): number {
  const n = ID_TO_NUM.get(id)
  if (n === undefined) throw new Error(`알 수 없는 물질 ${id}`)
  return n
}

const FIRE = M('FIRE'), SMKE = M('SMKE'), PLSM = M('PLSM')
const WATR = M('WATR'), STEM = M('STEM'), OXYG = M('OXYG'), NEUT = M('NEUT')
const LAVA = M('LAVA'), SPRK = M('SPRK'), GLAS = M('GLAS'), FILT = M('FILT')
const URAN = M('URAN'), PLUT = M('PLUT'), DEUT = M('DEUT'), MUD = M('MUD')
const THOR = M('THOR'), TRIT = M('TRIT'), IRND = M('IRND'), BRMT = M('BRMT')

/**
 * How many ticks a cell holds a charge before passing it on. A delay line or
 * capacitor sits on it deliberately; P-type holds so that a gate reading it
 * sees a level rather than a one-tick blip; everything else passes it on at
 * the next tick. Painting a spark by hand goes through here too, or a hand-fed
 * input would behave differently from a wired one.
 */
function chargeLevel(mat: number): number {
  const bh = matBehav[mat]
  if (bh & B.HOLD) return Math.max(2, matLife[mat])
  if (bh & (B.LAMP | B.SEMI_P)) return 10
  return 1
}

/** 8-neighbourhood, clockwise from up. Index doubles as the direction byte. */
const DX = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1])
const DY = new Int8Array([-1, -1, 0, 1, 1, 1, 0, -1])

/** Air is a gas of this density; anything lighter rises through it. */
const AIR_DENSITY = 1.2
const HEAT_RATE = 0.16
/** Hard ceiling on temperature. Nothing in the material table needs more, and
 *  a runaway that gets past the stability clamp still cannot reach Infinity. */
const T_CEILING = 1e5

export interface SimStats {
  tick: number
  filled: number
  activeChunks: number
  chunkCount: number
  sparks: number
}

export interface Probe {
  mat: number
  temp: number
  pressure: number
  vx: number
  vy: number
  charge: number
  life: number
  burning: number
}

export class Sim {
  grid: Grid
  pf: PressureField
  tick = 0

  /** Cells currently carrying a spark, and cells cooling down after one. */
  private sparkList: number[] = []
  private coolList: number[] = []

  private tempNext: Float32Array
  private stampByte = 1
  private seed = 0x2f6f5b21

  constructor(size: GridSize) {
    this.grid = new Grid(size)
    this.pf = new PressureField(this.grid)
    this.tempNext = new Float32Array(this.grid.cells)
  }

  // --- deterministic rng -----------------------------------------------------
  // xorshift32. Seeded, so the same save and the same inputs replay the same.

  setSeed(s: number): void { this.seed = s >>> 0 || 1 }

  private rnd(): number {
    let x = this.seed
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    this.seed = x
    return x * 2.3283064365386963e-10
  }

  private rndInt(n: number): number { return (this.rnd() * n) | 0 }

  // --- public api ------------------------------------------------------------

  reset(): void {
    this.grid.clear()
    this.pf.clear()
    this.sparkList.length = 0
    this.coolList.length = 0
    this.tick = 0
  }

  stats(): SimStats {
    const a = this.grid.active
    let active = 0
    for (let i = 0; i < a.length; i++) active += a[i]
    return {
      tick: this.tick,
      filled: this.grid.filled,
      activeChunks: active,
      chunkCount: this.grid.chunkCount,
      sparks: this.sparkList.length,
    }
  }

  probe(x: number, y: number, z: number): Probe {
    const g = this.grid
    const i = g.idx(x, y, z)
    const pi = this.pf.index(x, y, z)
    return {
      mat: g.type[i], temp: g.temp[i], pressure: this.pf.p[pi],
      vx: this.pf.vx[pi], vy: this.pf.vy[pi],
      charge: g.chg[i], life: g.life[i], burning: g.burning[i],
    }
  }

  /** Paint a filled circle of `mat`. `mat === EMPTY` erases. */
  paint(cxp: number, cyp: number, z: number, mat: number, radius: number, replaceOnly = false): void {
    const g = this.grid
    const r2 = radius * radius
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cyp + dy
      if (y < 0 || y >= g.h) continue
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cxp + dx
        if (x < 0 || x >= g.w) continue
        if (dx * dx + dy * dy > r2) continue
        const i = g.idx(x, y, z)
        const cur = g.type[i]
        if (matBehav[cur] & B.WALL && mat !== EMPTY) continue
        if (replaceOnly && cur === EMPTY) continue
        if (mat === SPRK) {
          // A spark is not a material you can stack — it is a charge on a conductor.
          if (matCond[cur] > 0 && g.cool[i] === 0) {
            const held = g.chg[i] !== 0
            if (held && (matBehav[cur] & B.SEMI_P) === 0) continue
            g.chg[i] = chargeLevel(cur)
            if (!held) this.sparkList.push(i)
            g.wake(x, y, z)
          }
          continue
        }
        g.set(i, mat, x, y, z)
      }
    }
  }

  /** Paint along a segment so fast mouse drags do not leave gaps. */
  paintLine(x0: number, y0: number, x1: number, y1: number, z: number, mat: number, radius: number): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    if (steps === 0) { this.paint(x0, y0, z, mat, radius); return }
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      this.paint(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), z, mat, radius)
    }
  }

  step(): void {
    this.tick++
    this.stampByte = (this.stampByte + 1) & 0xff
    if (this.stampByte === 0) { this.grid.stamp.fill(0); this.stampByte = 1 }

    const g = this.grid
    g.active.set(g.nextActive)
    g.nextActive.fill(0)
    g.colMask.set(g.nextColMask); g.nextColMask.fill(0)
    g.rowMask.set(g.nextRowMask); g.nextRowMask.fill(0)

    this.cellPass()
    this.heatPass()
    this.pf.step()
    this.electricPass()

  }

  // --- the cell pass ---------------------------------------------------------
  // Rows run bottom-to-top so a falling grain moves one cell per tick, and the
  // x direction alternates to keep piles from leaning. Clean chunks are skipped
  // a whole 32-cell run at a time.

  private cellPass(): void {
    const g = this.grid
    const { w, h, l, cx, chunksPerLayer } = g
    const active = g.active, colMask = g.colMask, rowMask = g.rowMask

    for (let z = 0; z < l; z++) {
      const chunkBase = z * chunksPerLayer
      for (let y = h - 1; y >= 0; y--) {
        const rowChunk = chunkBase + (y >> CH_SHIFT) * cx
        const rowBit = 1 << (y & (CH - 1))
        const flip = ((this.tick + y) & 1) === 1
        for (let c = 0; c < cx; c++) {
          const ci = flip ? cx - 1 - c : c
          const chunk = rowChunk + ci
          if (active[chunk] === 0) continue
          if ((rowMask[chunk] & rowBit) === 0) continue
          const x0 = ci << CH_SHIFT
          const limit = Math.min(w, x0 + CH) - x0
          let m = colMask[chunk]
          // Trim columns that fall past the grid edge in the last chunk.
          if (limit < CH) m &= (1 << limit) - 1
          if (flip) {
            while (m !== 0) {
              const b = 31 - Math.clz32(m)
              m &= ~(1 << b)
              this.updateCell(x0 + b, y, z)
            }
          } else {
            while (m !== 0) {
              const low = m & -m
              const b = 31 - Math.clz32(low)
              m ^= low
              this.updateCell(x0 + b, y, z)
            }
          }
        }
      }
    }
  }

  private updateCell(x: number, y: number, z: number): void {
    const g = this.grid
    const i = g.idx(x, y, z)
    const t = g.type[i]
    if (t === EMPTY) return
    if (g.stamp[i] === this.stampByte) return

    const bh = matBehav[t]
    if (bh & B.WALL) return

    // Only cells that act on their own keep the chunk awake. Everything else
    // sleeps as soon as it stops moving; a neighbour's change wakes it again.
    if (matSelfActive[t] || g.burning[i] !== 0) g.wake(x, y, z)

    // 1. temperature transitions
    const temp = g.temp[i]
    const hi = matHi[t]
    if (temp >= hi) { this.transform(i, x, y, z, matHiInto[t]); return }
    const lo = matLo[t]
    if (lo >= 0 && temp <= lo) { this.transform(i, x, y, z, matLoInto[t]); return }

    // 2. lifetime
    if (matDecay[t]) {
      const lf = g.life[i]
      if (lf <= 1) { this.transform(i, x, y, z, matDies[t]); return }
      g.life[i] = lf - 1
    }

    // 3. fire and ignition
    if (g.burning[i] > 0) { if (this.burnStep(i, x, y, z, t)) return }
    else if (matBurn[t] > 0 && temp >= matBurnT[t]) this.ignite(i, x, y, z, t)

    // 4. behaviours
    if (bh !== 0 && this.behaviour(i, x, y, z, t, bh)) return

    // 5. one pair reaction against a random neighbour
    if ((matReactive[t] || matIgniter[t]) && this.react(i, x, y, z, t)) return

    // 6. movement
    const phase = matPhase[t]
    if (phase === Phase.Powder) this.movePowder(i, x, y, z, t)
    else if (phase === Phase.Liquid) this.moveLiquid(i, x, y, z, t)
    else if (phase === Phase.Gas) this.moveGas(i, x, y, z, t)
    else if (phase === Phase.Energy) this.moveEnergy(i, x, y, z, t, bh)
  }

  // --- transforms ------------------------------------------------------------

  private transform(i: number, x: number, y: number, z: number, into: number): void {
    const g = this.grid
    const keep = g.temp[i]
    g.set(i, into, x, y, z, keep)
    g.stamp[i] = this.stampByte
    g.wakeThermal(x, y, z)
  }

  private ignite(i: number, x: number, y: number, z: number, t: number): void {
    const g = this.grid
    if (matBehav[t] & B.EXPLODE) {
      const power = matBurnHeat[t] * 0.05
      this.explode(x, y, z, power, 3 + ((matBurnHeat[t] / 300) | 0))
      this.transform(i, x, y, z, FIRE)
      return
    }
    g.burning[i] = 40 + this.rndInt(60)
    g.wakeThermal(x, y, z)
  }

  /** Returns true when the cell no longer exists. */
  private burnStep(i: number, x: number, y: number, z: number, t: number): boolean {
    const g = this.grid
    const left = g.burning[i] - 1
    // Burning heats towards a flame temperature and stops there. Adding the
    // release every tick without a ceiling took thermite past 14,000K, which
    // is hotter than the surface of the sun by a factor of two.
    const ceiling = matFlameT[t]
    const cur = g.temp[i]
    if (cur < ceiling) {
      g.temp[i] = Math.min(ceiling, cur + matBurnHeat[t] * 0.06 / matHcap[t])
    }
    g.wakeThermal(x, y, z)
    // Spread to a neighbour: flame into open air, and straight into anything
    // flammable it is touching. Solid timber has no empty neighbours to flame
    // into, so without the second half a fire never eats past its own surface.
    const d = this.rndInt(8)
    const nx = x + DX[d], ny = y + DY[d]
    if (g.inBounds(nx, ny)) {
      const j = g.idx(nx, ny, z)
      const o = g.type[j]
      if (o === EMPTY) { if (this.rnd() < 0.35) g.set(j, FIRE, nx, ny, z) }
      else if (matBurn[o] > 0 && g.burning[j] === 0 && this.rnd() < matBurn[o] * 0.25) {
        this.ignite(j, nx, ny, z, o)
      }
    }
    if (left <= 0) {
      g.burning[i] = 0
      this.transform(i, x, y, z, matBurnInto[t])
      return true
    }
    g.burning[i] = left
    return false
  }

  private explode(x: number, y: number, z: number, power: number, radius: number): void {
    const g = this.grid
    this.pf.impulse(x, y, z, power * 8, radius)
    const r2 = radius * radius
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= g.h) continue
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= g.w) continue
        const d2 = dx * dx + dy * dy
        if (d2 > r2) continue
        const j = g.idx(nx, ny, z)
        const tt = g.type[j]
        if (matBehav[tt] & B.WALL) continue
        if (tt === EMPTY) {
          if (this.rnd() < 0.45) g.set(j, FIRE, nx, ny, z)
          continue
        }
        g.temp[j] += power * 40 / (1 + d2)
        if (this.rnd() < (0.7 - matHard[tt]) * (1 - d2 / (r2 + 1))) {
          g.set(j, this.rnd() < 0.3 ? SMKE : EMPTY, nx, ny, z)
        }
        g.wake(nx, ny, z)
      }
    }
    g.wakeThermal(x, y, z)
  }

  // --- reactions -------------------------------------------------------------

  private react(i: number, x: number, y: number, z: number, t: number): boolean {
    const g = this.grid

    if (matReactive[t]) {
      const d = this.rndInt(8)
      const nx = x + DX[d], ny = y + DY[d]
      if (g.inBounds(nx, ny)) {
        const j = g.idx(nx, ny, z)
        if (this.applyRules(t, g.type[j], i, j, x, y, nx, ny, z)) return true
      }
    }

    // Fire lights everything it touches. Igniters are rare, so the full
    // eight-neighbour sweep is cheap — and a single random probe was not
    // enough to make a fire actually spread through a wall of timber.
    if (matIgniter[t]) {
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]
        if (!g.inBounds(nx, ny)) continue
        const j = g.idx(nx, ny, z)
        const o = g.type[j]
        if (matBurn[o] > 0 && g.burning[j] === 0 && this.rnd() < matBurn[o] * 0.5) {
          this.ignite(j, nx, ny, z, o)
        }
      }
    }
    return false
  }

  /**
   * Keep a reaction product inside its own stable band. Without this, lava's
   * -200K cooling lands on the steam it just made, the steam condenses, the
   * water then freezes, and the pool fills with ice.
   */
  private stable(mat: number, t: number): number {
    const lo = matLo[mat]
    if (lo >= 0 && t <= lo) return lo + 5
    const hi = matHi[mat]
    if (t >= hi) return hi - 5
    return t
  }

  private applyRules(self: number, other: number, si: number, oi: number,
                     sx: number, sy: number, ox: number, oy: number, z: number): boolean {
    const n = ruleCount[self]
    if (n === 0) return false
    const g = this.grid
    const at = ruleStart[self]
    const temp = (g.temp[si] + g.temp[oi]) * 0.5
    for (let k = at; k < at + n; k++) {
      if (ruleWith[k] !== other) continue
      if (temp < ruleMinT[k] || temp > ruleMaxT[k]) continue
      if (this.rnd() >= ruleP[k]) continue
      const heat = ruleHeat[k]
      const ns = ruleSelf[k], no = ruleOther[k]
      if (no >= 0) { g.set(oi, no, ox, oy, z, this.stable(no, g.temp[oi] + heat)) }
      else { g.temp[oi] += heat; g.wake(ox, oy, z) }
      if (ns >= 0) {
        g.set(si, ns, sx, sy, z, this.stable(ns, g.temp[si] + heat))
        g.stamp[si] = this.stampByte
      } else {
        g.temp[si] += heat
      }
      if (heat !== 0) g.wakeThermal(sx, sy, z)
      return ns >= 0
    }
    return false
  }

  // --- behaviours ------------------------------------------------------------
  // Returns true when the cell was consumed or must not move this tick.

  private behaviour(i: number, x: number, y: number, z: number, t: number, bh: number): boolean {
    const g = this.grid

    // A heater holds its neighbours at a temperature; it does not pour heat in
    // forever. The earlier version added a fixed number of kelvin per tick and
    // a heat exchanger left running reached 20,000K.
    if (bh & B.HEATER) { this.driveTemp(x, y, z, g.life[i] || 1200); return false }
    if (bh & B.COOLER) { this.driveTemp(x, y, z, g.life[i] || 77); return false }

    if (bh & B.VOID) {
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]
        if (!g.inBounds(nx, ny)) continue
        const j = g.idx(nx, ny, z)
        const o = g.type[j]
        if (o !== EMPTY && !(matBehav[o] & B.WALL)) g.set(j, EMPTY, nx, ny, z)
      }
      return false
    }

    if (bh & B.CLONE) {
      const payload = g.life[i]
      if (payload === 0) {
        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d], ny = y + DY[d]
          if (!g.inBounds(nx, ny)) continue
          const o = g.type[g.idx(nx, ny, z)]
          if (o !== EMPTY && !(matBehav[o] & (B.CLONE | B.WALL))) { g.life[i] = o; break }
        }
      } else {
        const d = this.rndInt(8)
        const nx = x + DX[d], ny = y + DY[d]
        if (g.inBounds(nx, ny)) {
          const j = g.idx(nx, ny, z)
          if (g.type[j] === EMPTY) g.set(j, payload, nx, ny, z)
        }
      }
      return false
    }

    if (bh & B.ANTIM) {
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]
        if (!g.inBounds(nx, ny)) continue
        const j = g.idx(nx, ny, z)
        const o = g.type[j]
        if (o === EMPTY || (matBehav[o] & B.WALL)) continue
        g.set(j, EMPTY, nx, ny, z)
        g.set(i, EMPTY, x, y, z)
        this.explode(x, y, z, 60, 9)
        return true
      }
      return false
    }

    if (bh & B.RADIO) {
      if (this.rnd() < 0.0025) this.emit(x, y, z, NEUT, this.rndInt(8))
      return false
    }

    if (bh & B.NEUTRON) {
      // Fission and fusion live here: the neutron is the only thing that triggers them.
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]
        if (!g.inBounds(nx, ny)) continue
        const k = g.idx(nx, ny, z)
        const o = g.type[k]
        if (o === URAN || o === PLUT || o === THOR) {
          g.set(k, LAVA, nx, ny, z, g.temp[k] + (o === PLUT ? 4200 : o === THOR ? 1500 : 2600))
          g.wakeThermal(nx, ny, z)
          this.emit(nx, ny, z, NEUT, this.rndInt(8))
          this.emit(nx, ny, z, NEUT, this.rndInt(8))
          this.pf.add(nx, ny, z, 14)
          g.set(i, EMPTY, x, y, z)
          return true
        }
        if ((o === DEUT || o === TRIT) && g.temp[k] > (o === TRIT ? 2000 : 3000)) {
          g.set(k, PLSM, nx, ny, z, g.temp[k] + 6000)
          this.emit(nx, ny, z, NEUT, this.rndInt(8))
          this.pf.add(nx, ny, z, 30)
          g.set(i, EMPTY, x, y, z)
          return true
        }
      }
      return false
    }

    if (bh & B.GROW) {
      let budget = g.life[i]
      if (budget > 0) {
        let wet = false
        for (let d = 0; d < 8 && !wet; d++) {
          const nx = x + DX[d], ny = y + DY[d]
          if (!g.inBounds(nx, ny)) continue
          const o = g.type[g.idx(nx, ny, z)]
          if (o === WATR || o === MUD) wet = true
        }
        if (wet && this.rnd() < 0.08) {
          const d = this.rndInt(8)
          const nx = x + DX[d], ny = y + DY[d]
          if (g.inBounds(nx, ny)) {
            const j = g.idx(nx, ny, z)
            if (g.type[j] === EMPTY) {
              g.set(j, t, nx, ny, z)
              g.life[j] = Math.max(0, budget - 1)
              budget--
            }
          }
          g.life[i] = budget
        }
      }
      return false
    }

    if (bh & B.INFECT) {
      const d = this.rndInt(8)
      const nx = x + DX[d], ny = y + DY[d]
      if (g.inBounds(nx, ny)) {
        const j = g.idx(nx, ny, z)
        const o = g.type[j]
        if (o !== EMPTY && o !== t && matPhase[o] !== Phase.Energy &&
            matHard[o] < 0.3 && this.rnd() < 0.05) {
          g.set(j, t, nx, ny, z)
        }
      }
      return false
    }

    if (bh & B.ABSORB) {
      if (g.life[i] < 24) {
        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d], ny = y + DY[d]
          if (!g.inBounds(nx, ny)) continue
          const j = g.idx(nx, ny, z)
          const o = g.type[j]
          if (o !== EMPTY && matPhase[o] === Phase.Liquid) {
            g.set(j, EMPTY, nx, ny, z)
            g.life[i]++
            break
          }
        }
      } else if (g.temp[i] > 360) {
        const d = this.rndInt(8)
        const nx = x + DX[d], ny = y + DY[d]
        if (g.inBounds(nx, ny)) {
          const j = g.idx(nx, ny, z)
          if (g.type[j] === EMPTY) { g.set(j, STEM, nx, ny, z); g.life[i]-- }
        }
      }
      return false
    }

    if (bh & B.CORRODE) {
      const d = this.rndInt(8)
      const nx = x + DX[d], ny = y + DY[d]
      if (g.inBounds(nx, ny)) {
        const j = g.idx(nx, ny, z)
        const o = g.type[j]
        if (o !== EMPTY && o !== t && !(matBehav[o] & B.WALL)) {
          const hard = matHard[o]
          if (hard < 1 && this.rnd() < (1 - hard) * 0.25) {
            g.set(j, EMPTY, nx, ny, z)
            if (this.rnd() < 0.2) { g.set(i, EMPTY, x, y, z); return true }
          }
        }
      }
      return false
    }

    if (bh & B.PHOTON) { this.moveBallistic(i, x, y, z, B.PHOTON); return true }

    if (bh & B.PUMP) { if (g.chg[i] > 0) this.pf.add(x, y, z, g.life[i] || 12); return false }
    if (bh & B.VENT) {
      // A vacuum pocket sucks on its own; a built vent needs to be switched on.
      if (matPhase[t] === Phase.Gas || g.chg[i] > 0) this.pf.add(x, y, z, -(g.life[i] || 12))
      return false
    }

    if (bh & B.CLOCK) {
      // Per-cell period, so two clocks in one scene can beat against each other.
      const period = Math.max(2, g.life[i] || matLife[t])
      if (this.tick % period === 0) this.sparkNeighbours(i, x, y, z)
      return false
    }

    if (bh & B.SENSOR) {
      const threshold = g.life[i]
      const fired = threshold > 0 ? g.temp[i] >= threshold : this.pf.at(x, y, z) > 6
      if (fired) this.sparkNeighbours(i, x, y, z)
      return false
    }

    if (bh & B.BATTERY) { this.sparkNeighbours(i, x, y, z); return false }

    if (bh & B.GATE) { this.gate(i, x, y, z, t); return false }

    if (bh & B.MAGNET) { this.magnet(x, y, z); return false }

    return false
  }

  /**
   * A gate reads charge off adjacent P-type and drives adjacent N-type. The
   * in/out convention is the whole design: without it a gate feeds its own
   * inputs and every circuit degenerates into noise within a few ticks.
   */
  private gate(i: number, x: number, y: number, z: number, t: number): void {
    const g = this.grid
    let inputs = 0, live = 0
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]
      if (!g.inBounds(nx, ny)) continue
      const j = g.idx(nx, ny, z)
      if ((matBehav[g.type[j]] & B.SEMI_P) === 0) continue
      inputs++
      // P-type holds its charge for several ticks (see `charge`), which is what
      // turns a one-tick spark into something a gate can read as a level.
      if (g.chg[j] !== 0) live++
    }
    if (inputs === 0) return

    const op = matGate[t]
    const out = op === Gate.And ? live >= 2 && live === inputs
      : op === Gate.Or ? live >= 1
      : op === Gate.Xor ? live === 1
      : op === Gate.Not ? live === 0
      : false
    if (!out || g.cool[i] !== 0) return

    let drove = false
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]
      if (!g.inBounds(nx, ny)) continue
      const j = g.idx(nx, ny, z)
      if ((matBehav[g.type[j]] & B.SEMI_N) === 0) continue
      if (g.chg[j] !== 0 || g.cool[j] !== 0) continue
      g.chg[j] = 1
      this.sparkList.push(j)
      g.wake(nx, ny, z)
      drove = true
    }
    if (drove) { g.cool[i] = 4; this.coolList.push(i) }
  }

  /** Drags loose ferrous grains one cell closer, within a short reach. */
  private magnet(x: number, y: number, z: number): void {
    const g = this.grid
    const reach = 3
    for (let dy = -reach; dy <= reach; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= g.h) continue
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        if (nx < 0 || nx >= g.w) continue
        const j = g.idx(nx, ny, z)
        const o = g.type[j]
        if (o !== IRND && o !== BRMT) continue
        const sx = dx === 0 ? 0 : dx > 0 ? -1 : 1
        const sy = dy === 0 ? 0 : dy > 0 ? -1 : 1
        this.tryMove(j, nx, ny, nx + sx, ny + sy, z, o)
      }
    }
  }

  /** Pull the eight neighbours towards a set point. Converges, never diverges. */
  private driveTemp(x: number, y: number, z: number, target: number): void {
    const g = this.grid
    let moved = false
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]
      if (!g.inBounds(nx, ny)) continue
      const j = g.idx(nx, ny, z)
      const t = g.temp[j]
      const dT = (target - t) * 0.12
      if (dT > -0.05 && dT < 0.05) continue
      g.temp[j] = Math.max(1, t + dT)
      g.wake(nx, ny, z)
      moved = true
    }
    g.temp[g.idx(x, y, z)] = target
    if (moved) g.wakeThermal(x, y, z)
  }

  private emit(x: number, y: number, z: number, mat: number, dir: number): void {
    const g = this.grid
    const nx = x + DX[dir], ny = y + DY[dir]
    if (!g.inBounds(nx, ny)) return
    const j = g.idx(nx, ny, z)
    if (g.type[j] !== EMPTY) return
    g.set(j, mat, nx, ny, z)
    g.cool[j] = dir
  }

  // --- movement --------------------------------------------------------------

  private canEnter(src: number, dst: number): boolean {
    if (dst === EMPTY) return true
    const pd = matPhase[dst]
    if (pd === Phase.Solid || pd === Phase.Energy) return false
    if (matBehav[dst] & B.WALL) return false
    return matDensity[src] > matDensity[dst] * 1.02
  }

  private tryMove(i: number, x: number, y: number, nx: number, ny: number, z: number, t: number): boolean {
    const g = this.grid
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) return false
    const j = g.idx(nx, ny, z)
    if (!this.canEnter(t, g.type[j])) return false
    this.swap(i, j, x, y, nx, ny, z)
    return true
  }

  private swap(i: number, j: number, x: number, y: number, nx: number, ny: number, z: number, nz = z): void {
    const g = this.grid
    const t0 = g.type[i], t1 = g.type[j]
    g.type[i] = t1; g.type[j] = t0
    const a = g.temp[i]; g.temp[i] = g.temp[j]; g.temp[j] = a
    const b = g.life[i]; g.life[i] = g.life[j]; g.life[j] = b
    const c = g.chg[i]; g.chg[i] = g.chg[j]; g.chg[j] = c
    const d = g.cool[i]; g.cool[i] = g.cool[j]; g.cool[j] = d
    const e = g.tint[i]; g.tint[i] = g.tint[j]; g.tint[j] = e
    const f = g.burning[i]; g.burning[i] = g.burning[j]; g.burning[j] = f
    g.stamp[j] = this.stampByte
    g.stamp[i] = this.stampByte
    g.wake(x, y, z); g.wake(nx, ny, nz)
    if (Math.abs(g.temp[j] - AMBIENT) > 2 || Math.abs(g.temp[i] - AMBIENT) > 2) {
      g.wakeThermal(x, y, z); g.wakeThermal(nx, ny, nz)
    }
  }

  /** Pressure pushes gases and light liquids around; returns true if it moved the cell. */
  private pressureShove(i: number, x: number, y: number, z: number, t: number): boolean {
    if (this.pf.quiet) return false
    const pi = this.pf.index(x, y, z)
    const vx = this.pf.vx[pi], vy = this.pf.vy[pi]
    const mag = Math.abs(vx) + Math.abs(vy)
    if (mag < 0.5) return false
    const sx = vx > 0.25 ? 1 : vx < -0.25 ? -1 : 0
    const sy = vy > 0.25 ? 1 : vy < -0.25 ? -1 : 0
    if (sx === 0 && sy === 0) return false
    if (this.rnd() > Math.min(0.9, mag * 0.25)) return false
    return this.tryMove(i, x, y, x + sx, y + sy, z, t)
  }

  private movePowder(i: number, x: number, y: number, z: number, t: number): void {
    if (this.tryMove(i, x, y, x, y + 1, z, t)) return
    const slide = matSlide[t]
    if (slide <= 0) return
    if (this.rnd() > slide) return
    const dir = this.rnd() < 0.5 ? -1 : 1
    if (this.tryMove(i, x, y, x + dir, y + 1, z, t)) return
    this.tryMove(i, x, y, x - dir, y + 1, z, t)
  }

  private moveLiquid(i: number, x: number, y: number, z: number, t: number): void {
    if (this.pressureShove(i, x, y, z, t)) return
    if (this.tryMove(i, x, y, x, y + 1, z, t)) return
    const dir = this.rnd() < 0.5 ? -1 : 1
    if (this.tryMove(i, x, y, x + dir, y + 1, z, t)) return
    if (this.tryMove(i, x, y, x - dir, y + 1, z, t)) return

    // Level out: walk sideways to the furthest cell still reachable this tick.
    const disp = matDisp[t]
    if (disp === 0) return
    const g = this.grid
    let best = 0
    for (let k = 1; k <= disp; k++) {
      const nx = x + dir * k
      if (nx < 0 || nx >= g.w) break
      if (!this.canEnter(t, g.type[g.idx(nx, y, z)])) break
      best = k
      // Prefer dropping down as soon as the floor gives way.
      const below = y + 1
      if (below < g.h && this.canEnter(t, g.type[g.idx(nx, below, z)])) break
    }
    if (best > 0) this.tryMove(i, x, y, x + dir * best, y, z, t)

    // Percolate through a pore to the layer behind or in front.
    if (disp > 0 && this.rnd() < 0.02) this.tryPercolate(i, x, y, z)
  }

  /** Liquids cross depth layers only where the neighbouring layer is open. */
  private tryPercolate(i: number, x: number, y: number, z: number): void {
    const g = this.grid
    const nz = this.rnd() < 0.5 ? z - 1 : z + 1
    if (nz < 0 || nz >= g.l) return
    const j = g.idx(x, y, nz)
    if (g.type[j] !== EMPTY) return
    // Needs a floor on the far side, so liquid does not teleport into open air.
    const below = y + 1 < g.h ? g.type[g.idx(x, y + 1, nz)] : 1
    if (below === EMPTY) return
    this.swap(i, j, x, y, x, y, z, nz)
  }

  private moveGas(i: number, x: number, y: number, z: number, t: number): void {
    if (this.pressureShove(i, x, y, z, t)) return
    const rise = matDensity[t] < AIR_DENSITY ? -1 : 1
    const disp = matDisp[t] || 2
    if (this.rnd() < 0.75 && this.tryMove(i, x, y, x, y + rise, z, t)) return
    const dir = this.rnd() < 0.5 ? -1 : 1
    if (this.tryMove(i, x, y, x + dir, y + rise, z, t)) return
    const k = 1 + this.rndInt(disp)
    this.tryMove(i, x, y, x + dir * k, y, z, t)
  }

  private moveEnergy(i: number, x: number, y: number, z: number, t: number, bh: number): void {
    if (bh & (B.PHOTON | B.NEUTRON)) { this.moveBallistic(i, x, y, z, bh); return }
    // Fire and plasma: rise, wander, and feed on oxygen.
    const g = this.grid
    if (t === FIRE) {
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]
        if (!g.inBounds(nx, ny)) continue
        const j = g.idx(nx, ny, z)
        if (g.type[j] === OXYG) {
          if (this.rnd() < 0.25) { g.set(j, EMPTY, nx, ny, z); g.life[i] = Math.min(255, g.life[i] + 30) }
          g.temp[i] += 60
        }
      }
    }
    if (this.rnd() < 0.7 && this.tryMove(i, x, y, x, y - 1, z, t)) return
    const dir = this.rnd() < 0.5 ? -1 : 1
    if (this.tryMove(i, x, y, x + dir, y - 1, z, t)) return
    this.tryMove(i, x, y, x + dir, y, z, t)
  }

  private moveBallistic(i: number, x: number, y: number, z: number, bh: number): void {
    const g = this.grid
    const speed = (bh & B.PHOTON) ? 3 : 2
    let dir = g.cool[i] & 7
    let cx2 = x, cy2 = y, ci = i
    for (let s = 0; s < speed; s++) {
      const nx = cx2 + DX[dir], ny = cy2 + DY[dir]
      if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) { g.set(ci, EMPTY, cx2, cy2, z); return }
      const j = g.idx(nx, ny, z)
      const o = g.type[j]
      if (o === EMPTY) {
        this.swap(ci, j, cx2, cy2, nx, ny, z)
        ci = j; cx2 = nx; cy2 = ny
        continue
      }
      if (bh & B.PHOTON) {
        if (o === GLAS) { this.swap(ci, j, cx2, cy2, nx, ny, z); ci = j; cx2 = nx; cy2 = ny; continue }
        if (o === FILT) {
          g.tint[ci] = g.tint[j]
          this.swap(ci, j, cx2, cy2, nx, ny, z)
          ci = j; cx2 = nx; cy2 = ny
          continue
        }
        g.temp[j] += 12
        g.wakeThermal(nx, ny, z)
        g.set(ci, EMPTY, cx2, cy2, z)
        return
      }
      // Neutrons mostly pass through, but lead and dense metal stop them.
      const stop = matDensity[o] > 9000 ? 0.6 : 0.06
      if (this.rnd() < stop) { g.set(ci, EMPTY, cx2, cy2, z); g.temp[j] += 30; return }
      dir = (dir + (this.rnd() < 0.5 ? 7 : 1)) & 7
      g.cool[ci] = dir
    }
    g.cool[ci] = dir
  }

  // --- heat ------------------------------------------------------------------
  // Jacobi diffusion over chunks that still hold a gradient. A region that has
  // reached ambient stops costing anything until something wakes it.

  private heatPass(): void {
    const g = this.grid
    const { w, h, l, cx, cy, chunksPerLayer, layerCells } = g
    const temp = g.temp, next = this.tempNext, type = g.type
    const thermal = g.thermal

    for (let z = 0; z < l; z++) {
      const chunkBase = z * chunksPerLayer
      const layerBase = z * layerCells
      for (let by = 0; by < cy; by++) {
        for (let bx = 0; bx < cx; bx++) {
          const c = chunkBase + by * cx + bx
          if (thermal[c] === 0) continue
          const x0 = bx << CH_SHIFT, x1 = Math.min(w, x0 + CH)
          const y0 = by << CH_SHIFT, y1 = Math.min(h, y0 + CH)
          let unsettled = false

          for (let y = y0; y < y1; y++) {
            const row = layerBase + y * w
            for (let x = x0; x < x1; x++) {
              const i = row + x
              const t = type[i]
              const k = t === EMPTY ? 0.03 : matTK[t]
              const ti = temp[i]
              if (k <= 0) { next[i] = ti; if (Math.abs(ti - AMBIENT) > 0.5) unsettled = true; continue }

              let flux = 0, wsum = 0
              if (x > 0) { const wgt = this.wt(k, type[i - 1]); flux += wgt * (temp[i - 1] - ti); wsum += wgt }
              if (x < w - 1) { const wgt = this.wt(k, type[i + 1]); flux += wgt * (temp[i + 1] - ti); wsum += wgt }
              if (y > 0) { const wgt = this.wt(k, type[i - w]); flux += wgt * (temp[i - w] - ti); wsum += wgt }
              if (y < h - 1) { const wgt = this.wt(k, type[i + w]); flux += wgt * (temp[i + w] - ti); wsum += wgt }
              if (z > 0) { const wgt = this.wt(k, type[i - layerCells]) * 0.33; flux += wgt * (temp[i - layerCells] - ti); wsum += wgt }
              if (z < l - 1) { const wgt = this.wt(k, type[i + layerCells]) * 0.33; flux += wgt * (temp[i + layerCells] - ti); wsum += wgt }

              // Explicit diffusion is only stable while rate * sum(weights) <= 1.
              // Six neighbours at conductivity 1 against a heat capacity of 0.13
              // puts that product at 7.4, and the field diverges to 1e13 K within
              // a few hundred ticks. Clamp the step instead of trusting the data.
              let f = HEAT_RATE / matHcap[t]
              if (f * wsum > 0.9) f = 0.9 / wsum

              let nt = ti + flux * f
              if (t === EMPTY) nt += (AMBIENT - nt) * 0.03
              if (nt < 1) nt = 1
              else if (nt > T_CEILING) nt = T_CEILING
              next[i] = nt
              if (Math.abs(nt - AMBIENT) > 0.5) unsettled = true
            }
          }

          for (let y = y0; y < y1; y++) {
            const row = layerBase + y * w
            for (let x = x0; x < x1; x++) temp[row + x] = next[row + x]
          }
          if (!unsettled) thermal[c] = 0
        }
      }
    }
  }

  /** Conductance between two touching cells is the weaker of the two. */
  private wt(k: number, other: number): number {
    const ko = other === EMPTY ? 0.03 : matTK[other]
    if (ko <= 0) return 0
    return k < ko ? k : ko
  }

  // --- electricity -----------------------------------------------------------
  // Sparks live in a sparse list, so an idle circuit costs nothing per tick.

  private electricPass(): void {
    const g = this.grid
    const live = this.sparkList
    if (live.length === 0 && this.coolList.length === 0) return

    const next: number[] = []
    for (let n = 0; n < live.length; n++) {
      const i = live[n]
      const t = g.type[i]
      if (matCond[t] === 0 && !(matBehav[t] & (B.SEMI_N | B.SEMI_P | B.LAMP | B.VIA))) { g.chg[i] = 0; continue }
      const c = g.chg[i]
      if (c === 0) continue
      // Resistive heating: a perfect conductor barely warms, a resistor cooks.
      g.temp[i] += 0.5 + 45 * (1 - matCond[t])
      const z = (i / g.layerCells) | 0
      const rem = i - z * g.layerCells
      const y = (rem / g.w) | 0
      const x = rem - y * g.w
      g.wakeThermal(x, y, z)

      if (c > 1) { g.chg[i] = c - 1; next.push(i); continue }
      g.chg[i] = 0
      // P-type re-arms almost immediately so a repeating source can hold a
      // level on it; everything else stays refractory long enough that a spark
      // does not run straight back the way it came.
      g.cool[i] = (matBehav[t] & B.SEMI_P) ? 1 : 5
      this.coolList.push(i)
      this.spread(i, x, y, z, next)
    }
    this.sparkList = next

    const stillCooling: number[] = []
    for (let n = 0; n < this.coolList.length; n++) {
      const i = this.coolList[n]
      const c = g.cool[i]
      if (c > 1) { g.cool[i] = c - 1; stillCooling.push(i) }
      else g.cool[i] = 0
    }
    this.coolList = stillCooling
  }

  private spread(i: number, x: number, y: number, z: number, out: number[]): void {
    const g = this.grid
    const bhSrc = matBehav[g.type[i]]
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]
      if (!g.inBounds(nx, ny)) continue
      this.charge(g.idx(nx, ny, z), bhSrc, out, nx, ny, z)
    }
    // Depth is otherwise an insulator for charge; a via is the one crossing.
    if (bhSrc & B.VIA) {
      if (z > 0) this.charge(i - g.layerCells, bhSrc, out, x, y, z - 1)
      if (z < g.l - 1) this.charge(i + g.layerCells, bhSrc, out, x, y, z + 1)
    }
  }

  private charge(j: number, bhSrc: number, out: number[], nx: number, ny: number, nz: number): void {
    const g = this.grid
    const o = g.type[j]
    const bh = matBehav[o]
    // A P-type input that is still being driven stays high: top the hold back
    // up instead of refusing. Without this the level always drains to zero for
    // a few ticks before it can be re-armed, and a NOT gate blips every cycle.
    if ((bh & B.SEMI_P) && g.chg[j] !== 0 && g.cool[j] === 0) { g.chg[j] = chargeLevel(o); return }
    if (g.chg[j] !== 0 || g.cool[j] !== 0) return
    if (bh & B.SWITCH) { if (g.life[j] === 0) return }
    else if (matCond[o] <= 0) return
    // Diode: charge only enters N-type from P-type, and never runs N -> P.
    if ((bh & B.SEMI_N) && !(bhSrc & B.SEMI_P)) return
    if ((bhSrc & B.SEMI_N) && (bh & B.SEMI_P)) return
    if (this.rnd() > matCond[o] + 0.15) return
    g.chg[j] = chargeLevel(o)
    out.push(j)
    g.wake(nx, ny, nz)
  }

  private sparkNeighbours(i: number, x: number, y: number, z: number): void {
    this.spread(i, x, y, z, this.sparkList)
  }
}
