import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { copyPreviewFixture } from '../../test/in-memory-allocation-gateway.js';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { MonthCopyDialog } from './month-copy-dialog.js';
import { coreMonthStateFixture, emptyMonthState } from '../../test/in-memory-allocation-gateway.js';

function baseProps() {
  return {
    locale: 'en' as const,
    currency: 'USD' as const,
    targetMonth: '2026-10-01',
    previousMonth: '2026-09-01',
    loadSourceMonth: vi.fn().mockResolvedValue(coreMonthStateFixture),
    previewCopy: vi.fn().mockResolvedValue(copyPreviewFixture),
    copyMonth: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { snapshotId: '13', sourceSnapshotId: '12', previewHash: 'a'.repeat(64) } }),
    pending: false,
    ambiguous: null,
    retryAmbiguous: vi.fn().mockResolvedValue({ status: 'success', reconciled: true }),
    clearAmbiguous: vi.fn(),
    onClose: vi.fn(),
    onCopied: vi.fn(),
  };
}

describe('MonthCopyDialog', () => {
  it('previews the previous month and shows the destination month with the signed carry before confirm', async () => {
    render(<MonthCopyDialog {...baseProps()} />);
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
    expect(screen.getByText('-$25.00')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy plan' })).toBeEnabled());
  });

  it('confirms with the exact preview hash and expected target head', async () => {
    const props = baseProps();
    render(<MonthCopyDialog {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy plan' }));
    await waitFor(() => expect(props.copyMonth).toHaveBeenCalledWith({
      sourceSnapshotId: '12', targetMonth: '2026-10-01', expectedTargetSnapshotId: null, acceptedPreviewHash: 'a'.repeat(64),
    }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows an empty state when the previous month has no published plan', async () => {
    render(<MonthCopyDialog {...baseProps()} loadSourceMonth={vi.fn().mockResolvedValue(emptyMonthState)} />);
    expect(await screen.findByText('The previous month has no published plan to copy.')).toBeInTheDocument();
  });

  it('rejects a stale preview with a re-preview action, never a silent overwrite', async () => {
    const previewCopy = vi.fn()
      .mockRejectedValueOnce(postgrestRejection('40001', 'planning_stale_revision'))
      .mockResolvedValueOnce(copyPreviewFixture);
    render(<MonthCopyDialog {...baseProps()} previewCopy={previewCopy} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed since/i);
    await userEvent.click(screen.getByRole('button', { name: 'Preview again' }));
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
  });

  it('offers an unchanged retry when the copy result is ambiguous, never a second copy', async () => {
    const props = baseProps();
    props.copyMonth = vi.fn().mockResolvedValue({ status: 'ambiguous', reconciled: false });
    const { rerender } = render(<MonthCopyDialog {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy plan' }));
    await waitFor(() => expect(props.copyMonth).toHaveBeenCalledTimes(1));
    rerender(<MonthCopyDialog {...props} ambiguous={{ kind: 'copyMonth', requestId: 'req-fixed' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(props.retryAmbiguous).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape through DialogShell', async () => {
    const onClose = vi.fn();
    render(<MonthCopyDialog {...baseProps()} onClose={onClose} />);
    await screen.findByText('October 2026');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
