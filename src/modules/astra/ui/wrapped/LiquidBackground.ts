/**
 * @file LiquidBackground.ts
 * @description Animated "liquid" material for the Wrapped stories and their PNG exports.
 *
 * Evolved from the Fluido generator: domain-warped simplex FBM mapped onto a four-stop
 * palette, lit with a glossy sheen from finite-difference normals, plus vignette and grain.
 * Deep palettes are backdrops; vivid palettes fill poster typography. Live rendering
 * runs at one canvas pixel per CSS pixel (device pixel ratio capped at 1.5, width capped at
 * 2048 px) so the sheen and grain stay sharp, throttles to ~30 fps, pauses while
 * the tab is hidden and renders still frames under prefers-reduced-motion. Without
 * WebGL the host gets `aw-liquid-fallback` and CSS gradient blobs instead.
 */

export interface LiquidPalette {
  readonly name: string;
  /** Dark, mid, light, dark: the light band produces the bright liquid streaks. */
  readonly colors: readonly [string, string, string, string];
  /** Readable highlight for text and primary chart series on this palette. */
  readonly accent: string;
  /** Secondary chart series. */
  readonly accent2: string;
  /** Colour of the specular sheen. */
  readonly highlight: string;
  readonly swirl: number;
  readonly contrast: number;
  /** 0 = flat colour, 1 = full gloss. */
  readonly sheen: number;
  /** Edge darkening; low for vivid fills so poster type stays bright. */
  readonly vignette: number;
}

const deep = (
  name: string,
  colors: LiquidPalette['colors'],
  accent: string,
  accent2: string
): LiquidPalette => ({
  name,
  colors,
  accent,
  accent2,
  highlight: accent,
  swirl: 1.6,
  contrast: 1.9,
  sheen: 1,
  vignette: 0.42,
});
const vivid = (name: string, colors: LiquidPalette['colors'], accent2: string): LiquidPalette => ({
  name,
  colors,
  accent: '#ffffff',
  accent2,
  highlight: '#ffffff',
  swirl: 1.6,
  contrast: 1.6,
  sheen: 0.7,
  vignette: 0.12,
});

export const LIQUID_PALETTES = {
  nebula: deep('Nebula', ['#060818', '#2a1060', '#6a2ad0', '#100830'], '#c9b6ff', '#7fe3f5'),
  violet: deep('Viola Scuro', ['#1a1028', '#4a2080', '#8a4fd0', '#2a2040'], '#dcc4ff', '#ff9fd2'),
  ocean: deep('Oceano', ['#041020', '#0a4070', '#22a8c8', '#061830'], '#8fe9ff', '#c9b6ff'),
  rose: deep('Rosa Tossico', ['#18081a', '#80205a', '#e040a0', '#2a0828'], '#ffb8de', '#ffd59a'),
  lava: deep('Lava', ['#1a0800', '#8b2500', '#ff5a10', '#2a0a00'], '#ffc290', '#ffe7a3'),
  oil: deep('Olio Nero', ['#0a0a12', '#1c1c34', '#3a3a6c', '#08080e'], '#bfc7ff', '#8fe9ff'),
  lagoon: deep('Laguna', ['#03140f', '#0b4a3e', '#30b892', '#06201c'], '#9ff5d6', '#ffe7a3'),
  ember: deep('Ambra', ['#140a04', '#6b3a10', '#df8f2e', '#1e0f06'], '#ffd38f', '#ffb3a0'),
  vividNebula: vivid('Nebula vivid', ['#3a1a9a', '#7b4dff', '#e6d8ff', '#5a2fd0'], '#7fe3f5'),
  vividOcean: vivid('Ocean vivid', ['#0c5a8a', '#27b5e0', '#e2fbff', '#1680b8'], '#c9b6ff'),
  vividRose: vivid('Rose vivid', ['#9a1d6a', '#f052b0', '#ffe2f3', '#c42e8a'], '#ffd59a'),
  vividLava: vivid('Lava vivid', ['#b83300', '#ff6a1a', '#ffe6c2', '#e04a00'], '#ffe7a3'),
  vividLagoon: vivid('Lagoon vivid', ['#0a6b56', '#2fd6a6', '#e3fff5', '#13987a'], '#ffe7a3'),
  vividEmber: vivid('Ember vivid', ['#a85a10', '#ffb340', '#fff1d6', '#d98a20'], '#ffb3a0'),
} as const satisfies Record<string, LiquidPalette>;

