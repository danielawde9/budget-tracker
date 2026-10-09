import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n.tsx';
import { PageMetadata } from './page-metadata.tsx';

afterEach(cleanup);

it('gives every private route a useful title while excluding financial screens from indexing', () => {
  for (const page of ['home', 'plan', 'activity', 'accounts', 'settings', 'onboarding', 'invite'] as const) {
    const view = render(<I18nProvider locale="en"><PageMetadata page={page} /></I18nProvider>);
    expect(document.title).toMatch(/.+ · Open Budget Tracker/);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).not.toContain('#');
    view.unmount();
  }
});

it('restores public metadata after signing out and localizes the Arabic entry page', () => {
  const view = render(<I18nProvider locale="en"><PageMetadata page="settings" /></I18nProvider>);
  view.rerender(<I18nProvider locale="ar"><PageMetadata page="public" /></I18nProvider>);
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
  expect(document.title).toContain('تتبّع');
  expect(document.querySelector('meta[property="og:locale"]')).toHaveAttribute('content', 'ar_LB');
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('الميزانية');
});
