import { useState, type FormEvent } from 'react';
import type { BudgetApi } from '../../api/budget-api.ts';
import { activeWallets, pickerGroups, useWorkspace, WorkspaceProvider, type Catalog } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import { parseMoney, type Currency } from '../../lib/money.ts';
import { WalletForm } from '../../record/forms-accounts.tsx';
import { Explain } from '../../record/fields.tsx';
import { ErrorNotice, LoadState, useCommand, useLoad } from '../../ui/async.tsx';
import { Amount, MoneyField } from '../../ui/money.tsx';
import { PlanEditorForm } from '../plan/plan-editor.tsx';
import { setupCopy } from './setup-copy.ts';
import './onboarding-redesign.css';

type Step = 'space' | 'plan' | 'money' | 'assign';
const STEPS: readonly { readonly step: Step; readonly label: MessageKey }[] = [
  { step: 'space', label: 'onboarding.step.space' },
  { step: 'plan', label: 'onboarding.step.plan' },
  { step: 'money', label: 'onboarding.step.money' },
  { step: 'assign', label: 'onboarding.step.assign' },
];

/**
 * First run: name the space and expected income (creates the default plan),
 * adjust the plan, add wallets with what they hold today, then optionally
 * say what that existing money is for (opening balances, not income).
 */
export function Onboarding({ api, onFinished, onToggleLocale, onSignOut }: {
  readonly api: BudgetApi;
  readonly onFinished: (spaceId: string) => void;
  readonly onToggleLocale: () => void;
  readonly onSignOut: () => void;
}) {
  const { t, locale, dir } = useI18n();
  const [step, setStep] = useState<Step>('space');
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const spaces = useLoad(async () => (spaceId ? api.mySpaces() : []), [api, spaceId]);
  const space = spaceId ? spaces.data?.find((candidate) => candidate.id === spaceId) ?? null : null;
  return (
    <main className="cr-onboarding setup-redesign" dir={dir}>
      <header className="auth-topbar">
        <span className="auth-brand"><span className="auth-brand-mark" aria-hidden="true" />{t('app.name')}</span>
        <span className="cr-row">
          <button type="button" className="text-button" onClick={onToggleLocale}>{t('shell.language')}</button>
          <button type="button" className="text-button" onClick={onSignOut}>{t('settings.signOut')}</button>
        </span>
      </header>
      <div className="setup-layout">
      <aside className="setup-story">
        <h2>{setupCopy(locale, 'headline')}</h2>
        <p>{setupCopy(locale, 'subtitle')}</p>
        <p className="setup-tagline">{setupCopy(locale, 'tagline')}</p>
      </aside>
      <div className="setup-main">
      <ol className="cr-wizard-steps" aria-label={t('onboarding.progress')}>
        {STEPS.map((candidate, index) => {
          const current = STEPS.findIndex((entry) => entry.step === step);
          const state = index < current ? 'cr-wizard-step--done' : index === current ? 'cr-wizard-step--current' : '';
          return (
            <li key={candidate.step} className={`cr-wizard-step ${state}`} aria-current={index === current ? 'step' : undefined}>
              <span className="cr-wizard-step-dot" aria-hidden="true">{index + 1}</span>{t(candidate.label)}
            </li>
          );
        })}
      </ol>
      <section className="cr-card cr-onboarding-card">
        {step === 'space' ? (
          <SpaceStep api={api} onCreated={(id) => { setSpaceId(id); setStep('plan'); }} />
        ) : space ? (
          <WorkspaceProvider api={api} space={space} spaces={[space]} selectSpace={() => undefined}>
            <SetupSteps step={step} onStep={setStep} onFinish={() => onFinished(space.id)} />
          </WorkspaceProvider>
        ) : (
          <LoadState loaded={spaces}>{() => null}</LoadState>
        )}
      </section>
      </div>
      </div>
    </main>
  );
}

function SpaceStep({ api, onCreated }: { readonly api: BudgetApi; readonly onCreated: (spaceId: string) => void }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(t('onboarding.defaultName'));
  const [income, setIncome] = useState<bigint | null>(null);
  const command = useCommand((requestId, _: null) => api.createSpace({ requestId, name: name.trim(), expectedIncome: income ?? 0n }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || income === null) return;
    const result = await command.submit(null);
    if (result) onCreated(result.spaceId);
  }
  return (
    <form className="cr-stack" onSubmit={(event) => void submit(event)}>
      <h1>{t('onboarding.welcome')}</h1>
      <p className="cr-helper">{t('onboarding.welcomeIntro')}</p>
      <label className="cr-field">
        <span className="cr-label">{t('onboarding.spaceName')}</span>
        <input type="text" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <MoneyField label={t('plan.expectedIncome')} currency="USD" value={income} onChange={setIncome} allowZero autoFocus hint={t('onboarding.incomeHint')} />
      <Explain>{setupCopy(locale, 'currencyHint')}</Explain>
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <div className="dialog-actions">
        <button type="submit" className="cr-button cr-button--primary" disabled={command.pending || income === null || !name.trim()}>{t('common.next')}</button>
      </div>
    </form>
  );
}