const VERTEX_SHADER = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.,1.);}';

/* Simplex noise by Ian McEwan / Ashima Arts (MIT), as used by the Fluido generator. */
const FRAGMENT_SHADER = `precision highp float;
uniform vec2 u_res;
uniform float u_time, u_swirl, u_contrast, u_seed, u_grain, u_sheen, u_vignette;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_hi;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;
  vec3 h=abs(x)-.5;
  vec3 ox=floor(x+.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  mat2 rot=mat2(cos(.5),sin(.5),-sin(.5),cos(.5));
  for(int i=0;i<3;i++){v+=a*snoise(p);p=rot*p*2.;a*=.5;}
  return v;
}
float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  vec2 p=uv*2.-1.;
  p.x*=u_res.x/u_res.y;
  p*=.22;
  float t=u_time;
  vec2 q=vec2(fbm(p+u_seed+vec2(0.,t*.035)),fbm(p+vec2(5.2,1.3)+u_seed-vec2(t*.03,0.)));
  vec2 r=vec2(fbm(p+u_swirl*q+vec2(1.7,9.2)+u_seed*.3+t*.02),fbm(p+u_swirl*q+vec2(8.3,2.8)+u_seed*.3-t*.025));
  vec2 flow=p+u_swirl*r+t*.05;
  float raw=fbm(flow);
  float n=clamp(raw*u_contrast*.5+.5,0.,1.);
  vec3 col=n<.33?mix(u_c1,u_c2,n/.33):n<.66?mix(u_c2,u_c3,(n-.33)/.33):mix(u_c3,u_c4,(n-.66)/.34);
  // Normals from finite differences in pattern space: smooth at any resolution
  // (GPU derivatives are per 2x2 quad and look blocky at half resolution).
  const float E=.004;
  vec2 slope=vec2(fbm(flow+vec2(E,0.))-raw,fbm(flow+vec2(0.,E))-raw)/E*.154;
  vec3 normal=normalize(vec3(-slope,1.));
  vec3 light=normalize(vec3(-.45,.6,.65));
  float spec=pow(max(dot(reflect(-light,normal),vec3(0.,0.,1.)),0.),18.);
  col+=u_hi*(spec*.55+(1.-normal.z)*.25)*u_sheen;
  col*=mix(1.,mix(.92,1.06,dot(normal,light)),u_sheen);
  col*=mix(1.-u_vignette,1.,smoothstep(1.25,.2,length((uv-.5)*vec2(1.,1.1))));
  col+=(grain(gl_FragCoord.xy+fract(t)*97.)-.5)*u_grain;
  gl_FragColor=vec4(col,1.);
}`;

/** Live canvas resolution relative to CSS pixels: 1 canvas pixel per CSS pixel. */
const LIVE_RENDER_SCALE = 1;
/** Device-pixel ceiling for the live loop: the shader cost grows with pixel count. */
const LIVE_MAX_PIXEL_RATIO = 1.5;
const LIVE_MAX_WIDTH = 2048;
const FRAME_INTERVAL_MS = 32;
const FLOW_SPEED = 0.42;
const TRANSITION_MS = 1400;
const LIVE_GRAIN = 0.03;
const EXPORT_GRAIN = 0.04;

type Rgb = readonly [number, number, number];
interface LiquidState {
  colors: readonly [Rgb, Rgb, Rgb, Rgb];
  highlight: Rgb;
  swirl: number;
  contrast: number;
  sheen: number;
  vignette: number;
}
type UniformName =
  | 'res'
  | 'time'
  | 'swirl'
  | 'contrast'
  | 'seed'
  | 'grain'
  | 'sheen'
  | 'vignette'
  | 'c1'
  | 'c2'
  | 'c3'
  | 'c4'
  | 'hi';
