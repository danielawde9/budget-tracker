import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, House } from 'lucide-react';

import type { Locale, Space } from '../loans/types.js';
import './space-switcher.css';

interface SpaceSwitcherProps {
  locale: Locale;
  spaces: readonly Space[];
  selectedSpace: Space;
  onSpaceChange(spaceId: string): void;
  onAddSpace(): void;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function SpaceSwitcher({ locale, spaces, selectedSpace, onAddSpace, onSpaceChange }: SpaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  const currentSpace = t(locale, 'Current space', 'المساحة الحالية');
  const kind = selectedSpace.kind === 'personal'
    ? t(locale, 'Personal space', 'مساحة شخصية')
    : t(locale, 'Household space', 'مساحة منزلية');

  function selectSpace(spaceId: string) {
    setOpen(false);
    if (spaceId !== selectedSpace.id) onSpaceChange(spaceId);
  }

  function addSpace() {
    setOpen(false);
    onAddSpace();
  }

  return <div className="space-switcher">
    <button ref={triggerRef} type="button" className="space-switcher-trigger" aria-expanded={open} aria-haspopup="menu" aria-label={`${currentSpace}: ${selectedSpace.name}`} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><House className="space-switcher-icon" aria-hidden size={20} /><span>{currentSpace}</span><bdi>{selectedSpace.name}</bdi><small>{kind}</small><ChevronDown className="space-switcher-chevron" aria-hidden size={18} /></button>
    {open ? <div ref={menuRef} className="space-switcher-menu" role="menu" onKeyDown={menuKeyDown}>
      {spaces.map((space) => {
        const current = space.id === selectedSpace.id;
        const label = current ? currentSpace : t(locale, 'Switch to', 'التبديل إلى');
        return <button key={space.id} type="button" role="menuitem" className="space-switcher-option" disabled={current} aria-current={current ? 'true' : undefined} aria-label={`${label}${current ? ':' : ''} ${space.name}`} onClick={() => selectSpace(space.id)}>
          <span className="space-switcher-option-label">{label}{current ? ':' : ''}{' '}<bdi>{space.name}</bdi></span>
          {current && <Check aria-hidden size={17} />}
        </button>;
      })}
      <button type="button" role="menuitem" className="text-button" onClick={addSpace}>{t(locale, 'Add another space', 'إضافة مساحة أخرى')}</button>
    </div> : null}
  </div>;
}
