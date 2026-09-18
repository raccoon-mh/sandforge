import { B, Phase, type MatDef } from './types.ts'
import { POWDERS } from './data/powders.ts'
import { LIQUIDS } from './data/liquids.ts'
import { GASES } from './data/gases.ts'
import { SOLIDS } from './data/solids.ts'
import { ELECTRONICS } from './data/electronics.ts'
import { ENERGY } from './data/energy.ts'
import { LIFE } from './data/life.ts'
import { METALS } from './data/metals.ts'
import { CHEMISTRY } from './data/chemistry.ts'
import { LOGIC } from './data/logic.ts'
import { EXTRAS } from './data/extras.ts'
import { EXTRA_REACTIONS } from './data/reactions.ts'

/** Index 0 is empty space (air). Never drawn, never stored in a save. */
const EMPTY_DEF: MatDef = {
  id: 'NONE', name: '지우개', cat: 'tool', color: 0x000000, phase: Phase.Gas,
  density: 1.2, tK: 0.02, hcap: 1, hard: 0, desc: '빈 공간. 칠하면 지워진다.',
}

export const DEFS: MatDef[] = [
  EMPTY_DEF,
  ...POWDERS, ...LIQUIDS, ...GASES, ...SOLIDS, ...METALS, ...ELECTRONICS, ...LOGIC,
  ...ENERGY, ...LIFE, ...CHEMISTRY, ...EXTRAS,
]

// Merge the standalone reaction table into the records before anything reads
// them, so the compiler below sees one shape and only one.
for (const [id, rules] of Object.entries(EXTRA_REACTIONS)) {
  const def = DEFS.find(d => d.id === id)
  if (!def) throw new Error(`반응표가 없는 물질 '${id}' 를 가리킨다`)
  def.reacts = [...(def.reacts ?? []), ...rules]
}

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
export const matFlameT = new Float32Array(N)
export const matCond = new Float32Array(N)
export const matHard = new Float32Array(N)
export const matLife = new Uint16Array(N)
export const matBehav = new Int32Array(N)
export const matGlow = new Float32Array(N)
export const matDecay = new Uint8Array(N)
export const matDies = new Int32Array(N)
export const matGate = new Uint8Array(N)

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
  matFlameT[i] = d.flameT ?? Math.min(4000, (d.burnT ?? 700) + (d.burnHeat ?? 0) * 2)
  matCond[i] = d.cond ?? 0
  matHard[i] = d.hard ?? 0.3
  matLife[i] = d.life ?? 0
  matBehav[i] = d.behav ?? 0
  matGlow[i] = d.glow ?? 0
  matDecay[i] = d.decay ? 1 : 0
  matDies[i] = d.dies === undefined ? EMPTY : ref(d.id, d.dies)
  matGate[i] = d.gate ?? 0
}

// --- reaction table ----------------------------------------------------------
// Each material's rules sit contiguously and are scanned linearly against the
// neighbour's id. The obvious alternative — an N x N jump table — is 152KB of
// random access on the hottest path in the tick, and water alone would miss
// cache on every probe.

export const ruleStart = new Int32Array(N)
export const ruleCount = new Uint8Array(N)

const rw: number[] = [], rs: number[] = [], ro: number[] = [], rp: number[] = []
const rmin: number[] = [], rmax: number[] = [], rh: number[] = []

for (let a = 0; a < N; a++) {
  ruleStart[a] = rw.length
  let count = 0
  for (const r of DEFS[a].reacts ?? []) {
    const b = ID_TO_NUM.get(r.with)
    if (b === undefined) throw new Error(`${DEFS[a].id} 의 반응이 없는 물질 '${r.with}' 를 가리킨다`)
    const p = r.p ?? 1
    if (p <= 0) continue
    rw.push(b)
    rs.push(ref(DEFS[a].id, r.into[0]))
    ro.push(ref(DEFS[a].id, r.into[1]))
    rp.push(p)
    rmin.push(r.minT ?? -1)
    rmax.push(r.maxT ?? Infinity)
    rh.push(r.heat ?? 0)
    count++
  }
  ruleCount[a] = Math.min(255, count)
}

export const ruleWith = new Int32Array(rw)
export const ruleSelf = new Int32Array(rs)
export const ruleOther = new Int32Array(ro)
export const ruleP = new Float32Array(rp)
export const ruleMinT = new Float32Array(rmin)
export const ruleMaxT = new Float32Array(rmax)
export const ruleHeat = new Float32Array(rh)

/** Skips the scan entirely for the materials that have no rules at all. */
export const matReactive = new Uint8Array(N)
for (let i = 0; i < N; i++) matReactive[i] = ruleCount[i] > 0 ? 1 : 0

/**
 * Materials that do something every tick on their own — they must keep their
 * chunk awake even when nothing around them changed. Everything else is allowed
 * to fall asleep the moment it stops moving, which is what makes a settled pile
 * cost nothing.
 */
const SELF_DRIVEN =
  B.CLONE | B.VOID | B.HEATER | B.COOLER | B.RADIO | B.GROW | B.INFECT |
  B.ABSORB | B.CORRODE | B.PUMP | B.VENT | B.CLOCK | B.SENSOR | B.BATTERY |
  B.ANTIM | B.PHOTON | B.NEUTRON | B.SPARK | B.GATE | B.MAGNET

export const matSelfActive = new Uint8Array(N)
for (let i = 0; i < N; i++) {
  matSelfActive[i] =
    matDecay[i] || matPhase[i] === Phase.Energy || (matBehav[i] & SELF_DRIVEN) !== 0 ? 1 : 0
}

/**
 * Manufactured solids are drawn flat with a bevelled edge; natural ones keep
 * their grain. Without this a copper bus and a heap of sand look the same, and
 * a circuit reads as a smear of powder.
 */
export const matFlat = new Uint8Array(N)
for (let i = 0; i < N; i++) {
  matFlat[i] = matPhase[i] === Phase.Solid && matCvar[i] < 10 ? 1 : 0
}

/** Fire-likes ignite what they touch without a table entry. */
export const matIgniter = new Uint8Array(N)
for (const id of ['FIRE', 'PLSM', 'LIGH']) matIgniter[ID_TO_NUM.get(id)!] = 1

/** Materials that stay put unless something moves them. */
export const matStatic = new Uint8Array(N)
for (let i = 0; i < N; i++) matStatic[i] = matPhase[i] === Phase.Solid ? 1 : 0

export const MATERIAL_COUNT = N - 1