interface LiquidProgram {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uniforms: Record<UniformName, WebGLUniformLocation | null>;
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function paletteState(palette: LiquidPalette): LiquidState {
  const [c1, c2, c3, c4] = palette.colors;
  return {
    colors: [hexToRgb(c1), hexToRgb(c2), hexToRgb(c3), hexToRgb(c4)],
    highlight: hexToRgb(palette.highlight),
    swirl: palette.swirl,
    contrast: palette.contrast,
    sheen: palette.sheen,
    vignette: palette.vignette,
  };
}

function mixState(from: LiquidState, to: LiquidState, amount: number): LiquidState {
  const mix = (a: number, b: number) => a + (b - a) * amount;
  const rgb = (a: Rgb, b: Rgb): Rgb => [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
  return {
    colors: [
      rgb(from.colors[0], to.colors[0]),
      rgb(from.colors[1], to.colors[1]),
      rgb(from.colors[2], to.colors[2]),
      rgb(from.colors[3], to.colors[3]),
    ],
    highlight: rgb(from.highlight, to.highlight),
    swirl: mix(from.swirl, to.swirl),
    contrast: mix(from.contrast, to.contrast),
    sheen: mix(from.sheen, to.sheen),
    vignette: mix(from.vignette, to.vignette),
  };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createProgram(
  canvas: HTMLCanvasElement,
  preserveDrawingBuffer: boolean
): LiquidProgram | null {
  // jsdom and locked-down GPUs have no WebGL: callers fall back to CSS/2D gradients.
  if (typeof WebGLRenderingContext === 'undefined') return null;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return shader;
    gl!.deleteShader(shader);
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (!vertex || !fragment || !program || !buffer) {
    release(gl);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    release(gl);
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const names: Record<UniformName, string> = {
    res: 'u_res',
    time: 'u_time',
    swirl: 'u_swirl',
    contrast: 'u_contrast',
    seed: 'u_seed',
    grain: 'u_grain',
    sheen: 'u_sheen',
    vignette: 'u_vignette',
    c1: 'u_c1',
    c2: 'u_c2',
    c3: 'u_c3',
    c4: 'u_c4',
    hi: 'u_hi',
  };
  const uniforms = Object.fromEntries(
    Object.entries(names).map(([key, name]) => [key, gl!.getUniformLocation(program, name)])
  ) as LiquidProgram['uniforms'];
  return { gl, program, buffer, uniforms };
}

function release(gl: WebGLRenderingContext): void {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

function destroy(target: LiquidProgram): void {
  target.gl.deleteBuffer(target.buffer);
  target.gl.deleteProgram(target.program);
  release(target.gl);
}

function draw(
  target: LiquidProgram,
  width: number,
  height: number,
  time: number,
  state: LiquidState,
  seed: number,
  grain: number
): void {
  const { gl, uniforms } = target;
  gl.viewport(0, 0, width, height);
  gl.uniform2f(uniforms.res, width, height);
  gl.uniform1f(uniforms.time, time);
  gl.uniform1f(uniforms.swirl, state.swirl);
  gl.uniform1f(uniforms.contrast, state.contrast);
  gl.uniform1f(uniforms.seed, seed);
  gl.uniform1f(uniforms.grain, grain);
  gl.uniform1f(uniforms.sheen, state.sheen);
  gl.uniform1f(uniforms.vignette, state.vignette);
  gl.uniform3fv(uniforms.c1, state.colors[0]);
  gl.uniform3fv(uniforms.c2, state.colors[1]);
  gl.uniform3fv(uniforms.c3, state.colors[2]);
  gl.uniform3fv(uniforms.c4, state.colors[3]);
  gl.uniform3fv(uniforms.hi, state.highlight);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Exposes the palette to CSS (accents, fallback blobs) on the story host. */
function applyPaletteVariables(host: HTMLElement, palette: LiquidPalette): void {
  palette.colors.forEach((color, index) => host.style.setProperty(`--aw-c${index + 1}`, color));
  host.style.setProperty('--aw-accent', palette.accent);
  host.style.setProperty('--aw-accent-2', palette.accent2);
}

/**
 * Owns one live WebGL canvas. Create on mount, call dispose() on unmount: it
 * cancels the frame loop, removes its document listener and frees the GPU context.
 */
export class LiquidBackground {
  private target: LiquidProgram | null;
  private from: LiquidState;
  private to: LiquidState;
  private current: LiquidState;
  private transitionStart = 0;
  private frame = 0;
  private lastTick = 0;
  private lastRender = 0;
  private time: number;
  private disposed = false;
  private readonly still = prefersReducedMotion();
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onVisibility = (): void => {
    this.lastTick = 0;
    this.schedule();
  };
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.fail();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    palette: LiquidPalette,
    private readonly seed: number
  ) {
    this.from = this.to = this.current = paletteState(palette);
    this.time = seed % 23;
    applyPaletteVariables(host, palette);
    this.target = createProgram(canvas, false);
    if (!this.target) {
      this.fail();
      return;
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.schedule());
      this.resizeObserver.observe(canvas);
    }
    this.schedule();
  }

  /** True while WebGL is rendering; false when the CSS fallback is shown. */
  get isLive(): boolean {
    return this.target !== null;
  }

  setPalette(palette: LiquidPalette, animate = true): void {
    if (this.disposed) return;
    applyPaletteVariables(this.host, palette);
    this.from = this.current;
    this.to = paletteState(palette);
    this.transitionStart = animate && !this.still ? performance.now() : 0;
    if (!this.transitionStart) this.current = this.from = this.to;
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    if (this.target) destroy(this.target);
    this.target = null;
  }

  private fail(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.target = null;
    this.host.classList.add('aw-liquid-fallback');
  }

  private schedule(): void {
    if (
      this.disposed ||
      !this.target ||
      this.frame ||
      document.hidden ||
      typeof requestAnimationFrame !== 'function'
    )
      return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (this.disposed || !this.target) return;
    let transitioning = false;
    if (this.transitionStart) {
      const progress = Math.min(1, (now - this.transitionStart) / TRANSITION_MS);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      this.current = mixState(this.from, this.to, eased);
      transitioning = progress < 1;
      if (!transitioning) this.transitionStart = 0;
    }
    if (!this.still)
      this.time += ((this.lastTick ? Math.min(now - this.lastTick, 100) : 16) / 1000) * FLOW_SPEED;
    this.lastTick = now;
    // Still mode only ticks on demand (resize, palette); animated mode is throttled.
    if (this.still || now - this.lastRender >= FRAME_INTERVAL_MS) {
      this.lastRender = now;
      this.render();
    }
    if (!this.still || transitioning) this.schedule();
  };

  private render(): void {
    if (!this.target) return;
    const density =
      LIVE_RENDER_SCALE * Math.min(window.devicePixelRatio || 1, LIVE_MAX_PIXEL_RATIO);
    let width = Math.max(1, Math.round(this.canvas.clientWidth * density));
    let height = Math.max(1, Math.round(this.canvas.clientHeight * density));
    if (width > LIVE_MAX_WIDTH) {
      height = Math.max(1, Math.round((height * LIVE_MAX_WIDTH) / width));
      width = LIVE_MAX_WIDTH;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    draw(this.target, width, height, this.time, this.current, this.seed, LIVE_GRAIN);
  }
}

/** Deterministic PRNG so fallback exports are reproducible. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function paintFallback(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: LiquidPalette,
  seed: number
): void {
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, palette.colors[0]);
  base.addColorStop(1, palette.colors[3]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  const next = random(seed);
  const blobs = [palette.colors[1], palette.colors[2], palette.colors[1], palette.colors[2]];
  blobs.forEach((color, index) => {
    const x = width * (0.15 + next() * 0.7);
    const y = height * (index / blobs.length + next() * 0.25);
    const radius = Math.max(width, height) * (0.35 + next() * 0.2);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `${color}cc`);
    blob.addColorStop(1, `${color}00`);
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, width, height);
  });
  for (let index = 0; index < (width * height) / 900; index++) {
    ctx.fillStyle = `rgba(255,255,255,${next() * 0.04})`;
    ctx.fillRect(next() * width, next() * height, 1, 1);
  }
}

/**
 * Paints one full-resolution liquid frame into a 2D canvas. Uses a short-lived
 * WebGL context (released immediately) or a 2D gradient fallback.
 */
export function paintLiquid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: LiquidPalette,
  seed: number
): void {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const target = createProgram(canvas, true);
  if (!target) {
    paintFallback(ctx, width, height, palette, seed);
    return;
  }
  try {
    draw(target, width, height, seed % 23, paletteState(palette), seed, EXPORT_GRAIN);
    ctx.drawImage(canvas, 0, 0, width, height);
  } catch {
    paintFallback(ctx, width, height, palette, seed);
  } finally {
    destroy(target);
  }
}
