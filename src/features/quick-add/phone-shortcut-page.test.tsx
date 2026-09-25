import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneShortcutPage } from './phone-shortcut-page.js';

const ORIGIN = 'https://budget.example';

describe('PhoneShortcutPage', () => {
  it('shows ready-to-copy expense and income links for this site', () => {
    render(<PhoneShortcutPage locale="en" origin={ORIGIN} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Add from your phone' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Expense link' })).toHaveValue(`${ORIGIN}/?add=expense`);
    expect(screen.getByRole('textbox', { name: 'Income link' })).toHaveValue(`${ORIGIN}/?add=income`);
  });

  it('copies a link and confirms it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => undefined);
    render(<PhoneShortcutPage locale="en" origin={ORIGIN} writeClipboard={writeText} />);
    await user.click(screen.getByRole('button', { name: 'Copy expense link' }));
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/?add=expense`);
    expect(await screen.findByRole('status')).toHaveTextContent('Expense link copied.');
  });

  it('explains how to copy by hand when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => { throw new Error('NotAllowedError'); });
    render(<PhoneShortcutPage locale="en" origin={ORIGIN} writeClipboard={writeText} />);
    await user.click(screen.getByRole('button', { name: 'Copy income link' }));
    await waitFor(() => expect(screen.getByRole('status'))
      .toHaveTextContent('Copying isn’t allowed here. Press and hold the link to copy it.'));
  });

  it('gives iPhone and Android steps and says the link never records by itself', () => {
    render(<PhoneShortcutPage locale="en" origin={ORIGIN} />);
    const iphone = screen.getByRole('region', { name: 'iPhone' });
    expect(within(iphone).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(within(iphone).getByText(/Open URLs/)).toBeInTheDocument();
    const android = screen.getByRole('region', { name: 'Android' });
    expect(within(android).getAllByRole('listitem').some((item) => item.textContent?.includes('Add expense'))).toBe(true);
    expect(screen.getByText('The link only opens the form. Nothing is saved until you tap Save.')).toBeInTheDocument();
  });

  it('isolates the English terms quoted inside Arabic steps so they keep their order', () => {
    render(<PhoneShortcutPage locale="ar" origin={ORIGIN} />);
    const isolated = [...document.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(isolated).toContain('Add\u00a0expense');
    expect(isolated).toEqual(expect.arrayContaining(['Add\u00a0expense', 'Open\u00a0URLs', 'Chrome', 'Budget', 'Siri']));
  });

  it('renders in Arabic with the links kept left-to-right', () => {
    render(<PhoneShortcutPage locale="ar" origin={ORIGIN} />);
    expect(screen.getByRole('heading', { level: 1, name: 'الإضافة من هاتفك' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'رابط المصروف' })).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('region', { name: 'آيفون' })).toBeInTheDocument();
  });
});
