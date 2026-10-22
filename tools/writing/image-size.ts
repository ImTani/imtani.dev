/**
 * The pixel size of an image, read from its own header.
 *
 * The build needs every local figure's intrinsic width and height — for the
 * `width`/`height` attributes that reserve its box, and for `figureWidth` in
 * embeds.ts — and it used to get them from a manifest that `media.ts` wrote by
 * running ffprobe. A manifest is a second copy of a fact the file already
 * states, and a second copy is something to forget to update. CI has no
 * ffprobe, so the answer is to read the header: a few dozen bytes of each
 * format, no dependency.
 *
 * A clip's size is its poster's: `media.ts` cuts the poster from the same
 * scale filter as the video, so the two are the same pixels by construction.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

function png(b: Buffer): Size | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b: Buffer): Size | null {
  if (b.length < 10 || !/^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webp(b: Buffer): Size | null {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: a keyframe header, then 14-bit width and height after the start code.
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: a signature byte, then 14 bits of width-1 and 14 of height-1.
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit canvas width-1 and height-1.
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function jpeg(b: Buffer): Size | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1] as number;
    // Start-of-frame markers carry the size; C4, C8 and CC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: b.readUInt16BE(p + 7), height: b.readUInt16BE(p + 5) };
    }
    p += 2 + b.readUInt16BE(p + 2);
  }
  return null;
}

/** Throws rather than guessing: an unsized figure is a page that shifts. */
export function imageSize(bytes: Buffer, name: string): Size {
  const size = png(bytes) ?? webp(bytes) ?? gif(bytes) ?? jpeg(bytes);
  if (!size || !(size.width > 0) || !(size.height > 0)) {
    throw new Error(`could not read the pixel size of ${name}; it is not a PNG, WebP, GIF or JPEG this can parse`);
  }
  return size;
}
