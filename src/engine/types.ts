// Core simulation types. Everything a material can do is declared here as data;
// the tick loop reads flat typed arrays compiled from these records.

export const Phase = {
  /** Never moves on its own. Walls, metals, wood, ice. */
  Solid: 0,
  /** Falls, piles at an angle of repose. Sand, salt, ash. */
  Powder: 1,
  /** Falls and spreads sideways to level out. Water, oil, lava. */
  Liquid: 2,
  /** Rises (or falls, if dense) and diffuses. Steam, smoke, hydrogen. */
  Gas: 3,
  /** Moves by its own rule, ignores gravity. Fire, photons, sparks. */
  Energy: 4,
} as const
export type Phase = (typeof Phase)[keyof typeof Phase]

/** Behaviour bits. A material may carry several. */
export const B = {
  /** Indestructible and immovable; also blocks heat and pressure. */
  WALL: 1 << 0,
  /** Copies whatever material first touches it, then emits that forever. */
  CLONE: 1 << 1,
  /** Deletes any neighbour that touches it. */
  VOID: 1 << 2,
  /** The moving electrical charge itself. */
  SPARK: 1 << 3,
  /** Travels in a straight line at high speed, reflects off FILT/glass. */
  PHOTON: 1 << 4,
  /** Travels ballistically, splits fissile material. */
  NEUTRON: 1 << 5,
  /** Pumps heat into its neighbours. */
  HEATER: 1 << 6,
  /** Pulls heat out of its neighbours. */
  COOLER: 1 << 7,
  /** Grows into empty space when water is in reach. */
  GROW: 1 << 8,
  /** Converts touchable neighbours into itself. */
  INFECT: 1 << 9,
  /** Soaks up liquids and holds them. */
  ABSORB: 1 << 10,
  /** N-type semiconductor: passes charge only from P-type. */
  SEMI_N: 1 << 11,
  /** P-type semiconductor: passes charge only to N-type. */
  SEMI_P: 1 << 12,
  /** Emits charge every tick into adjacent conductors. */
  BATTERY: 1 << 13,
  /** Conducts only while toggled on. */
  SWITCH: 1 << 14,
  /** Carries charge across depth layers — the only thing that does. */
  VIA: 1 << 15,
  /** Decays and emits neutrons. */
  RADIO: 1 << 16,
  /** Annihilates on contact with any matter, violently. */
  ANTIM: 1 << 17,
  /** Raises local pressure. */
  PUMP: 1 << 18,
  /** Lowers local pressure. */
  VENT: 1 << 19,
  /** Powder that will not slide; keeps the shape you drew. */
  STICKY: 1 << 20,
  /** Emits charge on a fixed period. */
  CLOCK: 1 << 21,
  /** Glows while charged. */
  LAMP: 1 << 22,
  /** Emits charge when its trigger condition is met. */
  SENSOR: 1 << 23,
  /** Detonates: pressure impulse plus fire. */
  EXPLODE: 1 << 24,
  /** Dissolves other materials on contact, weighted by their hardness. */
  CORRODE: 1 << 25,
  /** Logic gate: reads charge off adjacent P-type, drives adjacent N-type. */
  GATE: 1 << 26,
  /** Pulls loose ferrous material towards itself. */
  MAGNET: 1 << 27,
  /** Holds an incoming charge for `life` ticks before passing it on. */
  HOLD: 1 << 28,
} as const

/** Which function a `B.GATE` material computes. */
export const Gate = { None: 0, And: 1, Or: 2, Xor: 3, Not: 4 } as const
export type Gate = (typeof Gate)[keyof typeof Gate]

export type Category =
  | 'powder' | 'liquid' | 'gas' | 'solid' | 'metal'
  | 'electronic' | 'explosive' | 'energy' | 'nuclear' | 'life' | 'tool'

export interface Reaction {
  /** Material id this one reacts with. */
  with: string
  /** [what self becomes, what the other becomes]. null = unchanged, '' = removed. */
  into: [string | null, string | null]
  /** Probability per contact per tick, 0..1. Default 1. */
  p?: number
  /** Only react at or above this temperature (K). */
  minT?: number
  /** Only react at or below this temperature (K). */
  maxT?: number
  /** Kelvin added to both cells when it fires. Negative absorbs heat. */
  heat?: number
}

export interface MatDef {
  /** 3-4 character code, unique. Used in save files, so never renamed. */
  id: string
  /** Display name. */
  name: string
  cat: Category
  /** Base colour 0xRRGGBB. */
  color: number
  /** Per-cell random colour jitter, 0-64. Gives piles texture. */
  cvar?: number
  phase: Phase
  /** Relative density. Decides who sinks through whom. */
  density: number
  /** Liquid/gas sideways spread per tick, in cells. */
  disp?: number
  /** Powder slide chance 0..1. 1 = flows like water, 0 = stacks vertically. */
  slide?: number
  /** Thermal conductivity 0..1. */
  tK?: number
  /** Heat capacity multiplier. Higher = harder to heat. */
  hcap?: number
  /** Spawn temperature in K. Default 295. */
  t0?: number
  /** Below this temperature the cell becomes `loInto`. */
  lo?: number
  loInto?: string
  /** Above this temperature the cell becomes `hiInto`. */
  hi?: number
  hiInto?: string
  /** Flammability 0..1. 0 = will not burn. */
  burn?: number
  /** Ignition temperature (K). */
  burnT?: number
  /** What is left behind after burning. '' = nothing. */
  burnInto?: string
  /** Kelvin released per burning tick. */
  burnHeat?: number
  /** Flame temperature ceiling (K). Burning heats towards this and stops.
   *  Defaults to `burnT + burnHeat * 2`, capped at 4000. */
  flameT?: number
  /** Electrical conductivity 0..1. */
  cond?: number
  /** Resistance to acid and erosion, 0..1. 1 = immune. */
  hard?: number
  /** Initial life counter; meaning depends on behaviour. */
  life?: number
  /** Counts `life` down every tick and becomes `dies` at zero. */
  decay?: boolean
  /** What a decaying material leaves behind. '' = nothing. */
  dies?: string
  /** Behaviour bits (see `B`). */
  behav?: number
  /** For `B.GATE` materials, the function it computes. */
  gate?: Gate
  /** Emissive strength 0..1 — bloom and light contribution. */
  glow?: number
  /** One line for the codex. */
  desc?: string
  reacts?: Reaction[]
}
