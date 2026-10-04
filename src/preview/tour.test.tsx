import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, renderWithWorkspace } from '../test/harness.tsx';
import { DemoTour, DemoTourPanel, DemoTourProvider } from './tour.tsx';

it('shows one demonstration at a time and opens the screen explained by the next step', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<DemoTourProvider><DemoTour /><DemoTourPanel /></DemoTourProvider>, fakeApi());
  await user.click(screen.getByRole('button', { name: 'Start the tour' }));
  expect(screen.getByText('1 / 10')).toBeInTheDocument();
  expect(screen.queryByText('2 · Existing money as opening balances')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('2 / 10')).toBeInTheDocument();
  expect(window.location.hash).toBe('#/plan/2026-09');
  await user.click(screen.getByRole('button', { name: 'Skip tour' }));
  expect(screen.queryByText('2 / 10')).not.toBeInTheDocument();
});
