/**
 * Checkpoint serialisation.
 *
 * A checkpoint is what stops catch-up cost from growing with the age of the
 * site. Without one, a first-time visitor two years after launch recomputes
 * every step from the epoch — measured at 37 seconds. With a snapshot baked at
 * build time and a weekly rebuild, the worst case is bounded by the deploy
 * interval instead, which is under a second.
 *
 * Byte order is written explicitly little-endian through a DataView. Reading a
 * Uint32Array's underlying buffer directly would be host-endian, and a
 * checkpoint baked on one machine would decode to noise on another.
 */

import type { BanditState } from './bandit.ts';
import { RULE_ARMS } from './rules.ts';
import type { GridSpec } from './substrate.ts';

export const CHECKPOINT_VERSION = 1;

export interface Checkpoint {
  readonly version: number;
  readonly seed: number;
  readonly epochMs: number;
  readonly stepMs: number;
  readonly width: number;
  readonly height: number;
  /** Substrate step this grid represents. */
  readonly step: number;
  /** Base64 of the packed grid, little-endian. */
  readonly grid: string;
  readonly bandit: BanditState;
  /** Rule names at bake time, so a changed RULE_ARMS invalidates the snapshot. */
  readonly arms: readonly string[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeGrid(grid: Uint32Array): string {
  const bytes = new Uint8Array(grid.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < grid.length; i++) view.setUint32(i * 4, grid[i]!, true);
  return bytesToBase64(bytes);
}

export function decodeGrid(b64: string, expectedWords: number): Uint32Array {
  const bytes = base64ToBytes(b64);
  if (bytes.length !== expectedWords * 4) {
    throw new Error(`grid is ${bytes.length} bytes, expected ${expectedWords * 4}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(expectedWords);
  for (let i = 0; i < expectedWords; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

/**
 * Is this checkpoint still usable?
 *
 * A snapshot describes a world produced by a specific seed, epoch, geometry and
 * rule set. If any of those moved, the snapshot is not a shortcut to the current
 * world — it is a picture of a different one, and silently continuing from it
 * would be worse than recomputing.
 */
export function isCompatible(
  cp: Checkpoint,
  spec: GridSpec,
  seed: number,
  epochMs: number,
  stepMs: number,
): boolean {
  if (cp.version !== CHECKPOINT_VERSION) return false;
  if (cp.seed !== seed || cp.epochMs !== epochMs || cp.stepMs !== stepMs) return false;
  if (cp.width !== spec.width || cp.height !== spec.height) return false;
  if (cp.arms.length !== RULE_ARMS.length) return false;
  return cp.arms.every((name, i) => name === RULE_ARMS[i]!.name);
}
