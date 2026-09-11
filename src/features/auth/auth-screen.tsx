import { useState, type FormEvent } from 'react';
import type { Locale } from '../loans/types.js';
import type { AuthStatus } from './use-auth-session.js';

interface AuthScreenProps {
  locale: Locale;
  state: Extract<AuthStatus, 'signed-out' | 'expired' | 'confirmation-required'>;
  confirmationEmail?: string | null;
  error: string | null;
  pending: boolean;
  onLocaleChange(): void;
  onSignIn(email: string, password: string): Promise<void> | void;
  onSignUp(email: string, password: string): Promise<void> | void;
  onBack(): void;
  onResendConfirmation(): Promise<void> | void;
}

const text = {
  en: {
    product: 'Budget ledger', signInTitle: 'Welcome back', expiredTitle: 'Your session expired',
    intro: 'Sign in to continue to your private financial workspace.', email: 'Email', password: 'Password',
    signIn: 'Sign in', create: 'Create account', createTitle: 'Create your account',
    createIntro: 'Start with a private space, then add a household space when you need one.',
    haveAccount: 'I already have an account', check: 'Check your email',
    checkBody: 'Use the confirmation link sent to', checkTail: 'Then return here and sign in.', language: 'العربية',
    resend: 'Resend confirmation email', resendSent: 'Confirmation email sent.', backToSignIn: 'Back to sign in',
  },
  ar: {
    product: 'دفتر الميزانية', signInTitle: 'مرحبًا بعودتك', expiredTitle: 'انتهت جلستك',
    intro: 'سجّل الدخول للمتابعة إلى مساحتك المالية الخاصة.', email: 'البريد الإلكتروني', password: 'كلمة المرور',
    signIn: 'تسجيل الدخول', create: 'إنشاء حساب', createTitle: 'أنشئ حسابك',
    createIntro: 'ابدأ بمساحة خاصة، وأضف مساحة منزلية عندما تحتاج إليها.',
    haveAccount: 'لديّ حساب بالفعل', check: 'تحقق من بريدك الإلكتروني',
    checkBody: 'استخدم رابط التأكيد المرسل إلى', checkTail: 'ثم عد إلى هنا وسجّل الدخول.', language: 'English',
    resend: 'إعادة إرسال رسالة التأكيد', resendSent: 'تم إرسال رسالة التأكيد.', backToSignIn: 'العودة إلى تسجيل الدخول',
  },
} as const;

export function AuthScreen(props: AuthScreenProps) {
  const copy = text[props.locale];
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resent, setResent] = useState(false);

  if (props.state === 'confirmation-required') {
    const resend = async () => {
      setResent(false);
      await props.onResendConfirmation();
      setResent(true);
    };
    return <main className="auth-page">
      <button type="button" className="locale-button auth-language" onClick={props.onLocaleChange}>{copy.language}</button>
      <section className="auth-confirmation" role="status">
        <span className="brand">{copy.product}</span>
        <h1>{copy.check}</h1>
        <p>{copy.checkBody} <bdi>{props.confirmationEmail}</bdi>. {copy.checkTail}</p>
        {props.error ? <div className="error-notice" role="alert">{props.error}</div> : null}
        <button type="button" onClick={() => void resend()} disabled={props.pending}>{copy.resend}</button>
        {resent ? <p>{copy.resendSent}</p> : null}
        <button type="button" onClick={props.onBack}>{copy.backToSignIn}</button>
      </section>
    </main>;
  }

  const signingUp = mode === 'sign-up';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedPassword = password;
    setPassword('');
    if (signingUp) await props.onSignUp(email.trim(), submittedPassword);
    else await props.onSignIn(email.trim(), submittedPassword);
  };

  return <main className="auth-page">
    <button type="button" className="locale-button auth-language" onClick={props.onLocaleChange}>{copy.language}</button>
    <section className="auth-panel">
      <div className="auth-intro">
        <span className="brand">{copy.product}</span>
        <h1>{signingUp ? copy.createTitle : props.state === 'expired' ? copy.expiredTitle : copy.signInTitle}</h1>
        <p>{signingUp ? copy.createIntro : copy.intro}</p>
      </div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label>{copy.email}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>{copy.password}<input type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {props.error ? <div className="error-notice" role="alert">{props.error}</div> : null}
        <button type="submit" disabled={props.pending}>{signingUp ? copy.create : copy.signIn}</button>
        <button type="button" className="text-button" onClick={() => setMode(signingUp ? 'sign-in' : 'sign-up')} disabled={props.pending}>{signingUp ? copy.haveAccount : copy.create}</button>
      </form>
    </section>
  </main>;
}
