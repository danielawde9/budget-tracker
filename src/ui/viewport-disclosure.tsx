import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A disclosure panel clamped to the visible viewport, including above a keyboard. */
export function ViewportDisclosure({ className, summary, children, label, panelClassName = '' }: {
  readonly className: string;
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly label?: string;
  readonly panelClassName?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const details = ref.current;
    const panel = panelRef.current;
    if (!details || !panel) return;
    const position = () => {
      const trigger = details.querySelector('summary')!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? window.innerWidth) - 16;
      const tabbar = document.querySelector<HTMLElement>('.cr-tabbar');
      const tabbarRect = tabbar?.getBoundingClientRect();
      const fabRect = tabbar?.querySelector('.cr-fab')?.getBoundingClientRect();
      const navigationTop = tabbarRect && tabbarRect.height > 0
        ? Math.min(tabbarRect.top, fabRect?.top ?? tabbarRect.top) - 8
        : Infinity;
      const bottom = Math.min(top + (viewport?.height ?? window.innerHeight) - 16, navigationTop);
      panel.style.maxWidth = `${right - left}px`;
      panel.style.maxHeight = `${bottom - top}px`;
      const rect = panel.getBoundingClientRect();
      const rtl = getComputedStyle(details).direction === 'rtl';
      panel.style.left = `${Math.max(left, Math.min(rtl ? trigger.left : trigger.right - rect.width, right - rect.width))}px`;
      const below = trigger.bottom + 4;
      panel.style.top = `${Math.max(top, Math.min(below + rect.height <= bottom ? below : trigger.top - rect.height - 4, bottom - rect.height))}px`;
    };
    const dismiss = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && details.contains(event.target as Node)) return;
      details.open = false;
      if (event.type === 'keydown') details.querySelector('summary')?.focus();
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open]);
  return <details ref={ref} className={className} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label={label}>{summary}</summary>
    <div ref={panelRef} className={`cr-viewport-panel ${panelClassName}`}>{children}</div>
  </details>;
}
