import { screen } from '@testing-library/react';
import { fakeApi, fixtures, renderWithWorkspace, space } from '../test/harness.tsx';
import { Routes } from './app.tsx';

it.each(['expense', 'income'])('preserves the %s quick-add dialog on initial mount', async (kind) => {
  window.history.replaceState(null, '', `/?add=${kind}`);
  renderWithWorkspace(<Routes space={space()} spaces={fixtures.spaces} onSelectSpace={vi.fn()} onToggleLocale={vi.fn()} onSignOut={vi.fn()} />, fakeApi());
  expect(await screen.findByRole('dialog')).toBeVisible();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(window.location.search).toBe('');
});
