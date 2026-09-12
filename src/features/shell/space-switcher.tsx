import { useState } from 'react';

import type { Locale, Space } from '../loans/types.js';

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
  const currentSpace = t(locale, 'Current space', 'المساحة الحالية');
  const kind = selectedSpace.kind === 'personal'
    ? t(locale, 'Personal space', 'مساحة شخصية')
    : t(locale, 'Household space', 'مساحة منزلية');

  function selectSpace(spaceId: string) {
    setOpen(false);
    onSpaceChange(spaceId);
  }

  function addSpace() {
    setOpen(false);
    onAddSpace();
  }

  return <div className="space-switcher">
    <button type="button" className="space-switcher-trigger" aria-expanded={open} aria-haspopup="menu" aria-label={`${currentSpace}: ${selectedSpace.name}`} onClick={() => setOpen((current) => !current)}><span>{currentSpace}</span><bdi>{selectedSpace.name}</bdi><small>{kind}</small></button>
    {open ? <div className="space-switcher-menu" role="menu">
      {spaces.map((space) => <button key={space.id} type="button" role="menuitem" aria-current={space.id === selectedSpace.id ? 'true' : undefined} aria-label={`${t(locale, 'Switch to', 'التبديل إلى')} ${space.name}`} onClick={() => selectSpace(space.id)}>
        <span>{t(locale, 'Switch to', 'التبديل إلى')}</span><bdi>{space.name}</bdi>
      </button>)}
      <button type="button" role="menuitem" className="text-button" onClick={addSpace}>{t(locale, 'Add another space', 'إضافة مساحة أخرى')}</button>
    </div> : null}
  </div>;
}
