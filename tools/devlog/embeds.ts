/**
 * The Rise&Shine devlog's embedded media, named.
 *
 * The Notion export calls twenty-two of its images `Untitled 7.png` and the
 * rest things like `1be2c78e-b495-4ebe-a4c6-29228a590eff.png`. None of that may
 * reach a URL, so every file gets a hand-written slug here. This table is the
 * single point of agreement between `media.ts`, which transcodes the files, and
 * `build.ts`, which writes the `<img>` and `<video>` tags — if a slug only
 * existed in one of them the page would 404 its own pictures.
 *
 * `build.ts` fails the build on any embed missing from `SLUGS`, so adding an
 * image to the export without naming it here is a loud error rather than a
 * broken link.
 */

/** The export directory, as a path relative to the site root. */
export const SOURCE_DIR_REL = '../rise-and-shine-devlog';

export const SOURCE_MARKDOWN = 'Rise&Shine Devlog 5aed9b9b966a49abaf401e560ceccd6a.md';

/** Where transcoded media lands. Under `public/`, so Vite copies it verbatim. */
export const OUT_DIR_REL = 'public/writing/rise-and-shine';

/** The public path the page references its media by. */
export const PUBLIC_BASE = '/writing/rise-and-shine';

/** Written by `media.ts`, read by `build.ts`. Committed. */
export const MEDIA_MANIFEST_REL = 'tools/devlog/media.json';

/** Source filename in the export -> published slug. Document order. */
export const SLUGS: Readonly<Record<string, string>> = {
  // Day 1
  'Untitled.png': 'kenney-pixel-platformer-pack',
  'Untitled 1.png': 'smooth-interpolation-from-data-points',
  'Recording_2024-06-24_at_03.27.19.gif': 'jittery-camera',
  'Recording_2024-06-24_at_03.31.14.gif': 'smoother-camera',
  'Recording_2024-06-24_at_05.56.20.gif': 'placing-tiles-by-hand',
  'Recording_2024-06-24_at_06.07.49.gif': 'auto-tiling',
  'Recording_2024-06-24_at_05.46.16.gif': 'parallax-background',
  // Day 2
  'Untitled 2.png': 'a-very-stationary-cloud',
  'Untitled 3.png': 'godot-visual-shader-editor',
  'Untitled 4.png': 'multiplying-time-by-wave-speed',
  'Recording_2024-06-24_at_14.35.12.gif': 'working-sin-function',
  '2efcf48a-2a08-4732-a6a7-1f45c3c76a65.png': 'vertex-node',
  'ccb28002-6882-4a34-a9e0-81023c9333c3.png': 'cartesian-plane',
  'Untitled 5.png': 'making-a-new-vector2',
  'Recording_2024-06-30_at_06.06.45.gif': 'slightly-not-stationary-cloud',
  'Untitled 6.png': 'wave-intensity-parameter',
  'Recording_2024-06-30_at_06.16.47.gif': 'cloud-having-violent-seizures',
  'Recording_2024-06-30_at_06.25.24.gif': 'cloud-waving-gently',
  // Day 3
  '54f20446-f1ca-4d75-b92c-6af65b17d6d2.png': 'inheritance-and-composition',
  'Untitled 7.png': 'inheritance-car-and-motorcycle',
  '1be2c78e-b495-4ebe-a4c6-29228a590eff.png': 'composition-book-and-pages',
  'Untitled 8.png': 'entity-component-system',
  'Untitled 9.png': 'player-with-components',
  'Untitled 10.png': 'player-script',
  'Recording_2024-07-03_at_08.51.27.gif': 'modular-player-moving',
  'Untitled 11.png': 'mind-map-for-items',
  'Untitled 12.png': 'item-scene-hierarchy',
  'Untitled 13.png': 'key-scene',
  // Day 4
  'Recording_2024-07-03_at_10.21.13.gif': 'checkpoint-animation',
  'Untitled 14.png': 'spikes-scene',
  'Recording_2024-07-03_at_10.34.07.gif': 'spikes-working-perfectly',
  'Recording_2024-07-03_at_10.50.12.gif': 'holding-throwing-hurt-respawn',
  // Day 9
  'Recording_2024-07-03_at_23.24.27.gif': 'newer-look-different-feel',
  'Untitled 15.png': 'neuron-activation',
  'Untitled 16.png': 'door-scene',
  'covefr.png': 'rise-and-shine-cover',
  // Day 10
  'Recording_2024-07-04_at_00.46.54.gif': 'lovely-blue-flame',
};

/**
 * Alt text the export did not supply, written from the surrounding prose.
 *
 * Notion writes the filename into the alt slot when a block has no caption, so
 * `Recording 2024-07-03 at 10.21.13.gif` is what a screen reader would
 * otherwise be told this clip contains.
 */
export const ALT_OVERRIDES: Readonly<Record<string, string>> = {
  'Recording_2024-07-03_at_10.21.13.gif':
    'The player walks into the checkpoint flag and it raises; a pink test hazard sits nearby and the key and diamond bob up and down on the wave shader.',
};

/** Alt text that reads better than what the export put in the alt slot. */
export const ALT_REWRITES: Readonly<Record<string, string>> = {
  // The export's alt is an aside about the GIF refusing to centre in Notion,
  // which tells a screen-reader user nothing about the picture.
  'sine-cosine-animation1.gif':
    'A point travelling around a circle, with its height traced out beside it as a sine wave.',
};

export function isRemote(src: string): boolean {
  return /^https?:\/\//.test(src);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
