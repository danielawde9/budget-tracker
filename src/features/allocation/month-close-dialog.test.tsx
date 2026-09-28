import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { closePreviewFixture } from '../../test/in-memory-allocation-gateway.js';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { MonthCloseDialog } from './month-close-dialog.js';

const rootId = '00000000-0000-4000-8000-000000000010';

function baseProps() {
  return {
    locale: 'en' as const,
    currency: 'USD' as const,
    month: '2026-09-01',
    previewClose: vi.fn().mockResolvedValue(closePreviewFixture),
    closeMonth: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { closeId: '8', previewHash: 'b'.repeat(64), restatesCloseId: null } }),
    setRollover: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { revisionId: '4' } }),
    pending: false,
    ambiguous: null,
    retryAmbiguous: vi.fn().mockResolvedValue({ status: 'success', reconciled: true }),
    clearAmbiguous: vi.fn(),
    onClose: vi.fn(),
    onClosed: vi.fn(),
  };
}

describe('MonthCloseDialog', () => {
  it('previews the close and confirms with the exact preview hash and close head', async () => {
    const props = baseProps();
    render(<MonthCloseDialog {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Close month' }));
    await waitFor(() => expect(props.closeMonth).toHaveBeenCalledWith({ expectedCloseId: null, acceptedPreviewHash: 'b'.repeat(64) }));
    expect(await screen.findByText('Closed')).toBeInTheDocument();
  });

  it('re-previews against the current close head so a restatement carries a matching hash', async () => {
    const previewClose = vi.fn()
      .mockResolvedValueOnce({ ...closePreviewFixture, expectedCloseId: '7' })
      .mockResolvedValueOnce({ ...closePreviewFixture, expectedCloseId: '7' });
    render(<MonthCloseDialog {...baseProps()} previewClose={previewClose} />);
    await waitFor(() => expect(previewClose).toHaveBeenCalledWith({ month: '2026-09-01', expectedCloseId: '7' }));
    expect(previewClose).toHaveBeenNthCalledWith(1, { month: '2026-09-01', expectedCloseId: null });
  });

  it('refuses a month that has not ended with a localized recovery message', async () => {
    render(<MonthCloseDialog {...baseProps()} previewClose={vi.fn().mockRejectedValue(postgrestRejection('22023', 'budget_month_not_ended'))} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This month has not ended yet.');
    expect(screen.queryByRole('button', { name: 'Close month' })).not.toBeInTheDocument();
  });

  it('warns when a re-close would restate different facts', async () => {
    render(<MonthCloseDialog {...baseProps()} previewClose={vi.fn().mockResolvedValue({ ...closePreviewFixture, restatementRequired: true })} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/restate/i);
  });

  it('opts a root into rollover through the editor and then re-previews the fresh carry', async () => {
    const props = baseProps();
    const previewClose = vi.fn().mockResolvedValue(closePreviewFixture);
    render(<MonthCloseDialog {...props} previewClose={previewClose} />);
    await screen.findByRole('button', { name: 'Close month' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Carry Groceries into next month' }));
    await waitFor(() => expect(props.setRollover).toHaveBeenCalledWith({ rootId, enabled: true, expectedRevisionId: null }));
    await waitFor(() => expect(previewClose.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('offers a single unchanged retry when the close is ambiguous', async () => {
    const props = baseProps();
    props.closeMonth = vi.fn().mockResolvedValue({ status: 'ambiguous', reconciled: false });
    const { rerender } = render(<MonthCloseDialog {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Close month' }));
    await waitFor(() => expect(props.closeMonth).toHaveBeenCalledTimes(1));
    rerender(<MonthCloseDialog {...props} ambiguous={{ kind: 'closeMonth', requestId: 'req-fixed' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(props.retryAmbiguous).toHaveBeenCalledTimes(1));
  });
});
