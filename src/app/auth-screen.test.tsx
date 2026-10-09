import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { I18nProvider } from '../lib/i18n.tsx';
import { AuthScreen } from './auth-screen.tsx';

function setup() {
  const auth = { signInWithPassword: vi.fn(async () => ({ error: null })), signUp: vi.fn(async () => ({ error: null })) };
  render(<I18nProvider locale="en"><AuthScreen client={{ auth } as unknown as SupabaseClient} onToggleLocale={vi.fn()} /></I18nProvider>);
  return auth;
}

it('reveals the password accessibly without changing it or submitting', async () => {
  const auth = setup();
  const user = userEvent.setup();
  const password = screen.getByLabelText('Password');
  await user.type(password, 'mypassword');
  await user.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  expect(password).toHaveValue('mypassword');
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});

it('offers public information and GitHub contributions before sign in', () => {
  setup();
  expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
  expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works');
  expect(screen.getByRole('link', { name: 'USD & LBP guide' })).toHaveAttribute('href', '/budgeting-usd-lbp');
  expect(screen.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/danielawde9/budget-tracker');
});

it('keeps sign in and account creation on their original backend methods', async () => {
  const auth = setup();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'owner@example.com');
  await user.type(screen.getByLabelText('Password'), 'mypassword');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'mypassword' });
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(auth.signUp).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'mypassword' });
});
