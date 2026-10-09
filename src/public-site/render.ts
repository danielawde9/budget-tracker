import type { Locale } from '../lib/money.ts';
import { articles } from './content.ts';
import { BRAND_MARK_URL, BRAND_NAME, GITHUB_URL, PUBLIC_PAGE_IDS, SITE_URL, publicLabels, publicPath, type PublicPage } from './site.ts';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function renderPublicPage(page: PublicPage, locale: Locale, stylesheets: readonly string[]): string {
  const article = articles[page][locale];
  const url = new URL(publicPath(page, locale), SITE_URL).href;
  const title = `${article.title} · ${BRAND_NAME}`;
  const text = (en: string, ar: string) => locale === 'ar' ? ar : en;
  const navigation = PUBLIC_PAGE_IDS.map(id => `<a href="${publicPath(id, locale)}"${id === page ? ' aria-current="page"' : ''}>${escape(publicLabels[id][locale])}</a>`).join('\n');
  const alternates = (['en', 'ar'] as const).map(language => `<link rel="alternate" hreflang="${language}" href="${new URL(publicPath(page, language), SITE_URL).href}">`).join('\n');
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org', '@type': page === 'about' ? 'AboutPage' : 'WebPage',
    '@id': `${url}#page`, url, name: article.title, description: article.description, inLanguage: locale,
    isPartOf: { '@type': 'WebSite', '@id': `${SITE_URL}#website`, name: BRAND_NAME, url: SITE_URL },
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#f4f6f5">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(article.description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${new URL(publicPath(page, 'en'), SITE_URL).href}">
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
  <link rel="icon" type="image/png" href="/icons/favicon-32.png" sizes="32x32">
  <link rel="icon" type="image/png" href="/icons/favicon-16.png" sizes="16x16">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  ${stylesheets.map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('\n')}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${BRAND_NAME}">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(article.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:locale" content="${locale === 'ar' ? 'ar_LB' : 'en_US'}">
  <meta property="og:locale:alternate" content="${locale === 'ar' ? 'en_US' : 'ar_LB'}">
  <meta property="og:image" content="${SITE_URL}icons/icon-512.png">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta property="og:image:alt" content="${text('Open Budget Tracker logo', 'شعار Open Budget Tracker')}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(article.description)}">
  <meta name="twitter:image" content="${SITE_URL}icons/icon-512.png">
  <meta name="twitter:image:alt" content="${text('Open Budget Tracker logo', 'شعار Open Budget Tracker')}">
  <script type="application/ld+json">${structuredData}</script>
</head>
<body class="cr-public">
  <a class="cr-public-skip" href="#content">${text('Skip to content', 'انتقل إلى المحتوى')}</a>
  <div class="cr-public-frame">
    <header class="cr-public-header">
      <a class="auth-brand" href="/"><img class="cr-brand-mark" src="${BRAND_MARK_URL}" width="40" height="40" alt=""><bdi class="cr-brand-name" dir="ltr">${BRAND_NAME}</bdi></a>
      <div class="cr-public-nav"><a href="/">${text('Open your budget', 'افتح ميزانيتك')}</a><a href="${publicPath(page, locale === 'ar' ? 'en' : 'ar')}" lang="${locale === 'ar' ? 'en' : 'ar'}" dir="${locale === 'ar' ? 'ltr' : 'rtl'}">${text('العربية', 'English')}</a></div>
    </header>
    <nav class="cr-public-nav" aria-label="${text('Public pages', 'صفحات التطبيق')}">${navigation}</nav>
    <main id="content" tabindex="-1">
      <article>
        <header class="cr-public-intro"><p class="cr-label">${text('Your money, with a plan', 'أموالك بخطة واضحة')}</p><h1>${escape(article.title)}</h1><p>${escape(article.intro)}</p></header>
        ${article.sections.map(section => `<section class="cr-card"><h2>${escape(section.heading)}</h2>${section.paragraphs.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}${section.steps ? `<ol class="cr-steps">${section.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>` : ''}${section.links ? `<div class="cr-public-nav">${section.links.map(link => `<a href="${escape(link.href)}">${escape(link.label)}</a>`).join('')}</div>` : ''}</section>`).join('\n')}
      </article>
      <section class="cr-card cr-public-cta"><h2>${text('Give your money a clear job', 'خصّص لأموالك وظيفة واضحة')}</h2><p>${text('Start with the balances you hold today, or help make the app better for everyone.', 'ابدأ بالأرصدة التي تملكها اليوم أو ساعد في تحسين التطبيق للجميع.')}</p><div class="cr-public-nav"><a class="cr-button cr-button--primary" href="${page === 'contribute' ? GITHUB_URL : '/'}">${page === 'contribute' ? text('Contribute on GitHub', 'ساهم على GitHub') : text('Open your budget', 'افتح ميزانيتك')}</a><a href="${page === 'contribute' ? '/' : publicPath('contribute', locale)}">${page === 'contribute' ? text('Open your budget', 'افتح ميزانيتك') : text('Help improve the app', 'ساعد في تحسين التطبيق')}</a></div></section>
    </main>
    <footer class="cr-public-footer"><p class="cr-helper">${text('Open source. Built for USD and LBP, in English and Arabic.', 'مفتوح المصدر. للدولار والليرة، بالعربية والإنجليزية.')}</p><div class="cr-public-nav"><a href="${GITHUB_URL}">GitHub</a><a href="${GITHUB_URL}/blob/main/LICENSE">${text('MIT license', 'ترخيص MIT')}</a></div></footer>
  </div>
</body>
</html>`;
}

export function renderSitemap(): string {
  const urls = [SITE_URL, ...PUBLIC_PAGE_IDS.flatMap(page => (['en', 'ar'] as const).map(locale => new URL(publicPath(page, locale), SITE_URL).href))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
}
