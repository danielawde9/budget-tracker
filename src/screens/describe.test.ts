import { fixtures } from '../test/harness.tsx';
import { translate, type I18n } from '../lib/i18n.tsx';
import { formatMoney } from '../lib/money.ts';
import { describeEntry } from './describe.ts';

const i18n: I18n = {
  locale: 'en', dir: 'ltr',
  t: (key, vars) => translate('en', key, vars),
  money: (minor, currency, options) => formatMoney(minor, currency, 'en', options),
  date: (value) => value,
  name: (value) => value.nameEn ?? value.nameAr ?? '',
  digits: (value) => value,
};

describe('describeEntry', () => {
  it('describes a repayment by its memo with the cash that left', () => {
    const entry = fixtures.activity.entries.find((candidate) => candidate.kind === 'loan_repay');
    if (!entry) throw new Error('fixture has no repayment');
    expect(describeEntry(i18n, entry)).toMatchObject({ title: 'Car loan installment', amounts: [{ currency: 'USD', minor: -20000n }], tone: 'out' });
  });

  it('shows money repaid to me as coming in, without calling it income', () => {
    const entry = fixtures.activity.entries.find((candidate) => candidate.kind === 'loan_collect');
    if (!entry) throw new Error('fixture has no collection');
    const line = describeEntry(i18n, entry);
    expect(line.tone).toBe('in');
    expect(line.detail).toContain('Repaid to you');
  });
});
