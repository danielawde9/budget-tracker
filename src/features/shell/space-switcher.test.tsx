import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpaceSwitcher } from './space-switcher.js';
import type { Space } from '../loans/types.js';

const selectedSpace: Space = { id: 'household', name: 'Farah & Daniel', kind: 'household' };
const otherSpace: Space = { id: 'personal', name: 'My money', kind: 'personal' };

describe('SpaceSwitcher', () => {
  it.each([
    ['en', 'Current space', 'Switch to', 'Add another space'],
    ['ar', 'المساحة الحالية', 'التبديل إلى', 'إضافة مساحة أخرى'],
  ] as const)('identifies the current space and spaces other labels in %s', async (locale, currentLabel, switchLabel, addLabel) => {
    const user = userEvent.setup();
    const onSpaceChange = vi.fn();
    const onAddSpace = vi.fn();
    render(<SpaceSwitcher locale={locale} spaces={[selectedSpace, otherSpace]} selectedSpace={selectedSpace} onSpaceChange={onSpaceChange} onAddSpace={onAddSpace} />);
    await user.click(screen.getByRole('button', { name: `${currentLabel}: Farah & Daniel` }));
    const current = screen.getByRole('menuitem', { name: `${currentLabel}: Farah & Daniel` });
    expect(current).toBeDisabled();
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: `${switchLabel} Farah & Daniel` })).not.toBeInTheDocument();
    await user.click(current);
    expect(onSpaceChange).not.toHaveBeenCalled();
    const other = screen.getByRole('menuitem', { name: `${switchLabel} My money` });
    expect(other.textContent).toBe(`${switchLabel} My money`);
    expect(other.querySelector('bdi')).toHaveTextContent('My money');
    await user.click(other);
    expect(onSpaceChange).toHaveBeenCalledExactlyOnceWith('personal');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${currentLabel}: Farah & Daniel` }));
    await user.click(screen.getByRole('menuitem', { name: addLabel }));
    expect(onAddSpace).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('navigates actionable choices with the keyboard and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<SpaceSwitcher locale="en" spaces={[selectedSpace, otherSpace]} selectedSpace={selectedSpace} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Current space: Farah & Daniel' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Switch to My money' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Add another space' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Switch to My money' })).toHaveFocus();
    await user.keyboard('{End}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Switch to My money' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

});
