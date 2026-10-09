import { renderPublicPage, renderSitemap } from './render.ts';

const origin = 'https://openbudgetracker.app';

it('ships each public page as readable HTML with its own canonical and language alternatives', () => {
  const titles = new Set<string>();
  for (const slug of ['about', 'how-it-works', 'budgeting-usd-lbp', 'contribute'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      const path = `${locale === 'ar' ? '/ar' : ''}/${slug}`;
      const doc = new DOMParser().parseFromString(renderPublicPage(slug, locale, ['/assets/site.css']), 'text/html');
      expect(doc.documentElement.lang).toBe(locale);
      expect(doc.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(doc.querySelectorAll('h1')).toHaveLength(1);
      expect(doc.querySelectorAll('main h2').length).toBeGreaterThanOrEqual(3);
      expect(doc.querySelector('main')?.textContent?.length).toBeGreaterThan(800);
      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${origin}${path}`);
      expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${origin}${path}`);
      expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow');
      expect(doc.querySelector('link[hreflang="en"]')?.getAttribute('href')).toBe(`${origin}/${slug}`);
      expect(doc.querySelector('link[hreflang="ar"]')?.getAttribute('href')).toBe(`${origin}/ar/${slug}`);
      expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/assets/site.css');
      expect(doc.querySelector('script[src]')).toBeNull();
      const structuredData = JSON.parse(doc.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}');
      expect(structuredData.url).toBe(`${origin}${path}`);
      expect(structuredData.inLanguage).toBe(locale);
      titles.add(doc.title);
    }
  }
  expect(titles.size).toBe(8);
});

it('lets visitors find every page, switch to the same article in Arabic, and contribute on GitHub', () => {
  const doc = new DOMParser().parseFromString(renderPublicPage('contribute', 'en', []), 'text/html');
  const links = [...doc.querySelectorAll('a')].map(link => link.getAttribute('href'));
  expect(links).toEqual(expect.arrayContaining([
    '/', '/about', '/how-it-works', '/budgeting-usd-lbp', '/contribute', '/ar/contribute',
    'https://github.com/danielawde9/budget-tracker',
    'https://github.com/danielawde9/budget-tracker/issues',
    'https://github.com/danielawde9/budget-tracker/blob/main/CONTRIBUTING.md',
  ]));
  expect(doc.querySelector('nav a[aria-current="page"]')?.getAttribute('href')).toBe('/contribute');
});

it('includes the homepage and all eight public language URLs in the sitemap, without private hash routes', () => {
  const doc = new DOMParser().parseFromString(renderSitemap(), 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  const urls = [...doc.getElementsByTagName('loc')].map(loc => loc.textContent);
  expect(urls).toHaveLength(9);
  expect(urls).toEqual(expect.arrayContaining([
    `${origin}/`, `${origin}/about`, `${origin}/ar/about`, `${origin}/how-it-works`,
    `${origin}/ar/how-it-works`, `${origin}/budgeting-usd-lbp`, `${origin}/ar/budgeting-usd-lbp`,
    `${origin}/contribute`, `${origin}/ar/contribute`,
  ]));
  expect(urls.every(url => !url?.includes('#'))).toBe(true);
});
