import type { Sim } from '../engine/sim.ts'
import { ID_TO_NUM } from '../engine/materials.ts'
import type { ColourMode } from '../render/renderer.ts'

const M = (id: string): number => {
  const n = ID_TO_NUM.get(id)
  if (n === undefined) throw new Error(`예제가 없는 물질 '${id}' 를 쓴다`)
  return n
}

/** Thin drawing surface over the grid. Scenes read like blueprints, not loops. */
class Sheet {
  private readonly sim: Sim
  constructor(sim: Sim) { this.sim = sim }
  get w(): number { return this.sim.grid.w }
  get h(): number { return this.sim.grid.h }
  get l(): number { return this.sim.grid.l }

  put(x: number, y: number, z: number, mat: string, temp?: number): void {
    const g = this.sim.grid
    if (x < 0 || y < 0 || x >= g.w || y >= g.h || z < 0 || z >= g.l) return
    g.set(g.idx(x, y, z), M(mat), x, y, z, temp)
  }

  rect(x0: number, y0: number, x1: number, y1: number, z: number, mat: string, temp?: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.put(x, y, z, mat, temp)
  }

  frame(x0: number, y0: number, x1: number, y1: number, z: number, mat: string, thick = 1): void {
    for (let t = 0; t < thick; t++) {
      for (let x = x0; x <= x1; x++) { this.put(x, y0 + t, z, mat); this.put(x, y1 - t, z, mat) }
      for (let y = y0; y <= y1; y++) { this.put(x0 + t, y, z, mat); this.put(x1 - t, y, z, mat) }
    }
  }

  hline(x0: number, x1: number, y: number, z: number, mat: string): void {
    for (let x = x0; x <= x1; x++) this.put(x, y, z, mat)
  }

  vline(x: number, y0: number, y1: number, z: number, mat: string): void {
    for (let y = y0; y <= y1; y++) this.put(x, y, z, mat)
  }

  blob(cx: number, cy: number, z: number, mat: string, r: number, temp?: number): void {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) this.put(cx + dx, cy + dy, z, mat, temp)
    }
  }

  /** A loose cloud, for dust and gas that should not look poured. */
  scatter(x0: number, y0: number, x1: number, y1: number, z: number, mat: string, density: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (Math.random() < density) this.put(x, y, z, mat)
    }
  }

  /** Place a cell and set its counter — a heater's set point, a clock's period. */
  tune(x: number, y: number, z: number, mat: string, life: number): void {
    const g = this.sim.grid
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return
    const i = g.idx(x, y, z)
    g.set(i, M(mat), x, y, z)
    g.life[i] = life
  }

  tuneRect(x0: number, y0: number, x1: number, y1: number, z: number, mat: string, life: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.tune(x, y, z, mat, life)
  }

  /** Charge a conductor directly — how a scene starts a circuit running. */
  spark(x: number, y: number, z: number): void {
    this.sim.paint(x, y, z, M('SPRK'), 1)
  }
}

export interface Scene {
  id: string
  name: string
  hint: string
  /** Which depth layer and colour mode the scene is meant to be watched in. */
  layer?: number
  mode?: ColourMode
  build(s: Sheet): void
}

/** A floor and two walls, which nearly every scene wants. */
function room(s: Sheet, top = 20): void {
  s.rect(0, s.h - 6, s.w - 1, s.h - 1, 0, 'WALL')
  s.rect(0, top, 5, s.h - 1, 0, 'WALL')
  s.rect(s.w - 6, top, s.w - 1, s.h - 1, 0, 'WALL')
}

