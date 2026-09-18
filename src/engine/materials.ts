import { B, Phase, type MatDef } from './types.ts'
import { POWDERS } from './data/powders.ts'
import { LIQUIDS } from './data/liquids.ts'
import { GASES } from './data/gases.ts'
import { SOLIDS } from './data/solids.ts'
import { ELECTRONICS } from './data/electronics.ts'
import { ENERGY } from './data/energy.ts'
import { LIFE } from './data/life.ts'

/** Index 0 is empty space (air). Never drawn, never stored in a save. */
const EMPTY_DEF: MatDef = {
  id: 'NONE', name: '지우개', cat: 'tool', color: 0x000000, phase: Phase.Gas,
  density: 1.2, tK: 0.02, hcap: 1, hard: 0, desc: '빈 공간. 칠하면 지워진다.',
}

export const DEFS: MatDef[] = [
  EMPTY_DEF,
  ...POWDERS, ...LIQUIDS, ...GASES, ...SOLIDS, ...ELECTRONICS, ...ENERGY, ...LIFE,
]

export const N = DEFS.length
export const EMPTY = 0

/** id string -> numeric index. Save files store the string, memory stores the index. */
export const ID_TO_NUM = new Map<string, number>()
for (let i = 0; i < N; i++) ID_TO_NUM.set(DEFS[i].id, i)
if (ID_TO_NUM.size !== N) {
  const seen = new Set<string>()
  const dup = DEFS.map(d => d.id).filter(id => (seen.has(id) ? true : (seen.add(id), false)))
  throw new Error(`중복된 물질 id: ${[...new Set(dup)].join(', ')}`)
}

/** `null` means "leave this cell alone", `''` means "erase it". */
function ref(from: string, what: string | null | undefined): number {
  if (what === null || what === undefined) return -1
  if (what === '') return EMPTY
  const n = ID_TO_NUM.get(what)
  if (n === undefined) throw new Error(`${from} 이(가) 없는 물질 '${what}' 를 가리킨다`)
  return n
}

// --- flat tables -------------------------------------------------------------
// One entry per material. The tick loop only ever touches these, never DEFS.

export const matColor = new Int32Array(N)
export const matCvar = new Uint8Array(N)
export const matPhase = new Uint8Array(N)
export const matDensity = new Float32Array(N)
export const matDisp = new Uint8Array(N)
export const matSlide = new Float32Array(N)
export const matTK = new Float32Array(N)
export const matHcap = new Float32Array(N)
export const matT0 = new Float32Array(N)
export const matLo = new Float32Array(N)
export const matLoInto = new Int32Array(N)
export const matHi = new Float32Array(N)
export const matHiInto = new Int32Array(N)
export const matBurn = new Float32Array(N)
export const matBurnT = new Float32Array(N)
export const matBurnInto = new Int32Array(N)
export const matBurnHeat = new Float32Array(N)
export const matCond = new Float32Array(N)
export const matHard = new Float32Array(N)
export const matLife = new Uint16Array(N)
export const matBehav = new Int32Array(N)
export const matGlow = new Float32Array(N)
export const matDecay = new Uint8Array(N)
export const matDies = new Int32Array(N)
/** True when the material has at least one pair reaction — lets the tick skip the table lookup. */
export const matReactive = new Uint8Array(N)

for (let i = 0; i < N; i++) {
  const d = DEFS[i]
  matColor[i] = d.color
  matCvar[i] = d.cvar ?? 0
  matPhase[i] = d.phase
  matDensity[i] = d.density
  matDisp[i] = d.disp ?? 0
  matSlide[i] = d.slide ?? 0
  matTK[i] = d.tK ?? 0.1
  matHcap[i] = Math.max(0.01, d.hcap ?? 1)
  matT0[i] = d.t0 ?? 295
  matLo[i] = d.lo ?? -1
  matLoInto[i] = ref(d.id, d.loInto)
  matHi[i] = d.hi ?? Infinity
  matHiInto[i] = ref(d.id, d.hiInto)
  matBurn[i] = d.burn ?? 0
  matBurnT[i] = d.burnT ?? Infinity
  matBurnInto[i] = d.burnInto === undefined ? EMPTY : ref(d.id, d.burnInto)
  matBurnHeat[i] = d.burnHeat ?? 0
  matCond[i] = d.cond ?? 0
  matHard[i] = d.hard ?? 0.3
  matLife[i] = d.life ?? 0
  matBehav[i] = d.behav ?? 0
  matGlow[i] = d.glow ?? 0
  matDecay[i] = d.decay ? 1 : 0
  matDies[i] = d.dies === undefined ? EMPTY : ref(d.id, d.dies)
}

