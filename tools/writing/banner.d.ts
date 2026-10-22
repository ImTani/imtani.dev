/* Types for banner.js.
 *
 * banner.js is hand-written as plain JavaScript on purpose, for the same
 * reason hand.js is: build.ts pastes its source into a <script> tag, so it
 * cannot carry type annotations. This file is what `tsc` reads when
 * banner-plate.ts imports it. It can silently disagree with the
 * implementation beside it — change the two together.
 */

export type Rgb = [number, number, number];

export interface BannerRaster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** All lengths in grid cells unless the name says Css. */
export interface BannerGeometry {
  W: number;
  H: number;
  cell: number;
  gw: number;
  gh: number;
  artScale: number;
  /** Cells per source pixel. */
  k: number;
  aw: number;
  ah: number;
  /** Where anchorX puts the picture's left edge, in cells. The fade is measured from here. */
  xa: number;
  /** The picture's left edge at rest, in cells: xa pushed out by the wiggle crop. May be negative. */
  x0: number;
  /** The wiggle's reach, in cells. */
  slack: number;
  /** Cells of picture taller than the band — the whole travel budget. */
  surplus: number;
  travelCells: number;
  cellDev?: number;
  rampFootCss?: number;
  rampHeadCss?: number;
}

export interface BannerGeometryInput {
  W: number;
  H: number;
  cell: number;
  AW: number;
  AH: number;
  artScale: number | 'cover';
  anchorX: number;
  travel: number | null;
  /** CSS px of wiggle room to crop at the anchored edge. Default 0. */
  wiggle?: number;
}

export interface BannerFadeOptions {
  ramp: number;
  rampWidth: number;
  rampSpace: 'band' | 'art';
  feather: number;
}

/** Per-source-column vertical prefix sums of ink, 0..1 per pixel (see bInkField). */
export interface BannerSource {
  prefix: Float32Array;
  width: number;
  rows: number;
  /** The picture's own ground, OKLab, that ink is measured from. */
  ground: [number, number, number];
  /** The OKLab distance that counts as full ink: the 98th percentile. */
  scale: number;
}

/** Reused per-frame buffers. Create one and hand it to every bScreen call. */
export interface BannerScratch {
  hp?: Float64Array;
  ei?: Int32Array;
  ef?: Float64Array;
  ev?: Float64Array;
  pr?: Float32Array;
  pg?: Float32Array;
  pb?: Float32Array;
  palRef?: Rgb[] | null;
}

/** `createBannerScreen`'s defaults; banner-plate.ts merges an article's settings over these. */
export declare const DEFAULTS: {
  grain: number;
  levels: number;
  ramp: number;
  rampWidth: number;
  cell: number;
  artScale: number | 'cover';
  anchorX: number;
  focus: number;
  travel: number | null;
  direction: number;
  rampSpace: 'band' | 'art';
  feather: number;
  follow: number;
  wiggle: number;
  wiggleSign: number;
  pivot: null;
  fps: number | null;
  progress: null;
  motion: boolean | null;
  tokens: string[];
};

export declare const BAYER8: number[];
/** The six ramp custom properties, in role order paper -> ink. */
export declare const BANNER_TOKENS: string[];

export declare function bClamp(v: number, a: number, b: number): number;
export declare function bSmoothstep(e0: number, e1: number, x: number): number;
export declare function bParseColor(s: string): Rgb | null;
export declare function bLuminance(rgb: Rgb | number[]): number;
export declare function bContrast(a: Rgb | number[], b: Rgb | number[]): number;

export declare function bResolveRamp(
  tones: (Rgb | number[])[],
  levels: number,
): { pal: Rgb[]; dark: boolean; warnings: string[] };

export declare function bGeometry(o: BannerGeometryInput): BannerGeometry;

export declare function bOffset(
  g: BannerGeometry,
  focus: number,
  direction: number,
  progress: number,
): number;

/** Where the scroll travel starts, in cells. */
export declare function bTravelFrom(g: BannerGeometry, focus: number): number;

/** Every offset the picture can be shown at, in cells: the travel widened by
    `slack` cells each way and clamped to the picture. */
export declare function bReach(g: BannerGeometry, focus: number, slack: number): [number, number];

