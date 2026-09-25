import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AutoMaterializeBanner } from './auto-materialize-banner.js';

describe('AutoMaterializeBanner', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<AutoMaterializeBanner locale="en" state={{ status: 'idle' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while running', () => {
    const { container } = render(<AutoMaterializeBanner locale="en" state={{ status: 'running' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the English failure message as an alert', () => {
    render(<AutoMaterializeBanner locale="en" state={{ status: 'failed', message: 'materialize_cap_exceeded' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Upcoming bills couldn't be generated: materialize_cap_exceeded");
  });

  it('shows the Arabic failure message as an alert', () => {
    render(<AutoMaterializeBanner locale="ar" state={{ status: 'failed', message: 'materialize_cap_exceeded' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('تعذر توليد الفواتير القادمة: materialize_cap_exceeded');
  });
});