function SetupSteps({ step, onStep, onFinish }: { readonly step: Step; readonly onStep: (step: Step) => void; readonly onFinish: () => void }) {
  const { t } = useI18n();
  const { catalog, space } = useWorkspace();
  return (
    <LoadState loaded={catalog}>
      {(data) => {
        if (step === 'plan') {
          return (
            <div className="cr-stack">
              <h1>{t('onboarding.planTitle')}</h1>
              <p className="cr-helper">{t('onboarding.planIntro')}</p>
              <PlanEditorForm plan={data.plan} month={space.currentMonth} onCancel={() => onStep('money')} onSaved={() => onStep('money')} cancelLabel={t('onboarding.keepDefaults')} />
            </div>
          );
        }
        if (step === 'money') return <MoneyStep catalog={data} onNext={() => onStep('assign')} onBack={() => onStep('plan')} />;
        return <AssignStep catalog={data} onFinish={onFinish} onBack={() => onStep('money')} />;
      }}
    </LoadState>
  );
}

export function MoneyStep({ catalog, onNext, onBack }: { readonly catalog: Catalog; readonly onNext: () => void; readonly onBack?: () => void }) {
  const { t, locale } = useI18n();
  const [adding, setAdding] = useState(catalog.accounts.wallets.length === 0);
  return (
    <div className="cr-stack">
      <h1>{t('onboarding.moneyTitle')}</h1>
      <p className="cr-helper">{t('onboarding.moneyIntro')}</p>
      {catalog.accounts.wallets.length > 0 ? (
        <ul className="cr-register">
          {catalog.accounts.wallets.map((wallet) => (
            <li key={wallet.id} className="cr-register-row">
              <bdi className="cr-register-title">{wallet.name}</bdi>
              <span className="cr-helper">{t(`wallet.kind.${wallet.kind}`)}</span>
              <Amount minor={wallet.balance} currency={wallet.currency} />
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <WalletForm submitLabel={setupCopy(locale, 'saveWallet')} onDone={onNext} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="cr-button" onClick={() => setAdding(true)}>{t('accounts.add')}</button>
      )}
      <div className="dialog-actions">
        {onBack ? <button type="button" className="cr-button" onClick={onBack}>{t('common.back')}</button> : null}
        {!adding ? <button type="button" className="cr-button cr-button--primary" onClick={onNext}>{t('common.next')}</button> : null}
      </div>
    </div>
  );
}

/** Opening assignment: existing money gets a purpose without counting as funding. */
export function AssignStep({ catalog, onFinish, onBack }: { readonly catalog: Catalog; readonly onFinish: () => void; readonly onBack?: () => void }) {
  const { t, money, name, locale } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const currencies = [...new Set(activeWallets(catalog.accounts, 'cash').map((wallet) => wallet.currency))];
  const [currency, setCurrency] = useState<Currency>(currencies[0] ?? 'USD');
  const [amounts, setAmounts] = useState<Record<string, bigint | null>>({});
  const [invalidAmounts, setInvalidAmounts] = useState<Record<string, boolean>>({});
  const invalid = Object.values(invalidAmounts).some(Boolean);
  const readyLoad = useLoad(() => api.overview(space.id), [api, space.id]);
  const groups = pickerGroups(catalog.plan);
  const [selectedGroup, setSelectedGroup] = useState(groups[0]?.groupId ?? '');
  const ready = readyLoad.data?.currencies.find((candidate) => candidate.currency === currency)?.ready ?? 0n;
  const total = Object.entries(amounts).filter(([key]) => key.startsWith(`${currency}:`)).reduce((sum, [, value]) => sum + (value ?? 0n), 0n);
  const hasAssignments = Object.values(amounts).some((value) => value !== null && value > 0n);
  const overAssignedCurrencies = currencies.filter((option) => {
    const available = readyLoad.data?.currencies.find((candidate) => candidate.currency === option)?.ready ?? 0n;
    const assigned = Object.entries(amounts).filter(([key]) => key.startsWith(`${option}:`)).reduce((sum, [, value]) => sum + (value ?? 0n), 0n);
    return assigned > available;
  });
  const overAssigned = overAssignedCurrencies.length > 0;
  const command = useCommand((requestId, _: null) => api.assignMoney({
    spaceId: space.id, requestId, on: space.today, opening: true,
    moves: Object.entries(amounts).filter(([, value]) => value !== null && value > 0n).map(([key, value]) => {
      const [moveCurrency, itemId] = key.split(':') as [Currency, string];
      return { from: null, to: itemId, currency: moveCurrency, amount: value ?? 0n };
    }),
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (overAssigned || invalid || readyLoad.status !== 'ready') return;
    if (hasAssignments) {
      if (!(await command.submit(null))) return;
      refresh();
    }
    onFinish();
  }
  if (currencies.length === 0 || readyLoad.status === 'ready' && readyLoad.data.currencies.every((entry) => entry.ready <= 0n) && !hasAssignments) {
    return (
      <div className="cr-stack">
        <h1>{t('onboarding.assignTitle')}</h1>
        <Explain>{t('onboarding.nothingToAssign')}</Explain>
        <div className="dialog-actions">{onBack ? <button type="button" className="cr-button" onClick={onBack}>{t('common.back')}</button> : null}<button type="button" className="cr-button cr-button--primary" onClick={onFinish}>{t('onboarding.finish')}</button></div>
      </div>
    );
  }
  return (
    <form className="cr-stack" onSubmit={(event) => void submit(event)}>
      <h1>{t('onboarding.assignTitle')}</h1>
      <p className="cr-helper">{setupCopy(locale, 'optional')}</p>
      {currencies.length > 1 ? (
        <fieldset className="cr-choice">
          <legend>{t('common.currency')}</legend>
          {currencies.map((option) => <label key={option}><input type="radio" name="assign-currency" checked={currency === option} onChange={() => setCurrency(option)} />{option}</label>)}
        </fieldset>
      ) : null}
      <LoadState loaded={readyLoad}>{() => <div className="setup-totals" aria-live="polite">
        <div><span>{setupCopy(locale, 'available')}</span><Amount minor={ready} currency={currency} /></div>
        <div><span>{setupCopy(locale, 'assigning')}</span><Amount minor={total} currency={currency} /></div>
        <div><span>{setupCopy(locale, 'left')}</span><Amount minor={ready - total} currency={currency} /></div>
      </div>}</LoadState>
      <nav className="setup-group-nav" aria-label={setupCopy(locale, 'groups')}>
        {groups.map((group) => <button type="button" className="cr-button" key={group.groupId} aria-pressed={selectedGroup === group.groupId} onClick={() => setSelectedGroup(group.groupId)}>{name(group)}</button>)}
      </nav>
      {groups.map((group) => (
        <fieldset key={group.groupId} className="cr-form-section" hidden={group.groupId !== selectedGroup}>
          <legend>{name(group)}</legend>
          {currencies.map((option) => <div key={option} hidden={option !== currency}>
            {group.items.map((item) => <div key={item.itemId} onChangeCapture={(event) => {
              const input = event.target as HTMLInputElement;
              const invalidValue = input.value.trim() !== '' && parseMoney(input.value, option) === null;
              setInvalidAmounts((current) => ({ ...current, [`${option}:${item.itemId}`]: invalidValue }));
            }}>
              <MoneyField label={name(item)} currency={option} required={false} allowZero
                value={amounts[`${option}:${item.itemId}`] ?? null}
                onChange={(value) => setAmounts((current) => ({ ...current, [`${option}:${item.itemId}`]: value }))} />
            </div>)}
          </div>)}
        </fieldset>
      ))}
      {overAssignedCurrencies.map((option) => <Explain key={option} tone="warn">{t('fund.tooMuch', { amount: money(readyLoad.data?.currencies.find((entry) => entry.currency === option)?.ready ?? 0n, option) })}</Explain>)}
      {invalid ? <Explain tone="warn">{t('error.BUDGET_INVALID_AMOUNT')}</Explain> : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <div className="dialog-actions">
        {onBack ? <button type="button" className="cr-button" disabled={command.pending} onClick={onBack}>{t('common.back')}</button> : null}
        <button type="button" className="cr-button" disabled={command.pending} onClick={onFinish}>{setupCopy(locale, 'skip')}</button>
        <button type="submit" className="cr-button cr-button--primary" disabled={command.pending || overAssigned || invalid || readyLoad.status !== 'ready'}>{setupCopy(locale, 'finish')}</button>
      </div>
    </form>
  );
}
