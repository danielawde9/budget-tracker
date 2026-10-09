import type { Plugin } from 'vite';
import { renderPublicPage, renderSitemap } from '../src/public-site/render.ts';
import { PUBLIC_PAGE_IDS, publicPath } from '../src/public-site/site.ts';

// Real HTML documents share the app's compiled stylesheet, but load no app JS.
export function publicPagesPlugin(): Plugin {
  return {
    name: 'budget-public-pages',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        let html: string | undefined;
        if (pathname === '/sitemap.xml') {
          response.setHeader('Content-Type', 'application/xml; charset=utf-8');
          response.end(renderSitemap());
          return;
        }
        for (const page of PUBLIC_PAGE_IDS) {
          for (const locale of ['en', 'ar'] as const) {
            const path = publicPath(page, locale);
            if (pathname === `${path}/` || pathname === `${path}.html`) {
              response.statusCode = 301;
              response.setHeader('Location', path);
              response.end();
              return;
            }
            if (pathname === path) html = renderPublicPage(page, locale, ['/src/styles.css', '/src/control-room.css']);
          }
        }
        if (html === undefined) return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      });
    },
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') this.error('The app HTML is required to build public pages.');
      const stylesheets = [...String(index.source).matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[1]!);
      if (stylesheets.length === 0) this.error('The app stylesheet is required to style public pages.');
      for (const page of PUBLIC_PAGE_IDS) {
        for (const locale of ['en', 'ar'] as const) {
          this.emitFile({ type: 'asset', fileName: `${publicPath(page, locale).slice(1)}.html`, source: renderPublicPage(page, locale, stylesheets) });
        }
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap() });
    },
  };
}