export const SCENES: Scene[] = [
  {
    id: 'heat-exchanger',
    name: '열교환기',
    hint: '구리관을 지나는 물이 발열체의 열을 실어 나릅니다. 열화상으로 보면 관을 따라 열이 흐르는 것이 보이고, 단열재 바깥은 차갑게 남습니다.',
    mode: 'thermal',
    build(s) {
      room(s)
      const y = 150
      s.rect(60, y - 22, 400, y + 26, 0, 'INSL')
      s.rect(66, y - 16, 394, y + 20, 0, 'NONE')
      // copper serpentine
      for (let k = 0; k < 3; k++) {
        const yy = y - 10 + k * 14
        s.hline(72, 388, yy, 0, 'COPR')
        s.hline(72, 388, yy + 1, 0, 'COPR')
      }
      s.vline(384, y - 10, y + 5, 0, 'COPR')
      s.vline(76, y + 4, y + 19, 0, 'COPR')
      for (let k = 0; k < 3; k++) s.hline(74, 386, y - 9 + k * 14, 0, 'WATR')
      // The element has to sit inside the cavity and touch the bottom pipe —
      // insulation conducts nothing at all, so a heater buried in it does nothing.
      s.tuneRect(150, y + 19, 300, y + 20, 0, 'HEAT', 700)
      s.rect(70, y - 30, 390, y - 24, 0, 'CRMC')
    },
  },
  {
    id: 'diode',
    name: '다이오드 — 방향이 있는 전기',
    hint: '위와 아래는 부품 순서만 다릅니다. P형에서 N형으로는 전기가 지나가고, 반대로는 막힙니다. 위쪽 램프만 켜집니다.',
    build(s) {
      room(s)
      const run = (y: number, a: string, b: string) => {
        s.put(40, y, 0, 'BATT')
        s.hline(41, 120, y, 0, 'WIRE')
        s.put(121, y, 0, a)
        s.put(122, y, 0, b)
        s.hline(123, 200, y, 0, 'WIRE')
        s.rect(201, y - 1, 205, y + 1, 0, 'LAMP')
      }
      run(110, 'PSCN', 'NSCN')   // forward
      run(180, 'NSCN', 'PSCN')   // blocked
      s.rect(250, 96, 420, 126, 0, 'INSL')
      s.rect(250, 166, 420, 196, 0, 'INSL')
    },
  },
  {
    id: 'logic',
    name: '논리 게이트',
    hint: '주기가 다른 클럭 둘이 P형 입력을 때립니다. 게이트는 한 칸짜리 부품이고, P형에서 읽어 N형으로 내보냅니다 — 그 방향 약속이 없으면 게이트가 자기 입력을 먹고 회로가 잡음이 됩니다.',
    build(s) {
      room(s)
      // Two inputs converge on a single gate cell; a gate has to see both its
      // P-type inputs and its N-type output among its own eight neighbours.
      const row = (y: number, kind: string, twoInputs: boolean) => {
        const feed = (sy: number, ty: number, period: number) => {
          s.tune(50, sy, 0, 'CLCK', period)
          s.hline(51, 88, sy, 0, 'WIRE')
          s.vline(88, Math.min(sy, ty), Math.max(sy, ty), 0, 'WIRE')
          s.hline(89, 95, ty, 0, 'WIRE')
          s.put(96, ty, 0, 'PSCN')
        }
        feed(y - 14, y - 1, 14)
        if (twoInputs) feed(y + 14, y + 1, 22)
        s.put(97, y, 0, kind)
        s.put(98, y, 0, 'NSCN')
        s.hline(99, 150, y, 0, 'WIRE')
        s.rect(151, y - 2, 157, y + 2, 0, 'LAMP')
      }
      row(70, 'ANDG', true)
      row(130, 'ORGT', true)
      row(190, 'XORG', true)
      // NOT takes a single input and lights whenever that input is low
      const y = 240
      s.tune(50, y - 14, 0, 'CLCK', 30)
      s.hline(51, 88, y - 14, 0, 'WIRE')
      s.vline(88, y - 14, y - 1, 0, 'WIRE')
      s.hline(89, 95, y - 1, 0, 'WIRE')
      s.put(96, y - 1, 0, 'PSCN')
      s.put(97, y, 0, 'NOTG')
      s.put(98, y, 0, 'NSCN')
      s.hline(99, 150, y, 0, 'WIRE')
      s.rect(151, y - 2, 157, y + 2, 0, 'LAMP')
      // labels in metal so the rows are told apart at a glance
      for (const [ly, n] of [[70, 2], [130, 3], [190, 4], [240, 1]] as [number, number][]) {
        for (let k = 0; k < n; k++) s.rect(250 + k * 10, ly - 3, 256 + k * 10, ly + 3, 0, 'GOLD')
      }
    },
  },
  {
    id: 'multilayer',
    name: '다층 회로 — 비아',
    hint: '1층에서 출발한 전기가 비아를 타고 4층으로 올라가 거기서 램프를 켭니다. Q · E 로 층을 오가며 보세요. 비아 말고는 어떤 것도 층을 넘지 못합니다.',
    layer: 0,
    build(s) {
      for (let z = 0; z < s.l; z++) s.rect(0, s.h - 6, s.w - 1, s.h - 1, z, 'WALL')
      s.put(80, 120, 0, 'BATT')
      s.hline(81, 220, 120, 0, 'WIRE')
      s.vline(221, 121, 121, 0, 'WIRE')
      for (let z = 0; z <= 3; z++) s.put(222, 120, z, 'VIA')
      s.hline(223, 330, 120, 3, 'WIRE')
      s.rect(331, 117, 338, 123, 3, 'LAMP')
      // a decoy on the same footprint one layer over: no via, no light
      s.hline(223, 330, 150, 1, 'WIRE')
      s.rect(331, 147, 338, 153, 1, 'LAMP')
      s.put(222, 150, 0, 'WIRE')
    },
  },
  {
    id: 'reactor',
    name: '원자로',
    hint: '흑연이 중성자를 느리게 만들어 연쇄반응을 돕고, 납이 그것을 막습니다. 중수가 열을 실어 나갑니다. 우라늄 덩이에 중성자 하나를 쏘면 시작됩니다.',
    mode: 'thermal',
    build(s) {
      room(s)
      const cx = 240, cy = 150
      s.rect(cx - 90, cy - 70, cx + 90, cy + 70, 0, 'LEAD')
      s.rect(cx - 80, cy - 60, cx + 80, cy + 60, 0, 'HVYW')
      for (let k = -2; k <= 2; k++) {
        s.rect(cx + k * 26 - 5, cy - 45, cx + k * 26 + 5, cy + 45, 0, 'URAN')
        if (k < 2) s.rect(cx + k * 26 + 8, cy - 45, cx + k * 26 + 15, cy + 45, 0, 'GRPH')
      }
      s.rect(cx - 90, cy - 78, cx + 90, cy - 72, 0, 'INSL')
      s.blob(cx, cy, 0, 'NEUT', 1)
    },
  },
  {
    id: 'volcano',
    name: '화산',
    hint: '암반 아래 용암이 갇혀 있고 위에는 바닷물이 있습니다. 용암이 물에 닿으면 흑요석이 되며 수증기를 뿜습니다. 압력 보기로 전환해 보세요.',
    build(s) {
      room(s)
      s.rect(6, 120, s.w - 7, s.h - 7, 0, 'BSLT')
      s.rect(150, 190, 330, 250, 0, 'LAVA')
      s.vline(240, 130, 190, 0, 'NONE')
      s.vline(241, 130, 190, 0, 'NONE')
      s.rect(6, 92, s.w - 7, 119, 0, 'WATR')
      s.rect(200, 236, 280, 246, 0, 'PUMP')
      s.hline(200, 280, 247, 0, 'BATT')
      // a lava source, so the chamber does not simply cool into stone
      s.hline(170, 310, 249, 0, 'CLNE')
      s.hline(170, 310, 248, 0, 'LAVA')
    },
  },
  {
    id: 'dust-explosion',
    name: '분진 폭발',
    hint: '가라앉은 밀가루는 잘 타지 않습니다. 공중에 흩어진 밀가루는 다릅니다 — 불씨 하나에 방 전체가 한꺼번에 탑니다.',
    build(s) {
      room(s, 40)
      s.rect(6, 40, s.w - 7, 46, 0, 'WALL')
      s.scatter(20, 60, 460, 230, 0, 'CFLR', 0.16)
      s.rect(40, 240, 120, 250, 0, 'CFLR')
      s.blob(240, 250, 0, 'FIRE', 3)
    },
  },
  {
    id: 'thermite',
    name: '테르밋 절단',
    hint: '녹과 알루미늄 가루가 섞이면 테르밋이 됩니다. 1200K 를 넘겨야 붙지만, 붙고 나면 2400K 를 뱉으며 강철판을 뚫고 내려갑니다.',
    mode: 'thermal',
    build(s) {
      room(s)
      s.rect(120, 180, 360, 200, 0, 'STEL')
      s.rect(200, 150, 280, 178, 0, 'THRM')
      s.rect(150, 120, 200, 140, 0, 'RUST')
      s.rect(280, 120, 330, 140, 0, 'ALMD')
      s.rect(120, 210, 360, 214, 0, 'CRMC')
      s.tuneRect(234, 148, 246, 154, 0, 'HEAT', 1900)
    },
  },
  {
    id: 'gunpowder',
    name: '흑색화약 만들기',
    hint: '질산칼륨 · 황 · 숯을 서로 닿게 두면 화약이 됩니다. 만들어진 화약에 불을 대면 어떻게 되는지는 아시는 대로입니다.',
    build(s) {
      room(s)
      s.rect(80, 200, 180, 250, 0, 'KNO3')
      s.rect(180, 200, 240, 250, 0, 'SULF')
      s.rect(240, 200, 340, 250, 0, 'CHAR')
      s.rect(60, 190, 360, 194, 0, 'GLAS')
      s.rect(380, 150, 440, 250, 0, 'WALL')
      s.rect(386, 156, 434, 244, 0, 'KNO3')
    },
  },
  {
    id: 'sodium',
    name: '나트륨과 물',
    hint: '나트륨은 기름 밑에 잠겨 있으면 얌전합니다. 기름층을 지워 물이 닿게 하면 수소가 터져 나옵니다.',
    build(s) {
      room(s)
      s.rect(6, 150, s.w - 7, s.h - 7, 0, 'WATR')
      s.rect(6, 120, s.w - 7, 149, 0, 'OIL')
      for (const x of [120, 200, 280]) s.blob(x, 136, 0, 'SODM', 5)
      // this one is already through the oil layer — the demonstration
      s.blob(380, 168, 0, 'SODM', 4)
      s.rect(6, 60, s.w - 7, 64, 0, 'GLAS')
    },
  },
  {
    id: 'garden',
    name: '정원',
    hint: '씨앗은 물과 적당한 온도를 만나면 싹이 틉니다. 식물은 이산화탄소를 산소로 바꾸고, 광자를 맞으면 더 자랍니다. 조류는 물 속에서 같은 일을 합니다.',
    build(s) {
      room(s)
      s.rect(6, 210, s.w - 7, s.h - 7, 0, 'DIRT')
      s.rect(6, 200, s.w - 7, 209, 0, 'MUD')
      s.scatter(20, 190, 460, 198, 0, 'SEED', 0.25)
      s.rect(300, 150, 460, 209, 0, 'WATR')
      s.blob(380, 180, 0, 'ALGE', 6)
      s.rect(20, 40, 280, 44, 0, 'CO2')
      for (let x = 40; x < 260; x += 24) s.put(x, 50, 0, 'CLNE')
      for (let x = 40; x < 260; x += 24) s.put(x, 51, 0, 'PHOT')
    },
  },
  {
    id: 'magnet',
    name: '자석',
    hint: '쇳가루는 흘러내리다가 자석 곁을 지나면 끌려갑니다. 자석을 1043K 위로 가열하면 자성을 잃고 그냥 철이 됩니다.',
    build(s) {
      room(s)
      s.rect(200, 160, 280, 200, 0, 'MAGT')
      s.rect(150, 100, 330, 104, 0, 'WALL')
      s.rect(160, 60, 320, 96, 0, 'IRND')
      s.rect(150, 104, 154, 140, 0, 'NONE')
      s.rect(326, 104, 330, 140, 0, 'NONE')
      // a burner under one corner: past 1043K that corner stops being a magnet
      s.tuneRect(200, 201, 216, 204, 0, 'HEAT', 1400)
      s.tuneRect(60, 240, 150, 248, 0, 'HEAT', 1400)
    },
  },
]

export const SCENE_BY_ID = new Map(SCENES.map(s => [s.id, s]))

export function buildScene(sim: Sim, id: string): Scene | undefined {
  const scene = SCENE_BY_ID.get(id)
  if (!scene) return undefined
  sim.reset()
  scene.build(new Sheet(sim))
  return scene
}
