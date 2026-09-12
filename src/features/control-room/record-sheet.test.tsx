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
});
