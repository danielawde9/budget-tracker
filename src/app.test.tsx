import { render, screen } from '@testing-library/react';
import { App } from './app.js';

describe('App', () => {
  it('provides the bilingual Loans workspace shell', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Loans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'العربية' })).toBeInTheDocument();
  });
});
