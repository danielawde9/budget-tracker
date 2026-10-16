import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { I18nProvider } from '../lib/i18n.tsx';
import { AuthScreen } from './auth-screen.tsx';

function setup(invitation = false, locale: 'en' | 'ar' = 'en') {
  const auth = { signInWithPassword: vi.fn(async () => ({ data: { user: null, session: null }, error: null })), signUp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })) };
  render(<I18nProvider locale={locale}><AuthScreen client={{ auth } as unknown as SupabaseClient} invitation={invitation} onToggleLocale={vi.fn()} /></I18nProvider>);
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

it('opens registration for invite recipients and explains the next step', async () => {
  const auth = setup(true);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('invited to a shared budget');
  expect(screen.getByText(/email address that was invited/)).toBeVisible();
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'guest@example.com');
  await user.type(screen.getByLabelText('Password'), 'mypassword');
  await user.click(screen.getByRole('button', { name: 'Create account to continue' }));
  expect(auth.signUp).toHaveBeenCalledWith({ email: 'guest@example.com', password: 'mypassword' });
  expect(await screen.findByRole('status')).toHaveTextContent(/confirm your email.*return to this invite link/i);
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});

it('lets invite recipients switch to sign in without losing their email or invitation context', async () => {
  const auth = setup(true);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'guest@example.com');
  await user.type(screen.getByLabelText('Password'), 'mypassword');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('invited to a shared budget');
  expect(screen.getByLabelText('Email')).toHaveValue('guest@example.com');
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  await user.click(screen.getByRole('button', { name: 'Sign in to continue' }));
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'guest@example.com', password: 'mypassword' });
  expect(auth.signUp).not.toHaveBeenCalled();
});

it('offers the same invitation registration flow in Arabic', () => {
  setup(true, 'ar');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('تمت دعوتك إلى ميزانية مشتركة');
  expect(screen.getByRole('button', { name: 'إنشاء حساب للمتابعة' })).toBeVisible();
  expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
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
