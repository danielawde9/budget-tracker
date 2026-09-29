import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChartPie, Plus, RotateCcw, Users } from 'lucide-react';
import type { Locale } from '../loans/types.js';

/** Where a "Try it" link lands; `app.tsx` owns the actual navigation. */
export type WelcomeTarget = 'record' | 'reports' | 'goals' | 'household';

interface WelcomeTourProps {
  locale: Locale;
  onDismiss(): void;
  onTryIt(target: WelcomeTarget): void;
}

interface WelcomeStep {
  title: string;
  body: string;
  target: WelcomeTarget;
  Icon: typeof Plus;
}

interface WelcomeCopy {
  product: string;
  title: string;
  intro(step: number): string;
  progress: string;
  next: string;
  getStarted: string;
  skip: string;
  close: string;
  tryIt: string;
  steps: readonly WelcomeStep[];
}

const copy: Record<'en' | 'ar', WelcomeCopy> = {
  en: {
    product: 'Budget ledger',
    title: 'Welcome back!',
    intro: (step) => `Four quick things that make budgeting easier. ${step} of 4.`,
    progress: 'Welcome progress',
    next: 'Next',
    getStarted: 'Get started',
    skip: 'Skip tour',
    close: 'Close',
    tryIt: 'Try it →',
    steps: [
      { title: 'Quick add', body: 'Record an expense or income in seconds — from here, or with an installed-app shortcut.', target: 'record', Icon: Plus },
      { title: 'Reports & insights', body: 'See where your money goes each month and what changed since last month.', target: 'reports', Icon: ChartPie },
      { title: 'Recurring & goals', body: 'Automate the bills you pay and save toward the purchases you plan.', target: 'goals', Icon: RotateCcw },
      { title: 'Household', body: 'Invite the people you live with and keep one budget together.', target: 'household', Icon: Users },
    ],
  },
  ar: {
    product: 'دفتر الميزانية',
    title: 'مرحبًا بعودتك!',
    intro: (step) => `أربع ميزات سريعة تجعل الميزانية أسهل. ${step} من 4.`,
    progress: 'تقدّم الجولة الترحيبية',
    next: 'التالي',
    getStarted: 'ابدأ الآن',
    skip: 'تخطَّ الجولة',
    close: 'إغلاق',
    tryIt: 'جرّبها ←',
    steps: [
      { title: 'الإضافة السريعة', body: 'سجّل مصروفًا أو دخلًا في ثوانٍ — من هنا، أو من اختصار على هاتفك.', target: 'record', Icon: Plus },
      { title: 'التقارير والرؤى', body: 'شاهد أين تذهب أموالك كل شهر وما الذي تغيّر منذ الشهر الماضي.', target: 'reports', Icon: ChartPie },
      { title: 'المتكرر والأهداف', body: 'جدّد الفواتير تلقائيًا وادّخر لما تخطط له من مشتريات.', target: 'goals', Icon: RotateCcw },
      { title: 'المنزل', body: 'ادعُ من تعيش معهم واحتفظوا بميزانية واحدة معًا.', target: 'household', Icon: Users },
    ],
  },
};

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
}

export function WelcomeTourDialog({ locale, onDismiss, onTryIt }: WelcomeTourProps) {
  const text = copy[locale];
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const current = text.steps[step]!;
  const last = step === text.steps.length - 1;

  // Return focus to whatever was focused before the tour opened.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    focusable(dialog)[0]?.focus();
  }, [step]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(event.currentTarget);
    const first = items[0];
    const lastItem = items.at(-1);
    if (!first || !lastItem) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.preventDefault()}>
      {/* Keep focus inside the dialog: a click on hero text or the scrim would
          otherwise move focus to <body>, silently killing the keydown trap. */}
      <section
        ref={dialogRef}
        className="dialog welcome-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div>
            <span className="auth-brand"><span className="auth-brand-mark" aria-hidden="true" />{text.product}</span>
            <h1 id="welcome-title">{text.title}</h1>
            <p className="dialog-intro">{text.intro(step + 1)}</p>
          </div>
          <button type="button" className="icon-button" aria-label={text.close} onClick={onDismiss}>×</button>
        </header>
        <ol className="welcome-dots" aria-label={text.progress}>
          {text.steps.map((item, index) => (
            <li
              key={item.title}
              className={index === step ? 'welcome-dot welcome-dot-current' : 'welcome-dot'}
              aria-label={item.title}
              aria-current={index === step ? 'step' : undefined}
            />
          ))}
        </ol>
        <div className="welcome-hero">
          <span className="welcome-icon" aria-hidden="true"><current.Icon size={22} strokeWidth={2} /></span>
          <strong>{current.title}</strong>
          <p>{current.body}</p>
          <button type="button" className="text-button welcome-try" onClick={() => onTryIt(current.target)}>{text.tryIt}</button>
        </div>
        <div className="dialog-actions welcome-actions">
          <button type="button" className="button-secondary" onClick={onDismiss}>{text.skip}</button>
          <button type="button" className="cr-button cr-button--primary" onClick={() => (last ? onDismiss() : setStep(step + 1))}>
            {last ? text.getStarted : text.next}
          </button>
        </div>
      </section>
    </div>
  );
}