export declare function bPresenceRow(
  g: BannerGeometry,
  o: BannerFadeOptions,
): { row: Float32Array; footCss: number; headCss: number };

/** Per-pixel ink: OKLab distance from the picture's own ground, normalised to its 98th percentile. */
export declare function bInkField(art: BannerRaster): {
  ink: Float32Array;
  ground: [number, number, number];
  scale: number;
};

export declare function bReduceSource(art: BannerRaster): BannerSource;

/** exp((1 - d²/r²) / 2): displacement = peak * bPull(d2, r) * v / r. */
export declare function bPull(d2: number, r: number): number;

/** The picture's presence-weighted centre and radius, in cells. */
export declare function bPivot(
  g: BannerGeometry,
  pres: Float32Array,
): { x: number; y: number; r: number };

export declare function bScreen(
  out: Uint8ClampedArray,
  src: BannerSource,
  g: BannerGeometry,
  pres: Float32Array,
  pal: (Rgb | number[])[],
  grain: number,
  dark: boolean,
  ox: number,
  oy: number,
  scratch?: BannerScratch,
): void;

export interface BannerOptions extends Partial<BannerFadeOptions> {
  host: HTMLElement;
  art: string | HTMLImageElement | HTMLCanvasElement | ImageBitmap | BannerRaster;
  grain?: number;
  levels?: number;
  cell?: number;
  artScale?: number | 'cover';
  anchorX?: number;
  focus?: number;
  travel?: number | null;
  direction?: -1 | 1;
  /** ms; the follower's time constant. 0 snaps to the target. */
  follow?: number;
  /** CSS px: the most the pointer can move the picture, in any direction. Also crops that much at the anchored edge. 0 = off. */
  wiggle?: number;
  /** +1 leans toward the pointer, -1 away. */
  wiggleSign?: 1 | -1;
  /** What the pointer leans the picture toward: the centre of this element's text, with half its width as the radius. null = the picture's own presence-weighted centre. */
  pivot?: Element | null;
  /** Optional cap on the render clock. null = every animation frame. */
  fps?: number | null;
  progress?: (() => number) | null;
  motion?: boolean | null;
  tokens?: string[];
}

export interface BannerEnvelope {
  /** Worst contrast of `fg` against anything that column ever shows. */
  columns: Float64Array;
  /** The tone that produced it, rgb triples. */
  tones: Uint8Array;
  cell: number;
  /** The vertical offsets swept, in CSS px: scroll travel widened by the wiggle. */
  offsetsCss: [number, number];
  /** The horizontal offsets swept, in CSS px: ±wiggle. */
  offsetsXCss: [number, number];
  /** The bound a type block ending at `xCss` has to live with. */
  worstUpTo(xCss: number): number;
  worstBeyond(xCss: number): number;
}

export interface BannerReport {
  W: number;
  H: number;
  cell: number;
  cellDev: number;
  gw: number;
  gh: number;
  artScale: number;
  artLeftCss: number;
  artWidthCss: number;
  surplusCss: number;
  travelCss: number;
  /** Scroll the band survives, in px — the travel's whole budget. */
  scrollBudgetCss: number;
  /** travelCss / scrollBudgetCss. Above ~0.6 reads as a lurch. */
  panRate: number;
  rampFootCss: number;
  rampHeadCss: number;
  wiggleCss: number;
  /** How much of the picture the wiggle room hides at its anchored edge. */
  cropCss: number;
  pivotXCss: number;
  pivotYCss: number;
  pivotRCss: number;
  dark: boolean;
}

export interface BannerController {
  ready: Promise<void>;
  canvas: HTMLCanvasElement | null;
  stats: { frames: number; lastFrameMs: number; meanFrameMs: number; worstFrameMs: number };
  warnings: string[];
  params: Required<Omit<BannerOptions, 'host' | 'art'>>;
  render(progress?: number): void;
  set(next: Partial<Omit<BannerOptions, 'host' | 'art'>>): void;
  geometry(): BannerReport | null;
  palette(): Rgb[];
  envelope(o?: { steps?: number; stepsX?: number; rows?: [number, number]; fg?: Rgb }): BannerEnvelope | null;
  destroy(): void;
}

export declare function createBannerScreen(options: BannerOptions): BannerController;
