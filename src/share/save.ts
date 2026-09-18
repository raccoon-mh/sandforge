import { Grid } from '../engine/grid.ts'
import { DEFS, ID_TO_NUM } from '../engine/materials.ts'

const MAGIC = 0x53464731 // "SFG1"

/**
 * Run-length encoded snapshot. Material ids go in as their four-character
 * codes, not their numeric index — the index is an implementation detail that
 * shifts whenever a material is added, and saves have to outlive that.
 */
export function encode(grid: Grid): ArrayBuffer {
  const used = new Set<number>()
  for (let i = 0; i < grid.cells; i++) used.add(grid.type[i])

  const table = [...used].sort((a, b) => a - b)
  const remap = new Map<number, number>()
  table.forEach((m, k) => remap.set(m, k))

  const head: number[] = []
  const runs: number[] = []
  let runMat = remap.get(grid.type[0])!
  let runTemp = Math.round(grid.temp[0])
  let runLen = 0
  for (let i = 0; i < grid.cells; i++) {
    const m = remap.get(grid.type[i])!
    const tp = Math.round(grid.temp[i])
    if (m === runMat && tp === runTemp && runLen < 0xffff) { runLen++; continue }
    runs.push(runMat, runTemp, runLen)
    runMat = m; runTemp = tp; runLen = 1
  }
  runs.push(runMat, runTemp, runLen)

  const names = table.map(m => DEFS[m].id)
  const nameBytes = new TextEncoder().encode(names.join(','))

  head.push(MAGIC, grid.w, grid.h, grid.l, table.length, nameBytes.length, runs.length / 3)
  const headBuf = new Int32Array(head)

  const out = new ArrayBuffer(headBuf.byteLength + nameBytes.byteLength + (runs.length / 3) * 8)
  const view = new DataView(out)
  new Uint8Array(out).set(new Uint8Array(headBuf.buffer), 0)
  new Uint8Array(out).set(nameBytes, headBuf.byteLength)

  let off = headBuf.byteLength + nameBytes.byteLength
  for (let k = 0; k < runs.length; k += 3) {
    view.setUint16(off, runs[k], true)
    view.setUint16(off + 2, Math.max(0, Math.min(65535, runs[k + 1])), true)
    view.setUint32(off + 4, runs[k + 2], true)
    off += 8
  }
  return out
}

export interface Decoded { w: number; h: number; l: number; apply(grid: Grid): void }

export function decode(buf: ArrayBuffer): Decoded {
  const head = new Int32Array(buf, 0, 7)
  if (head[0] !== MAGIC) throw new Error('SANDFORGE 저장 파일이 아닙니다')
  const [, w, h, l, tableLen, nameLen, runCount] = head
  const nameOff = 7 * 4
  const names = new TextDecoder().decode(new Uint8Array(buf, nameOff, nameLen)).split(',')
  if (names.length !== tableLen) throw new Error('저장 파일이 손상되었습니다')

  const table = names.map(n => ID_TO_NUM.get(n) ?? 0)
  const view = new DataView(buf)
  const runOff = nameOff + nameLen

  return {
    w, h, l,
    apply(grid: Grid) {
      grid.clear()
      let cell = 0
      for (let k = 0; k < runCount; k++) {
        const off = runOff + k * 8
        const mat = table[view.getUint16(off, true)] ?? 0
        const temp = view.getUint16(off + 2, true)
        const len = view.getUint32(off + 4, true)
        for (let n = 0; n < len && cell < grid.cells; n++, cell++) {
          grid.type[cell] = mat
          grid.temp[cell] = temp
          grid.tint[cell] = (Math.random() * 255) | 0
        }
      }
      grid.recount()
      grid.active.fill(1); grid.nextActive.fill(1)
      grid.colMask.fill(0xffffffff); grid.nextColMask.fill(0xffffffff)
      grid.rowMask.fill(0xffffffff); grid.nextRowMask.fill(0xffffffff)
      grid.thermal.fill(1)
      grid.layerTouched.fill(1)
    },
  }
}
