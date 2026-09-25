import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header.js';

describe('PageHeader', () => {
  it('renders the title as the page h1', () => {
    render(<PageHeader title="Journal" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Journal' })).toBeInTheDocument();
  });

  it('renders the optional subtitle and omits it when not provided', () => {
    const { container, rerender } = render(<PageHeader title="Plan" subtitle="September 2026" />);
    expect(screen.getByText('September 2026')).toBeInTheDocument();

    rerender(<PageHeader title="Plan" />);
    expect(screen.queryByText('September 2026')).not.toBeInTheDocument();
    expect(container.querySelector('.cr-helper')).toBeNull();
  });

  it('renders actions in the actions slot and omits the slot when not provided', () => {
    const { container, rerender } = render(
      <PageHeader title="Wallets" actions={<button type="button">New wallet</button>} />,
    );
    expect(screen.getByRole('button', { name: 'New wallet' })).toBeInTheDocument();

    rerender(<PageHeader title="Wallets" />);
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument();
    expect(container.querySelector('.cr-header-actions')).toBeNull();
  });
});
