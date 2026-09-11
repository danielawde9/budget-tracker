import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './auth-screen.js';

describe('AuthScreen', () => {
  it('submits visibly labelled sign-in fields and preserves email on failure', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn(async () => undefined);
    render(<AuthScreen locale="en" state="signed-out" error="Sign-in was not accepted." pending={false} onLocaleChange={vi.fn()} onSignIn={onSignIn} onSignUp={vi.fn()} onBack={vi.fn()} onResendConfirmation={vi.fn()} />);

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    await user.type(email, 'owner@example.com');
    await user.type(password, 'private-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onSignIn).toHaveBeenCalledWith('owner@example.com', 'private-password');
    expect(email).toHaveValue('owner@example.com');
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in was not accepted.');
  });

  it('switches to sign-up and announces email confirmation without credentials', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AuthScreen locale="en" state="signed-out" error={null} pending={false} onLocaleChange={vi.fn()} onSignIn={vi.fn()} onSignUp={vi.fn()} onBack={vi.fn()} onResendConfirmation={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');

    rerender(<AuthScreen locale="en" state="confirmation-required" confirmationEmail="new@example.com" error={null} pending={false} onLocaleChange={vi.fn()} onSignIn={vi.fn()} onSignUp={vi.fn()} onBack={vi.fn()} onResendConfirmation={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(within(status).getByText('Check your email')).toBeInTheDocument();
    expect(status).toHaveTextContent('new@example.com');
    expect(status).not.toHaveTextContent('password');
  });

  it('lets the confirmation screen resend the email and go back to sign-in', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onResendConfirmation = vi.fn(async () => undefined);
    render(<AuthScreen locale="en" state="confirmation-required" confirmationEmail="new@example.com" error={null} pending={false} onLocaleChange={vi.fn()} onSignIn={vi.fn()} onSignUp={vi.fn()} onBack={onBack} onResendConfirmation={onResendConfirmation} />);

    await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
    expect(onResendConfirmation).toHaveBeenCalledOnce();
    expect(await screen.findByText('Confirmation email sent.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders equivalent Arabic RTL controls', () => {
    render(<AuthScreen locale="ar" state="expired" error={null} pending={false} onLocaleChange={vi.fn()} onSignIn={vi.fn()} onSignUp={vi.fn()} onBack={vi.fn()} onResendConfirmation={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'انتهت جلستك' })).toBeInTheDocument();
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });
});
