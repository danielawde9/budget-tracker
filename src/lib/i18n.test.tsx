import { render, screen } from '@testing-library/react';
import { I18nProvider, messages, useI18n } from './i18n.tsx';

function Probe() {
  const { t, dir, money, date } = useI18n();
  return (
    <p dir={dir}>
      {t('nav.home')}|{t('error.BUDGET_INSUFFICIENT_READY')}|{money(20550n, 'USD')}|{date('2026-10-03')}|{t('plan.flexGets', { name: 'Other', amount: '$16.00' })}
    </p>
  );
}

describe('i18n', () => {
  it('ships every message in English and Arabic', () => {
    for (const [key, value] of Object.entries(messages)) {
      expect(value.en.trim(), key).not.toBe('');
      expect(value.ar.trim(), key).not.toBe('');
    }
  });

  it('renders English left to right', () => {
    render(<I18nProvider locale="en"><Probe /></I18nProvider>);
    expect(screen.getByText(/Home\|/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/Home\|/).textContent).toContain('$205.50');
    expect(screen.getByText(/Home\|/).textContent).toContain('Oct 3, 2026');
    expect(screen.getByText(/Home\|/).textContent).toContain('Other gets $16.00');
  });

  it('renders Arabic right to left with Arabic digits', () => {
    render(<I18nProvider locale="ar"><Probe /></I18nProvider>);
    const text = screen.getByText(/الرئيسية/);
    expect(text).toHaveAttribute('dir', 'rtl');
    expect(text.textContent).toContain('٢٠٥٫٥٠');
  });
});