// --- reaction table ----------------------------------------------------------
// reactAt[a * N + b] is the index of the first rule for the ordered pair (a, b),
// or -1. Rules for one pair are contiguous. A direct array index beats a hash.

export const reactAt = new Int32Array(N * N).fill(-1)
export const reactLen = new Uint8Array(N * N)

const rs: number[] = [], ro: number[] = [], rp: number[] = []
const rmin: number[] = [], rmax: number[] = [], rh: number[] = []

{
  // Group by pair first so each pair's rules land contiguously.
  const byPair = new Map<number, { self: number; other: number; p: number; minT: number; maxT: number; heat: number }[]>()
  for (let a = 0; a < N; a++) {
    for (const r of DEFS[a].reacts ?? []) {
      const b = ID_TO_NUM.get(r.with)
      if (b === undefined) throw new Error(`${DEFS[a].id} 의 반응이 없는 물질 '${r.with}' 를 가리킨다`)
      const key = a * N + b
      const rule = {
        self: ref(DEFS[a].id, r.into[0]),
        other: ref(DEFS[a].id, r.into[1]),
        p: r.p ?? 1,
        minT: r.minT ?? -1,
        maxT: r.maxT ?? Infinity,
        heat: r.heat ?? 0,
      }
      if (rule.p <= 0) continue
      const list = byPair.get(key)
      if (list) list.push(rule); else byPair.set(key, [rule])
    }
  }
  for (const [key, list] of byPair) {
    reactAt[key] = rs.length
    reactLen[key] = Math.min(255, list.length)
    for (const r of list) {
      rs.push(r.self); ro.push(r.other); rp.push(r.p)
      rmin.push(r.minT); rmax.push(r.maxT); rh.push(r.heat)
    }
    matReactive[(key / N) | 0] = 1
  }
}

export const reactSelf = new Int32Array(rs)
export const reactOther = new Int32Array(ro)
export const reactP = new Float32Array(rp)
export const reactMinT = new Float32Array(rmin)
export const reactMaxT = new Float32Array(rmax)
export const reactHeat = new Float32Array(rh)

/**
 * Materials that do something every tick on their own — they must keep their
 * chunk awake even when nothing around them changed. Everything else is allowed
 * to fall asleep the moment it stops moving, which is what makes a settled pile
 * cost nothing.
 */
const SELF_DRIVEN =
  B.CLONE | B.VOID | B.HEATER | B.COOLER | B.RADIO | B.GROW | B.INFECT |
  B.ABSORB | B.CORRODE | B.PUMP | B.VENT | B.CLOCK | B.SENSOR | B.BATTERY |
  B.ANTIM | B.PHOTON | B.NEUTRON | B.SPARK

export const matSelfActive = new Uint8Array(N)
for (let i = 0; i < N; i++) {
  matSelfActive[i] =
    matDecay[i] || matPhase[i] === Phase.Energy || (matBehav[i] & SELF_DRIVEN) !== 0 ? 1 : 0
}

/** Fire-likes ignite what they touch without a table entry. */
export const matIgniter = new Uint8Array(N)
for (const id of ['FIRE', 'PLSM', 'LIGH']) matIgniter[ID_TO_NUM.get(id)!] = 1

/** Materials that stay put unless something moves them. */
export const matStatic = new Uint8Array(N)
for (let i = 0; i < N; i++) matStatic[i] = matPhase[i] === Phase.Solid ? 1 : 0

export const MATERIAL_COUNT = N - 1
