/**
 * Transcode the Rise&Shine devlog's media. Run by hand, output committed.
 *
 *     npm run devlog:media
 *
 * This is deliberately *not* part of `npm run build`. It shells out to ffmpeg
 * for fifty-odd encodes and takes minutes; making every build pay that — and
 * requiring ffmpeg on every machine and in CI — to reproduce bytes that never
 * change would be the wrong trade. The build consumes `public/writing/` and
 * `media.json`, both committed, and never runs ffmpeg.
 *
 * What it does:
 *
 *   GIF -> MP4 (H.264, yuv420p, faststart) + WebM (VP9) + a WebP poster frame.
 *     Twenty megabytes of GIF is not a thing to put on a reading page. Both
 *     containers because Safari wants H.264 and VP9 is smaller where it is
 *     taken. The poster is what a reader with JavaScript off actually sees.
 *
 *   PNG -> WebP, encoded twice and the better trade kept. These are screenshots
 *     of editor UI and pixel art: lossy WebP smears one-pixel text and lossless
 *     WebP is often *smaller* than the lossy encode on flat-colour images, so
 *     which one wins has to be measured per file rather than assumed.
 *
 * Nothing is resized up, and nothing is re-encoded from an already-lossy
 * intermediate — every output comes from the original export file.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MEDIA_MANIFEST_REL,
  OUT_DIR_REL,
  SLUGS,
  SOURCE_DIR_REL,
  extensionOf,
} from './embeds.ts';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '../..');
const sourceDir = resolve(siteRoot, SOURCE_DIR_REL);
const outDir = resolve(siteRoot, OUT_DIR_REL);
const manifestPath = resolve(siteRoot, MEDIA_MANIFEST_REL);

/** Wide enough for a 2x display at the figure's rendered width; no larger. */
const MAX_IMAGE_WIDTH = 1440;
const MAX_VIDEO_WIDTH = 1280;

export interface MediaEntry {
  readonly kind: 'image' | 'video';
  readonly source: string;
  readonly width: number;
  readonly height: number;
  readonly sourceBytes: number;
  readonly outputBytes: number;
  /** Encoder note kept for the record: which WebP mode won, and by how much. */
  readonly note?: string;
}

export interface MediaManifest {
  readonly generatedAt: string;
  readonly entries: Readonly<Record<string, MediaEntry>>;
}

function ffmpeg(args: readonly string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function probeSize(file: string): { width: number; height: number } {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0:s=x',
      file,
    ],
    { encoding: 'utf8' },
  ).trim();

  const [w, h] = out.split('x');
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`could not read dimensions of ${file}: ${out}`);
  }
  return { width, height };
}

function bytes(file: string): number {
  return statSync(file).size;
}

/**
 * A scale filter that never enlarges and always lands on even dimensions.
 * yuv420p subsamples chroma by two, so an odd width is an encoder error rather
 * than a rounding detail.
 */
function scaleFilter(width: number, max: number, even: boolean): string {
  const target = width > max ? String(max) : 'iw';
  // -2 tells ffmpeg to derive the other axis from the aspect ratio and round it
  // to a multiple of two; the width is truncated the same way by hand.
  return even
    ? `scale=trunc(min(${target}\\,iw)/2)*2:-2:flags=lanczos`
    : `scale=min(${target}\\,iw):-1:flags=lanczos`;
}

function convertImage(source: string, slug: string): MediaEntry {
  const src = join(sourceDir, source);
  const { width } = probeSize(src);
  const filter = scaleFilter(width, MAX_IMAGE_WIDTH, false);

  const lossy = join(outDir, `${slug}.lossy.webp`);
  const lossless = join(outDir, `${slug}.lossless.webp`);
  const final = join(outDir, `${slug}.webp`);

  ffmpeg(['-i', src, '-vf', filter, '-c:v', 'libwebp', '-lossless', '0', '-quality', '86',
    '-compression_level', '6', '-frames:v', '1', lossy]);
  ffmpeg(['-i', src, '-vf', filter, '-c:v', 'libwebp', '-lossless', '1',
    '-compression_level', '6', '-frames:v', '1', lossless]);

  const lossyBytes = bytes(lossy);
  const losslessBytes = bytes(lossless);

  // Lossless wins ties and near-ties. These are screenshots of text; paying a
  // fifteen percent size premium to keep one-pixel glyphs crisp is worth it,
  // and beyond that the lossy encode is the honest choice.
  const keepLossless = losslessBytes <= lossyBytes * 1.15;
  rmSync(keepLossless ? lossy : lossless);
  rmSync(final, { force: true });
  renameSync(keepLossless ? lossless : lossy, final);

  const out = probeSize(final);
  return {
    kind: 'image',
    source,
    width: out.width,
    height: out.height,
    sourceBytes: bytes(src),
    outputBytes: bytes(final),
    note: `${keepLossless ? 'lossless' : 'lossy q86'} webp (lossless ${losslessBytes}B vs lossy ${lossyBytes}B)`,
  };
}

