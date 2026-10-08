import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { I18nProvider } from '../lib/i18n.tsx';
import { Dialog } from './dialog.tsx';
import { ViewportDisclosure } from './viewport-disclosure.tsx';

it('resizes an open dialog when the keyboard reduces and pans the visual viewport', () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  const original = window.visualViewport;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  const view = render(<I18nProvider locale="en"><Dialog title="Expense" onClose={() => {}}><input aria-label="Description" /></Dialog></I18nProvider>);
  const dialog = screen.getByRole('dialog');
  expect(dialog.style.getPropertyValue('--dialog-viewport-height')).toBe('844px');
  viewport.height = 420;
  viewport.offsetTop = 90;
  viewport.dispatchEvent(new Event('resize'));
  expect(dialog.style.getPropertyValue('--dialog-viewport-height')).toBe('420px');
  expect(dialog.style.getPropertyValue('--dialog-viewport-top')).toBe('90px');
  view.unmount();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: original });
});

it('flips an action panel above a low trigger and clamps it at the left edge', async () => {
  render(<ViewportDisclosure className="test-menu" summary="Actions"><button>Expense</button></ViewportDisclosure>);
  const details = screen.getByText('Actions').closest('details')!;
  const summary = details.querySelector('summary')!;
  const panel = details.querySelector('div')!;
  vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({ left: 16, right: 64, top: 720, bottom: 768 } as DOMRect);
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width: 240, height: 162 } as DOMRect);
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await vi.waitFor(() => expect(panel.style.left).toBe('8px'));
  expect(parseFloat(panel.style.top)).toBeLessThan(720);
  await userEvent.setup().keyboard('{Escape}');
  await vi.waitFor(() => expect(details.open).toBe(false));
  expect(summary).toHaveFocus();
});
