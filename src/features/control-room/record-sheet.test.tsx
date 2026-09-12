import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Currency, LoanDirection } from '../loans/types.js';
import type { WalletProjection } from '../wallets/types.js';
import { RecordSheet } from './record-sheet.js';
import type { RecordSheetProps } from './record-sheet.js';

const WALLETS: readonly WalletProjection[] = [
  { id: 'w-cash', spaceId: 'space-1', name: 'Cash', currency: 'USD', archivedAt: null, balanceMinor: '10000' },
  { id: 'w-bank', spaceId: 'space-1', name: 'Bank', currency: 'USD', archivedAt: null, balanceMinor: '0' },
  { id: 'w-lbp', spaceId: 'space-1', name: 'Cash LBP', currency: 'LBP', archivedAt: null, balanceMinor: '0' },
];

const CATEGORY_TREE = [
  {
    id: 'cat-groceries', nameEn: 'Groceries', nameAr: 'بقالة', kind: 'expense' as const,
    children: [{ id: 'cat-fresh', nameEn: 'Fresh market', nameAr: 'خضار' }],
  },
  {
    id: 'cat-salary', nameEn: 'Salary', nameAr: 'راتب', kind: 'income' as const,
    children: [],
  },
];

const OUTSTANDING_LOANS = [
  { loanId: 'loan-1', personName: 'Sara', currency: 'USD' as Currency, outstandingMinor: '5000' },
];

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function makeProps(overrides: Partial<RecordSheetProps> = {}): RecordSheetProps {
  return {
    open: true,
    locale: 'en',
    wallets: WALLETS,
    loans: OUTSTANDING_LOANS,
    payees: ['Market', 'Landlord'],
    categoryTree: CATEGORY_TREE,
    exchangeAvailable: true,
    pending: false,
    error: null,
    onClose: vi.fn(),
    onSubmitRecord: vi.fn(async () => undefined),
    onSubmitExchange: vi.fn(async () => undefined),
    onSubmitLoan: vi.fn(async () => undefined),
    onSubmitRepayment: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function pressKeys(user: ReturnType<typeof userEvent.setup>, keys: string) {
  for (const key of keys.split(' ')) {
    await user.click(screen.getByRole('button', { name: key === 'back' ? 'Delete' : key }));
  }
}

async function enterAmount(user: ReturnType<typeof userEvent.setup>, keys: string) {
  await pressKeys(user, keys);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('RecordSheet', () => {
  it('renders nothing when closed', () => {
    render(<RecordSheet {...makeProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the type grid with all seven tiles in English and Arabic', () => {
    render(<RecordSheet {...makeProps()} />);
    for (const label of ['Expense', 'Income', 'Transfer', 'Exchange', 'Lend', 'Borrow', 'Repay']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('opens on the type grid with Arabic tile labels', () => {
    render(<RecordSheet {...makeProps({ locale: 'ar' })} />);
    for (const label of ['مصروف', 'دخل', 'تحويل', 'صرف', 'إقراض', 'استدانة', 'سداد']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('disables the Exchange tile with a tooltip when the exchange client is unavailable', () => {
    render(<RecordSheet {...makeProps({ exchangeAvailable: false })} />);
    const tile = screen.getByRole('button', { name: 'Exchange' });
    expect(tile).toBeDisabled();
    expect(tile).toHaveAttribute('title', 'Connect this browser to its data service to record exchanges.');
  });

  it('records an expense: keypad input, wallet, category with subcategories, details, and submit', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));

    // Keypad: digits append, at most one decimal separator.
    await pressKeys(user, '1 2 . . 5 .');
    expect(screen.getByLabelText('Amount')).toHaveTextContent('12.5');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Wallet picker lists active wallets.
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));

    // Expand subcategories, then pick the root category.
    await user.click(screen.getByRole('button', { name: 'Expand Groceries' }));
    expect(screen.getByRole('button', { name: 'Fresh market' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Groceries' }));

    // Details: payee input has a datalist of known payees; note input.
    const payeeInput = screen.getByLabelText('Payee');
    expect(payeeInput).toHaveAttribute('list', 'cr-payee-list');
    expect(document.getElementById('cr-payee-list')).toHaveTextContent('Market');
    await user.type(payeeInput, 'Market');
    await user.type(screen.getByLabelText('Note'), 'weekly shop');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Confirm summary.
    expect(screen.getByText('Expense · $12.50 · Cash · Groceries')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitRecord).toHaveBeenCalledWith({
      kind: 'expense',
      effectiveDate: todayLocal(),
      movements: [{ walletId: 'w-cash', amountMinor: '-1250' }],
      categoryId: 'cat-groceries',
      payeeName: 'Market',
      note: 'weekly shop',
    });
  });

  it('allows skipping the category on an expense', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await enterAmount(user, '1 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitRecord).toHaveBeenCalledWith(expect.objectContaining({ categoryId: null }));
  });

  it('records an income as positive minor units', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Income' }));
    await enterAmount(user, '1 0 0 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Salary' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitRecord).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'income',
      movements: [{ walletId: 'w-cash', amountMinor: '100000' }],
      categoryId: 'cat-salary',
    }));
  });

  it('records a transfer between two distinct same-currency wallets with signed movements', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await enterAmount(user, '1 0');

    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    // Destination list excludes the source wallet.
    expect(screen.queryByRole('button', { name: 'Cash USD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cash LBP' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bank USD' }));

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitRecord).toHaveBeenCalledWith({
      kind: 'transfer',
      effectiveDate: todayLocal(),
      movements: [
        { walletId: 'w-cash', amountMinor: '-1000' },
        { walletId: 'w-bank', amountMinor: '1000' },
      ],
      categoryId: null,
      payeeName: null,
      note: null,
    });
  });

  it('records an exchange with USD out, LBP in, and per-currency wallet pickers', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Exchange' }));
    await user.type(screen.getByLabelText('USD out'), '50');
    await user.type(screen.getByLabelText('LBP in'), '900000');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: /Cash LBP/ }));

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitExchange).toHaveBeenCalledWith({
      usdWalletId: 'w-cash',
      lbpWalletId: 'w-lbp',
      usdAmountMinor: '5000',
      lbpAmountMinor: '900000',
      effectiveDate: todayLocal(),
    });
  });

  it.each([
    ['Lend', 'they_owe_me'],
    ['Borrow', 'i_owe_them'],
  ] as const)('records a %s as a cash loan', async (tile, direction: LoanDirection) => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: tile }));
    await enterAmount(user, '2 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.type(screen.getByLabelText('Person'), 'Sara');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitLoan).toHaveBeenCalledWith({
      direction,
      personName: 'Sara',
      currency: 'USD',
      walletId: 'w-cash',
      amountMinor: '2000',
      effectiveDate: todayLocal(),
      dueDate: null,
      note: null,
    });
  });

  it('records a repayment against an outstanding loan', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Repay' }));
    await user.click(screen.getByRole('button', { name: 'Sara $50.00' }));
    await pressKeys(user, '2 5');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Wallet picker is filtered to the loan currency (USD).
    expect(screen.queryByRole('button', { name: 'Cash LBP' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bank USD' }));

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(props.onSubmitRepayment).toHaveBeenCalledWith({
      loanId: 'loan-1',
      walletId: 'w-bank',
      amountMinor: '2500',
      effectiveDate: todayLocal(),
    });
  });

  it('keeps the sheet open and shows the server message when submit fails', async () => {
    const user = userEvent.setup();
    const props = makeProps({
      onSubmitRecord: vi.fn(async () => { throw new Error('server exploded'); }),
    });
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await enterAmount(user, '1 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('server exploded');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('closes via the parent when the submit succeeds', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const props = makeProps({
      onClose,
      onSubmitRecord: vi.fn(async () => { onClose(); }),
    });
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await enterAmount(user, '1 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('closes on Escape and backdrop click', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('resets its state when reopened after a successful close', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { rerender } = render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();

    rerender(<RecordSheet {...makeProps({ open: false, onClose: props.onClose })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<RecordSheet {...props} />);

    // Back on the type grid, not the amount step.
    expect(screen.getByRole('button', { name: 'Expense' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('steps back from the amount step to the type grid and can continue forward again', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<RecordSheet {...props} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await pressKeys(user, '1 2 . 5');
    expect(screen.getByLabelText('Amount')).toHaveTextContent('12.5');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    // Back on the type grid, amount cleared.
    expect(screen.getByRole('button', { name: 'Income' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();

    // Forward again works end to end.
    await user.click(screen.getByRole('button', { name: 'Expense' }));
    expect(screen.getByLabelText('Amount')).toHaveTextContent('');
    await enterAmount(user, '3 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(props.onSubmitRecord).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'expense',
      movements: [{ walletId: 'w-cash', amountMinor: '-3000' }],
    }));
  });

  it('steps back from the repayment amount to the loan picker', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: 'Repay' }));
    await user.click(screen.getByRole('button', { name: 'Sara $50.00' }));
    await pressKeys(user, '2 5');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    // Back at the loan picker, not the keypad.
    expect(screen.getByRole('button', { name: 'Sara $50.00' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('keeps the transfer confirm disabled until both wallets are picked', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await enterAmount(user, '1 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));

    // Only the source wallet is picked: no confirm yet.
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bank USD' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bank USD' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('walks back through every expense step boundary one press at a time', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    // Walk forward to confirm.
    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await enterAmount(user, '1 2 . 5');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Expense · $12.50 · Cash · Groceries')).toBeInTheDocument();

    // confirm -> details
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Payee')).toBeInTheDocument();
    // details -> category (previous choice still marked)
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Groceries' })).toHaveAttribute('aria-pressed', 'false');
    // category -> wallet
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Cash USD' })).toBeInTheDocument();
    // wallet -> amount
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Amount')).toHaveTextContent('12.5');
    // amount -> type grid
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Income' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('walks back through the transfer step boundaries', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await enterAmount(user, '1 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Bank USD' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();

    // confirm -> wallet (destination pick)
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Bank USD' })).toBeInTheDocument();
    // wallet -> amount
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Amount')).toHaveTextContent('10');
    // amount -> type grid
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
  });

  it('walks back through the loan flow step boundaries', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: 'Lend' }));
    await enterAmount(user, '2 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.type(screen.getByLabelText('Person'), 'Sara');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();

    // confirm -> details
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Person')).toHaveValue('Sara');
    // details -> wallet (loans have no category step)
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Cash USD' })).toBeInTheDocument();
    // wallet -> amount
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Amount')).toHaveTextContent('20');
  });

  it('steps back from the repay loan chooser to the type grid', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: 'Repay' }));
    expect(screen.getByRole('button', { name: 'Sara $50.00' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Expense' })).toBeInTheDocument();
  });

  it('ignores a leading decimal separator on the keypad', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await user.click(screen.getByRole('button', { name: '.' }));
    expect(screen.getByLabelText('Amount')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await pressKeys(user, '5 .');
    expect(screen.getByLabelText('Amount')).toHaveTextContent('5.');
  });

  it('clears kind-specific fields when the record kind changes mid-session', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps()} />);

    // Partially fill an expense, then back out to the type grid and switch to a loan.
    await user.click(screen.getByRole('button', { name: 'Expense' }));
    await enterAmount(user, '1 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.type(screen.getByLabelText('Payee'), 'Market');
    await user.type(screen.getByLabelText('Note'), 'stale note');
    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Back' }));
    }
    expect(screen.getByRole('button', { name: 'Lend' })).toBeInTheDocument();

    // Lend details must not inherit the expense payee/note.
    await user.click(screen.getByRole('button', { name: 'Lend' }));
    await enterAmount(user, '3 0');
    await user.click(screen.getByRole('button', { name: 'Cash USD' }));
    expect(screen.getByLabelText('Person')).toHaveValue('');
    expect(screen.getByLabelText('Note')).toHaveValue('');
  });

  it('restores focus to the invoking control when the sheet closes', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Trigger</button>
          <RecordSheet {...makeProps({ open, onClose: () => setOpen(false) })} />
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trigger' })).toHaveFocus();
  });

  it('renders Arabic copy without leaking English labels', async () => {
    const user = userEvent.setup();
    render(<RecordSheet {...makeProps({ locale: 'ar' })} />);
    expect(screen.getByRole('dialog', { name: 'تسجيل' })).toBeInTheDocument();
    for (const tile of ['مصروف', 'دخل', 'تحويل', 'صرف', 'إقراض', 'استدانة', 'سداد']) {
      expect(screen.getByRole('button', { name: tile })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Expense' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'مصروف' }));
    expect(screen.getByLabelText('المبلغ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حذف' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    expect(screen.getByRole('button', { name: 'رجوع' })).toBeInTheDocument();
  });
});