function convertVideo(source: string, slug: string): MediaEntry {
  const src = join(sourceDir, source);
  const { width } = probeSize(src);
  const filter = scaleFilter(width, MAX_VIDEO_WIDTH, true);

  const mp4 = join(outDir, `${slug}.mp4`);
  const webm = join(outDir, `${slug}.webm`);
  const poster = join(outDir, `${slug}.webp`);

  // -tune animation: these are screen recordings of flat-shaded pixel art, and
  // the default psy-rd settings spend bits on film grain that is not there.
  //
  // CRF 30 / 42 rather than the usual 23 / 32. Checked frame-against-frame at
  // 24, 30 and 32 on the busiest clip and the three are indistinguishable —
  // large flat colour fields with hard edges is the easiest thing either codec
  // will ever be handed, and the default quality targets are calibrated for
  // camera footage. Going quieter here is most of the difference between a
  // six-megabyte page and a two-megabyte one.
  ffmpeg(['-i', src, '-vf', filter, '-c:v', 'libx264', '-crf', '30', '-preset', 'slow',
    '-tune', 'animation', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4]);

  ffmpeg(['-i', src, '-vf', filter, '-c:v', 'libvpx-vp9', '-crf', '42', '-b:v', '0',
    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-an', webm]);

  // Frame one, not a frame from the middle: several of these clips start on the
  // state the surrounding prose is describing. This is the only part of a video
  // that a reader with JavaScript disabled ever sees, so it is not throwaway.
  //
  // Quality 50, not 80. Fifteen posters are the one thing on this page the
  // browser fetches eagerly — `poster` has no lazy equivalent — so they were
  // 363 KB of a 392 KB cold load, all of it for clips five to forty-seven
  // thousand pixels down. The reference for "good enough" is not the source
  // GIF, it is the CRF-30 H.264 frame the reader sees a moment after pressing
  // play: measured against that frame at the width the figure actually renders,
  // q80 scores SSIM 0.984 and q50 scores 0.972, and side by side at 1:1 the q50
  // poster is indistinguishable from the q80 one while both are visibly cleaner
  // than the video. It buys 29 percent of the payload for a still that was
  // never the limiting factor.
  //
  // The width is deliberately not touched. Encoding these at the 864px the
  // figure renders at would save twice as much and cost SSIM 0.92 on the busy
  // clips, and it would hand a reader with JavaScript off a 1x image on a 2x
  // screen — that one is a degraded document rather than a quieter one.
  ffmpeg(['-i', src, '-vf', filter, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '0',
    '-quality', '50', '-compression_level', '6', poster]);

  const out = probeSize(mp4);
  return {
    kind: 'video',
    source,
    width: out.width,
    height: out.height,
    sourceBytes: bytes(src),
    outputBytes: bytes(mp4) + bytes(webm) + bytes(poster),
    note: `mp4 ${bytes(mp4)}B + webm ${bytes(webm)}B + poster ${bytes(poster)}B`,
  };
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(0)} KB`;
}

function main(): void {
  if (!existsSync(sourceDir)) {
    throw new Error(
      `the Notion export is not at ${sourceDir}. It lives outside this repo; ` +
        `clone or copy it alongside the site directory before running this.`,
    );
  }

  mkdirSync(outDir, { recursive: true });

  // Anything left from a previous run under a slug that has since been renamed
  // would otherwise sit in the repo forever, shipped and unreferenced.
  for (const stale of readdirSync(outDir)) rmSync(join(outDir, stale), { force: true });

  const entries: Record<string, MediaEntry> = {};
  let sourceTotal = 0;
  let outputTotal = 0;

  for (const [source, slug] of Object.entries(SLUGS)) {
    if (!existsSync(join(sourceDir, source))) {
      throw new Error(`${source} is named in SLUGS but is not in the export`);
    }

    const ext = extensionOf(source);
    const entry = ext === 'gif' ? convertVideo(source, slug) : convertImage(source, slug);

    entries[slug] = entry;
    sourceTotal += entry.sourceBytes;
    outputTotal += entry.outputBytes;

    const delta = ((1 - entry.outputBytes / entry.sourceBytes) * 100).toFixed(0);
    process.stdout.write(
      `${slug.padEnd(38)} ${kb(entry.sourceBytes).padStart(9)} -> ${kb(entry.outputBytes).padStart(9)}  (-${delta}%)\n`,
    );
  }

  const manifest: MediaManifest = { generatedAt: new Date().toISOString(), entries };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `\n${Object.keys(entries).length} files: ${kb(sourceTotal)} -> ${kb(outputTotal)} ` +
      `(-${((1 - outputTotal / sourceTotal) * 100).toFixed(1)}%)\n`,
  );
}

main();
