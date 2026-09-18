import { Phase, B, Gate, type MatDef } from '../types.ts'

// Gates read their inputs off adjacent P-type and drive adjacent N-type. The
// convention is what makes them unambiguous: without a declared in and out
// side, a gate feeds its own inputs and the circuit oscillates into noise.
export const LOGIC: MatDef[] = [
  { id: 'ANDG', name: 'AND 게이트', cat: 'electronic', color: 0x3f7a5a, cvar: 6, phase: Phase.Solid,
    density: 2400, tK: 0.4, hcap: 0.8, behav: B.GATE, gate: Gate.And, glow: 0.12, hard: 0.4,
    desc: '한 칸짜리 부품. 붙어 있는 P형 입력이 모두 켜져야 N형 출력을 낸다.' },
  { id: 'ORGT', name: 'OR 게이트', cat: 'electronic', color: 0x3f6a8a, cvar: 6, phase: Phase.Solid,
    density: 2400, tK: 0.4, hcap: 0.8, behav: B.GATE, gate: Gate.Or, glow: 0.12, hard: 0.4,
    desc: '한 칸짜리 부품. P형 입력 하나만 켜져도 N형 출력을 낸다.' },
  { id: 'XORG', name: 'XOR 게이트', cat: 'electronic', color: 0x7a5a8a, cvar: 6, phase: Phase.Solid,
    density: 2400, tK: 0.4, hcap: 0.8, behav: B.GATE, gate: Gate.Xor, glow: 0.12, hard: 0.4,
    desc: '한 칸짜리 부품. P형 입력이 정확히 하나일 때만 출력한다. 반가산기의 합 자리.' },
  { id: 'NOTG', name: 'NOT 게이트', cat: 'electronic', color: 0x8a5a4a, cvar: 6, phase: Phase.Solid,
    density: 2400, tK: 0.4, hcap: 0.8, behav: B.GATE, gate: Gate.Not, glow: 0.12, hard: 0.4,
    desc: '한 칸짜리 부품. P형 입력이 모두 꺼져 있을 때 출력한다. P형을 안 붙이면 아무 일도 하지 않는다.' },
  { id: 'DLAY', name: '지연기', cat: 'electronic', color: 0x5a5a7a, cvar: 6, phase: Phase.Solid,
    density: 2400, tK: 0.35, hcap: 0.9, cond: 1, behav: B.HOLD, life: 20, glow: 0.1, hard: 0.35,
    desc: '받은 신호를 life 틱만큼 붙잡았다 내보낸다. 기본 20틱.' },
]
