/**
 * Compositing debug renderer. Scaffolding, not design.
 *
 * Draws the three layers together so their interaction can be judged: the
 * substrate as discrete cells, the surface field as continuous glow over them,
 * and the creature on top. Monochrome and deliberately plain — every colour
 * here is a placeholder and none of it should survive into the site.
 *
 * Two-stage draw, and the split is not arbitrary. Substrate and surface are
 * grid-resolution data, so they go through an offscreen ImageData at exactly
 * one pixel per cell and are then scaled up with smoothing off. The creature is
 * drawn afterwards in canvas space with vector operations, because it is
 * supposed to read as vector when outside the automaton and grid-bound when
 * inside it — that distinction is impossible if it is rasterised into the same
 * buffer as the cells.
 */

import type { GridSpec } from '../engine/substrate.ts';
import { ease } from '../surface/tween.ts';

export interface CreatureView {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly state: string;
  readonly trust: number;
  readonly embedded: boolean;
}

export class CompositeRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly offscreen: HTMLCanvasElement;
  private readonly offCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;

  private cssWidth = 0;
  private cssHeight = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly spec: GridSpec,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;

    this.offscreen = document.createElement('canvas');
    this.offscreen.width = spec.width;
    this.offscreen.height = spec.height;
    const offCtx = this.offscreen.getContext('2d', { alpha: false });
    if (!offCtx) throw new Error('offscreen 2d context unavailable');
    this.offCtx = offCtx;

    this.image = offCtx.createImageData(spec.width, spec.height);
    this.pixels = new Uint32Array(this.image.data.buffer);

    this.resize();
  }

  /** Match the backing store to the element's CSS size and pixel ratio. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssWidth = Math.max(1, Math.round(rect.width));
    this.cssHeight = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  get viewport(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  draw(
    levels: Float32Array,
    energy: Float32Array | null,
    peak: number,
    creature: CreatureView | null,
  ): void {
    const { width, height } = this.spec;
    // Normalise against the running peak rather than a constant: the field's
    // absolute magnitude swings by orders of magnitude between a fresh
    // injection and the end of a decay, and a fixed scale makes it either
    // clip constantly or vanish.
    const scale = energy && peak > 1e-6 ? 1 / peak : 0;

    const cells = width * height;
    for (let i = 0; i < cells; i++) {
      // Interpolated aliveness, not the raw bit. Smoothstepped here rather
      // than in the tween so the stored value stays linear progress and a cell
      // that reverses direction mid-fade does not jump.
      const a = ease(levels[i]!);

      // Square root rather than linear. The field's values are dominated by a
      // handful of freshly-injected cells, so against a linear ramp normalised
      // to the peak everything else reads as black and the layer looks broken
      // when it is in fact working.
      const e = energy ? Math.sqrt(Math.min(1, energy[i]! * scale)) : 0;

      // Substrate is neutral, surface is warm. Two layers on one canvas are
      // only judgeable if you can tell which is which, and hue is the cheapest
      // separation available. Debug colouring — not a palette.
      const base0 = 0.04 + a * 0.84;
      const r = Math.min(1, base0 + e * 0.72);
      const g = Math.min(1, base0 + e * 0.42);
      const b = Math.min(1, base0 + e * 0.2);

      this.pixels[i] =
        (255 << 24) |
        (Math.round(b * 255) << 16) |
        (Math.round(g * 255) << 8) |
        Math.round(r * 255);
    }

    this.offCtx.putImageData(this.image, 0, 0);
    this.ctx.drawImage(this.offscreen, 0, 0, this.cssWidth, this.cssHeight);

    if (creature) this.drawCreature(creature);
  }

  private drawCreature(c: CreatureView): void {
    const ctx = this.ctx;
    const cellW = this.cssWidth / this.spec.width;
    const cellH = this.cssHeight / this.spec.height;

    ctx.save();
    ctx.translate(c.x, c.y);

    // A distinct hue, and not for taste: white cells on a white creature made
    // it genuinely impossible to find on screen. Debug colouring only.
    const skin = c.state === 'startled' ? '#ff5a4d' : '#6fe3c4';

    if (c.embedded) {
      // Grid-bound: snap to the cell lattice and draw as a hard square, so it
      // reads as part of the automaton rather than as something on top of it.
      const sx = Math.round(c.x / cellW) * cellW - c.x;
      const sy = Math.round(c.y / cellH) * cellH - c.y;
      ctx.translate(sx, sy);
      ctx.fillStyle = skin;
      ctx.fillRect(-cellW * 1.5, -cellH * 1.5, cellW * 3, cellH * 3);
    } else {
      // Vector: a rounded body with a heading indicator. Placeholder shape —
      // the actual creature is not designed yet.
      ctx.rotate(c.heading);
      const r = 9;
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#101010';
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.3, 1.9, 0, Math.PI * 2);
      ctx.arc(r * 0.5, r * 0.3, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Trust ring — diagnostic only. Radius is meaningless; the arc length is
    // the value.
    ctx.save();
    ctx.strokeStyle = 'rgba(111,227,196,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.trust);
    ctx.stroke();
    ctx.restore();
  }
}
