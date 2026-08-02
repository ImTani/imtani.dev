/**
 * Debug renderer. Scaffolding, not design.
 *
 * One pixel per cell, nearest-neighbour upscaled, monochrome. It exists to
 * prove the substrate is producing what the tests say it is and to have
 * something to look at while tuning. Every visual decision here is a
 * placeholder and none of it should survive into the site.
 */

import type { GridSpec } from '../engine/substrate.ts';

export class DebugRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly buffer: Uint32Array;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly spec: GridSpec,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    canvas.width = spec.width;
    canvas.height = spec.height;
    this.image = ctx.createImageData(spec.width, spec.height);
    this.buffer = new Uint32Array(this.image.data.buffer);
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(grid: Uint32Array): void {
    const { width, height, words } = this.spec;
    // Little-endian ABGR, which is what a Uint32 view of ImageData wants.
    const live = 0xff_e8_e8_e8;
    const dead = 0xff_14_14_14;

    for (let y = 0; y < height; y++) {
      const row = y * words;
      const out = y * width;
      for (let w = 0; w < words; w++) {
        const word = grid[row + w]!;
        const base = out + (w << 5);
        for (let bit = 0; bit < 32; bit++) {
          this.buffer[base + bit] = (word >>> bit) & 1 ? live : dead;
        }
      }
    }

    this.ctx.putImageData(this.image, 0, 0);
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }
}
