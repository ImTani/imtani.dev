/**
 * Transcode original media into an article's media/ folder. Run by hand,
 * output committed.
 *
 *     npm run writing:media -- <originals-dir> <slug> [--only name,name]
 *     npm run devlog:media     (the devlog: ../rise-and-shine-devlog -> rise-and-shine)
 *
 * The originals stay where they are — for the devlog, the Notion export in the
 * private repository, kept as the archive — and `<originals-dir>/media-map.json`
 * says which file becomes which published name:
 *
 *     { "Untitled 3.png": "godot-visual-shader-editor",
 *       "Recording_2024-06-24_at_03.27.19.gif": "jittery-camera" }
 *
 * A still becomes `media/<name>.webp`; a GIF becomes a clip — `<name>.mp4`,
 * `<name>.webm` and a `<name>.webp` poster — and the article references the
 * `.mp4`. `--only` re-cuts just the names given, which is the normal way to
 * use it: the files already published are served `immutable` (see
 * tools/writing/headers.ts), so a re-encode has to go out under a NEW name, and
 * re-running the whole map would rewrite bytes nobody asked to change.
 * Nothing is deleted; the build fails on any file in media/ the article does
 * not use, which is what catches a leftover.
 *
 * This is deliberately *not* part of `npm run build`. It shells out to ffmpeg
 * for fifty-odd encodes and takes minutes; making every build pay that — and
 * requiring ffmpeg on every machine and in CI — to reproduce bytes that never
 * change would be the wrong trade. The build reads the committed files, and
 * their sizes off their own headers, and never runs ffmpeg.
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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRAFTS_DIR, MEDIA_DIR, PUBLISHED_DIR } from './config.ts';
import { encodeWidth, extensionOf } from './embeds.ts';

/** Set by `main`: where the originals are read from and the outputs written. */
let sourceDir = '';
let outDir = '';

/**
 * The transcode width is no longer a flat cap.
 *
 * It was `min(native, 1440)` for images and `min(native, 1280)` for video, which
 * is a size budget rather than an answer to the question the page actually asks:
 * how wide does this figure RENDER, and does the browser have to resample it to
 * get there? A capture a little wider than the column took a shallow non-integer
 * downscale — all the softening of a resample and none of the size change — and
 * seven of the forty figures were in that band at the current column.
 *
 * `encodeWidth` in embeds.ts answers it from the figure's own render width, so
 * every picture now lands on exactly 1:1, exactly 0.5, or a downscale between
 * 0.50 and 0.79 that is deep enough to be worth its own softness. Nothing is
 * enlarged and nothing is guessed at here.
 */

/** What one transcode did, for the log. */
interface MediaEntry {
  readonly kind: 'image' | 'video';
  readonly source: string;
  readonly width: number;
  readonly height: number;
  readonly sourceBytes: number;
  readonly outputBytes: number;
  /** Encoder note: which WebP mode won, and by how much. */
  readonly note?: string;
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
  const { width, height } = probeSize(src);
  const filter = scaleFilter(width, encodeWidth(width, height, false), false);

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
  const { width, height } = probeSize(src);
  const filter = scaleFilter(width, encodeWidth(width, height, true), true);

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

  // THE WEBM MUXER IS NOT REPRODUCIBLE, and that matters here more than it
  // usually would. It writes a random 8-byte SegmentUID into the header, twice,
  // so re-running this script rewrites sixteen bytes of every clip whose video
  // data is identical — same size, same frames, different file. Under
  // the generated `_headers` these names are served `immutable` for a year, so
  // committing those sixteen bytes would burn the cache of every returning
  // reader for nothing. After any run, `git checkout` the .webm files whose
  // slugs did not change; the mp4s and the WebPs are deterministic and need no
  // such care. `-fflags +bitexact` fixes it properly by zeroing the UID, and is
  // the right thing to add the next time the clips are re-cut for a real
  // reason — it cannot be added on its own, because doing so would itself
  // change every clip's bytes under its existing name.
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
  // The width is deliberately not reduced further. The poster shares the clip's
  // own transcode width, which is now `encodeWidth`'s answer rather than a flat
  // cap; encoding it instead at the width the figure renders would save twice as
  // much, cost SSIM 0.92 on the busy clips, and hand a reader with JavaScript
  // off a 1x image on a 2x screen — a degraded document rather than a quieter
  // one.
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

function main(argv: readonly string[]): void {
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt === -1 ? null : new Set((argv[onlyAt + 1] ?? '').split(',').filter(Boolean));
  const [originals, slug] = argv.filter((arg, i) => !arg.startsWith('--') && i !== onlyAt + 1);
  if (!originals || !slug) {
    throw new Error('usage: node tools/writing/media.ts <originals-dir> <slug> [--only name,name]');
  }

  sourceDir = resolve(originals);
  const mapPath = join(sourceDir, 'media-map.json');
  if (!existsSync(mapPath)) {
    throw new Error(`no ${mapPath}: a JSON object from original file name to published name`);
  }
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>;

  const articleDir = [join(PUBLISHED_DIR, slug), join(DRAFTS_DIR, slug)].find((d) => existsSync(d));
  if (!articleDir) throw new Error(`no article folder "${slug}" in ${PUBLISHED_DIR} or ${DRAFTS_DIR}`);
  outDir = join(articleDir, MEDIA_DIR);
  mkdirSync(outDir, { recursive: true });

  let sourceTotal = 0;
  let outputTotal = 0;
  let count = 0;

  for (const [source, name] of Object.entries(map)) {
    if (only && !only.has(name)) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`"${name}" is not a usable file name: lower-case letters, digits and hyphens`);
    }
    if (!existsSync(join(sourceDir, source))) {
      throw new Error(`${source} is named in media-map.json but is not in ${sourceDir}`);
    }

    const ext = extensionOf(source);
    const entry = ext === 'gif' ? convertVideo(source, name) : convertImage(source, name);

    count += 1;
    sourceTotal += entry.sourceBytes;
    outputTotal += entry.outputBytes;

    const delta = ((1 - entry.outputBytes / entry.sourceBytes) * 100).toFixed(0);
    process.stdout.write(
      `${name.padEnd(38)} ${kb(entry.sourceBytes).padStart(9)} -> ${kb(entry.outputBytes).padStart(9)}  (-${delta}%)` +
        `  ${entry.width}x${entry.height}${entry.note ? `  ${entry.note}` : ''}\n`,
    );
  }

  if (only) {
    for (const name of only) {
      if (!Object.values(map).includes(name)) throw new Error(`--only ${name}: not a name in media-map.json`);
    }
  }

  process.stdout.write(
    `\n${count} files into ${outDir}: ${kb(sourceTotal)} -> ${kb(outputTotal)}` +
      (sourceTotal ? ` (-${((1 - outputTotal / sourceTotal) * 100).toFixed(1)}%)` : '') +
      '\nReference stills as media/<name>.webp and clips as media/<name>.mp4.\n',
  );
}

// `import.meta.url === 'file://' + argv[1]` is one slash out on Windows, so
// the comparison is made on real paths rather than on URL spelling.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
