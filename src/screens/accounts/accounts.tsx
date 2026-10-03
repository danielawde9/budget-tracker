import type { AccountWallet } from '../../api/schemas.ts';
import { PageHeader } from '../../app/shell.tsx';
import { activeWallets, useWorkspace } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { LoadState } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';

export function AccountsScreen({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { t } = useI18n();
  const { catalog } = useWorkspace();
  return (
    <>
      <PageHeader
        title={t('nav.accounts')}
        subtitle={t('accounts.intro')}
        actions={<button type="button" className="cr-button cr-button--primary" onClick={() => onRecord({ kind: 'wallet' })}>{t('accounts.add')}</button>}
      />
      <LoadState loaded={catalog}>
        {({ accounts }) => (
          <div className="cr-accounts">
            <WalletList titleKey="accounts.cashTitle" introKey="accounts.cashIntro" wallets={activeWallets(accounts, 'cash')} onAdd={() => onRecord({ kind: 'wallet', walletKind: 'cash' })}
              actions={(wallet) => [
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
          </div>
        )}
      </LoadState>
    </>
  );
}

function WalletList({ titleKey, introKey, wallets, onAdd, actions }: {
  readonly titleKey: MessageKey;
  readonly introKey: MessageKey;
  readonly wallets: readonly AccountWallet[];
  readonly onAdd: () => void;
  readonly actions: (wallet: AccountWallet) => readonly { readonly label: string; readonly run: () => void }[];
}) {
  const { t } = useI18n();
  return (
    <section className="cr-card" aria-labelledby={titleKey}>
      <div className="cr-section-header">
        <div>
          <h2 id={titleKey}>{t(titleKey)}</h2>
          <p className="cr-helper">{t(introKey)}</p>
        </div>
        <button type="button" className="cr-button cr-button--sm" onClick={onAdd}>{t('accounts.addShort')}</button>
      </div>
      {wallets.length === 0 ? <p className="cr-helper">{t('accounts.none')}</p> : (
        <ul className="cr-register">
          {wallets.map((wallet) => (
            <li key={wallet.id} className="cr-register-row cr-account-row">
              <div className="cr-register-main">
                <bdi className="cr-register-title">{wallet.name}</bdi>
                <WalletFacts wallet={wallet} />
              </div>
              <Amount minor={wallet.loanDirection === 'i_owe' ? -wallet.balance : wallet.balance} currency={wallet.currency} />
              <div className="cr-row cr-account-actions">
                {actions(wallet).map((action) => <button key={action.label} type="button" className="cr-button cr-button--sm" onClick={action.run}>{action.label}</button>)}
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
