import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

interface DialogFrameProps {
  readonly title: string;
  readonly closeLabel: string;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function HouseholdDialogFrame({ title, closeLabel, pending, onClose, children }: DialogFrameProps) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const initialFocus = panel.current?.querySelector<HTMLElement>('[data-initial-focus]');
    (initialFocus ?? panel.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      )];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus.current?.focus();
    };
  }, [onClose, pending]);

  return <div className="overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !pending) onClose();
  }}>
    <section ref={panel} className="dialog household-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label={closeLabel} disabled={pending} onClick={onClose}>×</button>
      </header>
      {children}
    </section>
  </div>;
}

interface InviteDialogProps {
  readonly locale: 'en' | 'ar';
  readonly pending: boolean;
  readonly succeeded: boolean;
  readonly error: ReactNode;
  readonly onClose: () => void;
  readonly onSubmit: (email: string) => Promise<boolean>;
}

export function InviteHouseholdDialog(props: InviteDialogProps) {
  const [email, setEmail] = useState('');
  const ar = props.locale === 'ar';
  const title = ar ? 'إنشاء سجل دعوة' : 'Create invitation record';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await props.onSubmit(email)) setEmail('');
  }
  return <HouseholdDialogFrame title={title} closeLabel={ar ? 'إغلاق' : 'Close'} pending={props.pending} onClose={props.onClose}>
    <p className="dialog-intro">{ar
      ? 'ينشئ هذا الإجراء سجل دعوة لمدة سبعة أيام. خدمة الإرسال غير مهيأة.'
      : 'This creates a seven-day invitation record. Delivery is not configured.'}</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>{ar ? 'البريد الإلكتروني للعضو' : 'Member email'}
        <input type="email" required maxLength={254} autoComplete="email" data-initial-focus value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {props.error}
      {props.succeeded ? <p role="status" className="success-notice">{ar
        ? 'تم إنشاء سجل الدعوة. خدمة الإرسال غير مهيأة.'
        : 'Invitation record created. Delivery is not configured.'}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="secondary" disabled={props.pending} onClick={props.onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="submit" disabled={props.pending || props.succeeded}>{props.pending
          ? (ar ? 'جارٍ الإنشاء…' : 'Creating…')
          : title}</button>
      </div>
    </form>
  </HouseholdDialogFrame>;
}

interface ConfirmDialogProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly closeLabel: string;
  readonly acknowledgement: string;
  readonly pendingLabel: string;
  readonly pending: boolean;
  readonly dangerous?: boolean;
  readonly error: ReactNode;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<boolean>;
}

export function HouseholdConfirmDialog(props: ConfirmDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  return <HouseholdDialogFrame title={props.title} closeLabel={props.closeLabel} pending={props.pending} onClose={props.onClose}>
    <div className="dialog-intro">{props.description}</div>
    <label className="confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{props.acknowledgement}</label>
    {props.error}
    <div className="dialog-actions">
      <button type="button" className="secondary" disabled={props.pending} onClick={props.onClose}>{props.closeLabel}</button>
      <button type="button" className={props.dangerous ? 'danger-button' : ''} disabled={!confirmed || props.pending} onClick={async () => {
        if (await props.onConfirm()) props.onClose();
      }}>{props.pending ? props.pendingLabel : props.confirmLabel}</button>
    </div>
  </HouseholdDialogFrame>;
}

interface AcceptDialogProps {
  readonly locale: 'en' | 'ar';
  readonly pending: boolean;
  readonly terminal: boolean;
  readonly error: ReactNode;
  readonly onAccept: () => Promise<void>;
  readonly onDismiss: () => void;
}

export function AcceptHouseholdInvitationDialog(props: AcceptDialogProps) {
  const ar = props.locale === 'ar';
  return <HouseholdDialogFrame
    title={ar ? 'قبول دعوة منزلية' : 'Accept household invitation'}
    closeLabel={ar ? 'تجاهل الدعوة' : 'Dismiss invitation'}
    pending={props.pending}
    onClose={props.onDismiss}
  >
    <p className="dialog-intro">{ar
      ? 'اقبل الدعوة لإضافة هذه المساحة المنزلية إلى مساحاتك المتاحة.'
      : 'Accept to add this household to your visible spaces.'}</p>
    {props.error}
    <div className="dialog-actions">
      <button type="button" className="secondary" disabled={props.pending} onClick={props.onDismiss}>{ar ? 'تجاهل' : 'Dismiss'}</button>
      {!props.terminal ? <button type="button" disabled={props.pending} onClick={() => void props.onAccept()}>{props.pending
        ? (ar ? 'جارٍ القبول…' : 'Accepting…')
        : (ar ? 'قبول الدعوة' : 'Accept invitation')}</button> : null}
    </div>
  </HouseholdDialogFrame>;
}
