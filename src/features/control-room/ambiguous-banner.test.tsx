import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AmbiguousBanner } from './ambiguous-banner.js';

describe('AmbiguousBanner', () => {
  it('renders nothing when there is no ambiguous command', () => {
    const { container } = render(
      <AmbiguousBanner locale="en" ambiguous={null} onRetry={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an alert with retry and dismiss actions', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <AmbiguousBanner locale="en" ambiguous={{ requestId: 'req-1' }} onRetry={onRetry} onDismiss={onDismiss} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('We could not confirm your last change. Check again?');
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders Arabic copy', () => {
    render(
      <AmbiguousBanner locale="ar" ambiguous={{ requestId: 'req-1' }} onRetry={vi.fn()} onDismiss={vi.fn()} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('تعذّر التأكد من آخر تعديل. هل تريد التحقق مرة أخرى؟');
    expect(screen.getByRole('button', { name: 'تحقق مرة أخرى' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تجاهل' })).toBeInTheDocument();
  });
});
