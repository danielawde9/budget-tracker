import { useState } from 'react';
import { WalletStatementDialog } from './wallet-statement.tsx';
import { Wallet, TrendingUp, HandCoins, Plus } from 'lucide-react';
import { useUiCopy } from '../../lib/ui-copy.ts';
import type { AccountWallet } from '../../api/schemas.ts';
import { PageHeader } from '../../app/shell.tsx';
import { activeWallets, useWorkspace } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { LoadState } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';

export function AccountsScreen({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { t } = useI18n();
  const c = useUiCopy();
  const [statementWallet, setStatementWallet] = useState<AccountWallet | null>(null);
  const { catalog } = useWorkspace();
  return (
    <>
      <PageHeader
        title={t('nav.accounts')}
        subtitle={t('accounts.intro')}
      />
      <LoadState loaded={catalog}>
        {({ accounts }) => (
          <div className="cr-accounts">
            <section className="cr-account-overview" aria-label={c('accountsOverview')}><div><h2>{c('accountsOverview')}</h2><p className="cr-helper">{c('accountsOverviewHelp')}</p></div><span className="cr-count-badge">{accounts.wallets.filter(wallet => !wallet.archived).length} · {c('activeAccounts')}</span></section>
            <WalletBalances wallets={activeWallets(accounts, 'cash')} onAdd={() => onRecord({ kind: 'wallet' })} />
            <WalletList titleKey="accounts.cashTitle" introKey="accounts.cashIntro" wallets={activeWallets(accounts, 'cash')} onAdd={() => onRecord({ kind: 'wallet', walletKind: 'cash' })}
              actions={(wallet) => [
                { label: t('statement.check'), run: () => setStatementWallet(wallet) },
                { label: t('record.kind.expense'), run: () => onRecord({ kind: 'expense', walletId: wallet.id }) },
                { label: t('record.kind.income'), run: () => onRecord({ kind: 'income', walletId: wallet.id }) },
                { label: t('record.kind.transfer'), run: () => onRecord({ kind: 'transfer' }) },
              ]} />
            <WalletList titleKey="accounts.investTitle" introKey="accounts.investIntro" wallets={activeWallets(accounts, 'investment')} onAdd={() => onRecord({ kind: 'wallet', walletKind: 'investment' })}
              actions={(wallet) => [
                { label: t('invest.contribute'), run: () => onRecord({ kind: 'invest', action: 'contribute', investmentId: wallet.id }) },
                { label: t('invest.value'), run: () => onRecord({ kind: 'invest', action: 'value', investmentId: wallet.id }) },
                { label: t('invest.withdraw'), run: () => onRecord({ kind: 'invest', action: 'withdraw', investmentId: wallet.id }) },
              ]} />
            <WalletList titleKey="accounts.loanTitle" introKey="accounts.loanIntro" wallets={activeWallets(accounts, 'loan')} onAdd={() => onRecord({ kind: 'wallet', walletKind: 'loan' })}
              actions={(wallet) => wallet.loanDirection === 'i_owe'
                ? [
                    { label: t('loan.repay'), run: () => onRecord({ kind: 'loan', action: 'repay', loanId: wallet.id }) },
                    { label: t('loan.borrow'), run: () => onRecord({ kind: 'loan', action: 'borrow', loanId: wallet.id }) },
                  ]
                : [
                    { label: t('loan.collect'), run: () => onRecord({ kind: 'loan', action: 'collect', loanId: wallet.id }) },
                    { label: t('loan.lend'), run: () => onRecord({ kind: 'loan', action: 'lend', loanId: wallet.id }) },
                  ]} />
            <details className="cr-inline-disclosure"><summary>{c('spendableHelp')}</summary><p className="cr-helper">{t('accounts.spendableHelp')}</p></details>
          </div>
        )}
      </LoadState>
      {statementWallet ? <WalletStatementDialog wallet={statementWallet} onClose={() => setStatementWallet(null)} onRecord={(intent) => { setStatementWallet(null); onRecord(intent); }} /> : null}
    </>
  );
}

function WalletBalances({ wallets, onAdd }: { readonly wallets: readonly AccountWallet[]; readonly onAdd: () => void }) {
  const { t } = useI18n();
  const c = useUiCopy();
  const currencies = [...new Set(wallets.map(wallet => wallet.currency))];
  return <section className="cr-card cr-wallet-balances" aria-label={c('walletSummary')}><div className="cr-wallet-summary-main">
    <p className="cr-helper">{c('walletSummary')}</p>
    <div className="cr-wallet-balance-amounts">{currencies.length ? currencies.map(currency => <Amount key={currency} minor={wallets.filter(wallet => wallet.currency === currency).reduce((total, wallet) => total + wallet.balance, 0n)} currency={currency} />) : <p className="cr-helper">{t('accounts.none')}</p>}</div>
    <p className="cr-helper">{c('walletSummaryHelp')}</p>
    </div><button type="button" className="cr-button cr-button--primary" onClick={onAdd}><Plus size={18} aria-hidden />{t('accounts.add')}</button>
  </section>;
}

function WalletList({ titleKey, introKey, wallets, onAdd, actions }: {
  readonly titleKey: MessageKey;
  readonly introKey: MessageKey;
  readonly wallets: readonly AccountWallet[];
  readonly onAdd: () => void;
  readonly actions: (wallet: AccountWallet) => readonly { readonly label: string; readonly run: () => void }[];
}) {
  const { t } = useI18n();
  const c = useUiCopy();
  return (
    <section className="cr-card cr-account-section" aria-labelledby={titleKey}>
      <div className="cr-section-header">
        <div>
          <h2 id={titleKey}>{t(titleKey)}</h2>
          <p className="cr-helper">{t(introKey)}</p>
        </div>
        <button type="button" className="text-button" onClick={onAdd} aria-label={`${t('accounts.addShort')} · ${t(titleKey)}`}>{t('accounts.addShort')}</button>
      </div>
      {wallets.length === 0 ? <p className="cr-helper cr-account-empty">{t('accounts.none')}</p> : (
        <ul className="cr-register">
          {wallets.map((wallet) => (
            <li key={wallet.id} className="cr-register-row cr-account-row">
              <span className="cr-account-icon" aria-hidden>{wallet.kind === 'investment' ? <TrendingUp size={21} /> : wallet.kind === 'loan' ? <HandCoins size={21} /> : <Wallet size={21} />}</span>
              <div className="cr-register-main">
                <bdi className="cr-register-title">{wallet.name}</bdi>
                <WalletFacts wallet={wallet} />
              </div>
              <Amount minor={wallet.loanDirection === 'i_owe' ? -wallet.balance : wallet.balance} currency={wallet.currency} />
              <div className="cr-account-actions" role="group" aria-label={`${wallet.name} · ${c('accountActions')}`}>
                {actions(wallet).map(action => <button key={action.label} type="button" className="cr-button cr-button--sm" onClick={action.run}>{action.label}</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WalletFacts({ wallet }: { readonly wallet: AccountWallet }) {
  const { t, money } = useI18n();
  if (wallet.kind === 'investment' && wallet.contributed !== null && wallet.gain !== null) {
    return <span className="cr-helper">{t('accounts.investFacts', { contributed: money(wallet.contributed, wallet.currency), gain: money(wallet.gain, wallet.currency, { sign: true }) })}</span>;
  }
  if (wallet.kind === 'loan') {
    return <span className="cr-helper">{wallet.loanDirection === 'i_owe' ? t('accounts.iOwe', { name: wallet.counterparty ?? wallet.name }) : t('accounts.owedToMe', { name: wallet.counterparty ?? wallet.name })}</span>;
  }
  return <span className="cr-helper">{wallet.currency}</span>;
}
