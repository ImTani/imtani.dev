/**
 * The site's only server-side code.
 *
 * Static assets are served by the platform. The single dynamic route exists
 * because the Godot Asset Library sends no CORS headers at all — verified: a
 * GET returns no `access-control-allow-origin`, and an OPTIONS preflight
 * answers `Allow: GET, POST` with no access-control headers, so a browser
 * request fails outright. Every other live feed the site uses — npm, the
 * GitHub API, the SmoothSend uptime JSON, Aptos — allows direct fetching and
 * must not be proxied through here.
 *
 * Nothing about a visitor is logged, stored or forwarded. There is no database
 * binding and no analytics, which is what lets the site say so.
 */

interface Env {
  readonly ASSETS: Fetcher;
}

/** The Asset Library returns nothing without a version. Not optional. */
const GODOT_API = 'https://godotengine.org/asset-library/api/asset';
const GODOT_USER = 'infiniTani';
const GODOT_VERSION = '4.3';

const CACHE_SECONDS = 1_800;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      ...extra,
    },
  });
}

async function godotAssets(): Promise<Response> {
  const url = `${GODOT_API}?user=${encodeURIComponent(GODOT_USER)}&godot_version=${GODOT_VERSION}`;

  const upstream = await fetch(url, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });

  if (!upstream.ok) {
    // Fail loudly rather than returning an empty list. A zero-asset response
    // is indistinguishable from a real one, and the site would quietly claim
    // he has published nothing.
    return json({ error: 'upstream', status: upstream.status }, 502, {
      'cache-control': 'no-store',
    });
  }

  const data = (await upstream.json()) as { result?: unknown[] };
  const assets = Array.isArray(data.result) ? data.result : [];
  return json({ assets, fetchedAt: new Date().toISOString() });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/godot') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method not allowed' }, 405, { allow: 'GET, HEAD' });
      }
      try {
        return await godotAssets();
      } catch (cause) {
        return json({ error: 'fetch failed', detail: String(cause) }, 502, {
          'cache-control': 'no-store',
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
