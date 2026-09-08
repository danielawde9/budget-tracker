import { useEffect, useRef, type ReactNode } from 'react';

interface DialogShellProps {
  title: string;
  closeLabel: string;
  onClose(): void;
  children: ReactNode;
  pending?: boolean;
  wide?: boolean;
  descriptionId?: string;
}

export function DialogShell({ title, closeLabel, onClose, children, pending = false, wide = false, descriptionId }: DialogShellProps) {
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  const commandPending = useRef(pending);
  close.current = onClose;
  commandPending.current = pending;

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const target = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current;
    target?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!panel.current) return;
      if (event.key === 'Escape' && !commandPending.current) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
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
  }, []);

  return <div className="overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !pending) onClose();
  }}>
    <div className={`dialog wallet-dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-describedby={descriptionId} tabIndex={-1} ref={panel}>
      <header className="dialog-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={closeLabel} disabled={pending} onClick={onClose}>×</button>
      </header>
      {children}
    </div>
  </div>;
}
