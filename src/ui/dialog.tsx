import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';

export interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** While a command is in flight the dialog cannot be dismissed. */
  readonly pending?: boolean;
  readonly wide?: boolean;
  readonly description?: string;
}

/**
 * A modal built on the native <dialog> opened with showModal(): the browser
 * provides the focus trap, the inert background, Escape / platform close
 * requests and focus return to the opener.
 */
export function Dialog({ title, onClose, children, pending = false, wide = false, description }: DialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const pendingRef = useRef(pending);
  const closeRef = useRef(onClose);
  pendingRef.current = pending;
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    const viewport = window.visualViewport;
    const updateViewport = () => {
      dialog.style.setProperty('--dialog-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!pendingRef.current) closeRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    const target = dialog.querySelector<HTMLElement>('[data-autofocus]');
    target?.focus();
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`cr-dialog dialog${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pendingRef.current) {
          // Closing restores focus; cancel the pointer default so it cannot
          // move focus away again after the dialog unmounts.
          event.preventDefault();
          closeRef.current();
        }
      }}
    >
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="cr-icon-button" aria-label={t('common.close')} disabled={pending} onClick={onClose}>
          <X aria-hidden size={20} />
        </button>
      </header>
      {description ? <p id={descriptionId} className="dialog-intro">{description}</p> : null}
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
