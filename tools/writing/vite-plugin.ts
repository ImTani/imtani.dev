/**
 * The writing pipeline's half of Vite.
 *
 *   build   each published article's writing/<slug>.html is a build input
 *           (`articleInputs`), its media/ folder is copied to
 *           dist/writing/<slug>/, and sitemap.xml and _headers (immutable
 *           caching for each article's media) are written from the same list.
 *           Drafts are never read: `vite build` is production.
 *   serve   /writing/<slug>/<file> is served straight out of the article's
 *           media/ folder — published or draft — and sitemap.xml is generated
 *           per request (published only). Editing an article, its media or
 *           anything in tools/writing rebuilds the pages, drafts included, and
 *           reloads the browser.
 *
 * Media is served from where it lives rather than copied into public/: a copy
 * would be a second place for a draft's files to be left behind, and public/
 * is what `vite build` ships.
 */

import { spawn } from 'node:child_process';
import { cpSync, createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { Logger, Plugin } from 'vite';

import { type Article, discover, publishedArticles } from './articles.ts';
import { DRAFTS_DIR, MEDIA_DIR, OUT_DIR, PUBLISHED_DIR, SITE_ROOT, URL_PREFIX } from './config.ts';
import { renderHeaders } from './headers.ts';
import { renderSitemap } from './sitemap.ts';

const TOOLS_DIR = resolve(SITE_ROOT, 'tools/writing');

const TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm',
};

/** Rollup inputs: one per published article, named by slug. */
export function articleInputs(): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const article of publishedArticles()) {
    const page = join(OUT_DIR, `${article.slug}.html`);
    if (!existsSync(page)) {
      throw new Error(`writing/${article.slug}.html is missing; run \`npm run writing\` before \`vite build\``);
    }
    inputs[`writing-${article.slug}`] = page;
  }
  return inputs;
}

/**
 * Vite cannot resolve the band plates' `url()` in an article's inline <style>
 * at build time — they are served from media/, not public/ — and says so, once
 * per URL, while leaving them exactly as written, which is what they should be.
 * This drops those warnings for article media and nothing else.
 */
export function quietArticleMedia(logger: Logger): Logger {
  // Vite starts the message with a newline.
  const known = new RegExp(`^\\s*${URL_PREFIX}/[a-z0-9-]+/[^\\s/]+ referenced in .* didn't resolve at build time`);
  const filtered: Logger = {
    ...logger,
    warn: (msg, options) => (known.test(msg) ? undefined : logger.warn(msg, options)),
    warnOnce: (msg, options) => (known.test(msg) ? undefined : logger.warnOnce(msg, options)),
  };
  return filtered;
}

function mediaFile(articles: readonly Article[], url: string): string | null {
  const m = new RegExp(`^${URL_PREFIX}/([a-z0-9-]+)/([^/?#]+)`).exec(url);
  if (!m) return null;
  const article = articles.find((a) => a.slug === m[1]);
  if (!article) return null;
  const file = decodeURIComponent(m[2] as string);
  if (file.includes('/') || file.includes('\\') || file.startsWith('.')) return null;
  const path = join(article.dir, MEDIA_DIR, file);
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

export function writing(): Plugin {
  let outDir = 'dist';

  return {
    name: 'imtani:writing',

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },

    configureServer(server) {
      const current = () => discover({ drafts: true }).articles;

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/sitemap.xml') {
          res.setHeader('content-type', 'application/xml; charset=utf-8');
          res.end(renderSitemap(publishedArticles()));
          return;
        }
        const path = url.startsWith(`${URL_PREFIX}/`) ? mediaFile(current(), url) : null;
        if (!path) return next();
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('content-length', String(statSync(path).size));
        res.setHeader('cache-control', 'no-store');
        createReadStream(path).pipe(res);
      });

      // Rebuild on any change to an article, its media, or the shared tools.
      const roots = [PUBLISHED_DIR, DRAFTS_DIR, TOOLS_DIR].filter((dir) => existsSync(dir));
      server.watcher.add(roots);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let running = false;
      let again = false;
      const rebuild = () => {
        if (running) {
          again = true;
          return;
        }
        running = true;
        const child = spawn(process.execPath, [join(TOOLS_DIR, 'build.ts'), '--drafts'], {
          cwd: SITE_ROOT,
          stdio: 'inherit',
        });
        child.on('close', (code) => {
          running = false;
          if (code === 0) server.ws.send({ type: 'full-reload' });
          else server.config.logger.error('writing: rebuild failed; the page shows the last good build');
          if (again) {
            again = false;
            rebuild();
          }
        });
      };
      const onChange = (file: string) => {
        if (!roots.some((root) => file === root || file.startsWith(root + sep))) return;
        clearTimeout(timer);
        timer = setTimeout(rebuild, 150);
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },

    generateBundle() {
      const published = publishedArticles();
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap(published) });
      this.emitFile({ type: 'asset', fileName: '_headers', source: renderHeaders(published) });
    },

    writeBundle() {
      // Copied after Rollup has written, beside the pages it wrote. Published
      // articles only, and only what is in media/ — which the build has already
      // checked is exactly what each page uses.
      for (const article of publishedArticles()) {
        const from = join(article.dir, MEDIA_DIR);
        if (!existsSync(from)) continue;
        const to = join(outDir, URL_PREFIX.slice(1), article.slug);
        for (const name of readdirSync(from)) {
          if (!name.startsWith('.')) cpSync(join(from, name), join(to, name));
        }
      }
    },
  };
}
