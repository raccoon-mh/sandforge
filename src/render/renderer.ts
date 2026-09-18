import type { Sim } from '../engine/sim.ts'
import { EMPTY, N, matColor, matFlat, matGlow } from '../engine/materials.ts'
import { P_SHIFT } from '../engine/pressure.ts'
import { FRAG, VERT } from './shaders.ts'

export type ViewMode = 'slice' | 'stack' | 'tilt'
export type ColourMode = 'material' | 'thermal' | 'pressure' | 'circuit'

const VIEW_ID: Record<ViewMode, number> = { slice: 0, stack: 1, tilt: 2 }
const MODE_ID: Record<ColourMode, number> = { material: 0, thermal: 1, pressure: 2, circuit: 3 }

export interface RenderOpts {
  layer: number
  view: ViewMode
  mode: ColourMode
  tiltX: number
  tiltY: number
  glow: number
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? ''
    // Print the offending line too — 'ERROR: 0:47' alone is not enough to act on.
    const line = /ERROR:\s*\d+:(\d+)/.exec(log)
    const near = line ? `\n  → ${src.split('\n')[+line[1] - 1]?.trim()}` : ''
    throw new Error('셰이더 컴파일 실패: ' + log + near)
  }
  return sh
}

export class Renderer {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private cellTex: WebGLTexture
  private paletteTex: WebGLTexture
  private fieldTex: WebGLTexture
  private u: Record<string, WebGLUniformLocation | null> = {}

  /** One layer's worth of RGBA bytes, reused every upload. */
  private stage: Uint8Array
  private fieldStage: Uint8Array
  private readonly pw: number
  private readonly ph: number

  /** Device pixels of the last viewport, so the UI can map clicks back to cells. */
  viewport = { x: 0, y: 0, w: 1, h: 1 }

  constructor(private canvas: OffscreenCanvas, private sim: Sim) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL2 를 쓸 수 없습니다')
    this.gl = gl

    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(this.prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
      throw new Error('셰이더 링크 실패: ' + gl.getProgramInfoLog(this.prog))
    }
    for (const name of ['uCells', 'uPalette', 'uField', 'uMode', 'uView', 'uLayer',
                        'uLayers', 'uTilt', 'uGlow', 'uTexel']) {
      this.u[name] = gl.getUniformLocation(this.prog, name)
    }

    const g = sim.grid
    this.stage = new Uint8Array(g.w * g.h * 4)
    this.pw = Math.ceil(g.w / (1 << P_SHIFT))
    this.ph = Math.ceil(g.h / (1 << P_SHIFT))
    this.fieldStage = new Uint8Array(this.pw * this.ph * 2)

    this.cellTex = this.makeArrayTex(gl.RGBA8, g.w, g.h, g.l)
    this.fieldTex = this.makeArrayTex(gl.RG8, this.pw, this.ph, g.l)
    this.paletteTex = this.makePalette()

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
  }

  private makeArrayTex(format: number, w: number, h: number, l: number): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, w, h, l)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private makePalette(): WebGLTexture {
    const gl = this.gl
    // Two rows: colour and glow, then the look flags.
    const buf = new Uint8Array(256 * 2 * 4)
    for (let i = 0; i < N; i++) {
      const c = matColor[i]
      buf[i * 4] = (c >> 16) & 255
      buf[i * 4 + 1] = (c >> 8) & 255
      buf[i * 4 + 2] = c & 255
      buf[i * 4 + 3] = Math.round(Math.min(1, matGlow[i]) * 255)
      buf[1024 + i * 4] = matFlat[i] ? 255 : 0
    }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 2)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 2, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return tex
  }

  /**
   * Pack one layer into the staging buffer. Temperature goes in as 16 bits
   * across B and A; the low three bits of G carry burning and charge so the
   * whole cell fits in one RGBA8 texel.
   */
  private uploadLayer(z: number): void {
    const gl = this.gl
    const g = this.sim.grid
    const { w, h, layerCells } = g
    const base = z * layerCells
    const buf = this.stage
    const type = g.type, temp = g.temp, tint = g.tint, chg = g.chg, burning = g.burning

    for (let i = 0; i < layerCells; i++) {
      const c = base + i
      const t = type[c]
      const o = i * 4
      if (t === EMPTY) {
        buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0
        continue
      }
      buf[o] = t
      buf[o + 1] = (tint[c] & 0xf8) | (burning[c] !== 0 ? 1 : 0) | (chg[c] !== 0 ? 2 : 0)
      let k = temp[c] * 6.5535 // 65535 / 10000
      if (k < 0) k = 0; else if (k > 65535) k = 65535
      const ki = k | 0
      buf[o + 2] = ki & 255
      buf[o + 3] = ki >> 8
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.cellTex)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, z, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  }

  private uploadField(z: number): void {
    const gl = this.gl
    const pf = this.sim.pf
    const buf = this.fieldStage
    const base = z * pf.perLayer
    for (let i = 0; i < pf.perLayer; i++) {
      let p = pf.p[base + i] / 160 + 0.5
      if (p < 0) p = 0; else if (p > 1) p = 1
      let v = (Math.abs(pf.vx[base + i]) + Math.abs(pf.vy[base + i])) * 0.2
      if (v > 1) v = 1
      buf[i * 2] = (p * 255) | 0
      buf[i * 2 + 1] = (v * 255) | 0
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldTex)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, z, this.pw, this.ph, 1, gl.RG, gl.UNSIGNED_BYTE, buf)
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  render(opts: RenderOpts): void {
    const gl = this.gl
    const g = this.sim.grid

    // Re-upload only the layers that changed since the last frame. A scene
    // where one layer is running and seven are parked costs one upload.
    const touched = g.layerTouched
    for (let z = 0; z < g.l; z++) {
      if (touched[z] === 0) continue
      this.uploadLayer(z)
      touched[z] = 0
    }
    if (opts.mode === 'pressure') this.uploadField(opts.layer)

    // Letterbox so cells stay square whatever the window is doing.
    const cw = this.canvas.width, ch = this.canvas.height
    const scale = Math.min(cw / g.w, ch / g.h)
    const vw = Math.max(1, Math.round(g.w * scale))
    const vh = Math.max(1, Math.round(g.h * scale))
    const vx = ((cw - vw) / 2) | 0
    const vy = ((ch - vh) / 2) | 0
    this.viewport = { x: vx, y: vy, w: vw, h: vh }

    gl.viewport(0, 0, cw, ch)
    gl.clearColor(0.043, 0.047, 0.059, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.viewport(vx, vy, vw, vh)

    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.cellTex)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.paletteTex)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldTex)
    gl.uniform1i(this.u.uCells!, 0)
    gl.uniform1i(this.u.uPalette!, 1)
    gl.uniform1i(this.u.uField!, 2)
    gl.uniform1i(this.u.uMode!, MODE_ID[opts.mode])
    gl.uniform1i(this.u.uView!, VIEW_ID[opts.view])
    gl.uniform1i(this.u.uLayer!, opts.layer)
    gl.uniform1i(this.u.uLayers!, g.l)
    gl.uniform2f(this.u.uTilt!, opts.tiltX, opts.tiltY)
    gl.uniform1f(this.u.uGlow!, opts.glow)
    gl.uniform2f(this.u.uTexel!, 1 / g.w, 1 / g.h)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
