import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { AutoMaterializeBanner } from './auto-materialize-banner.js';
import { classifyRecurringError } from './errors.js';

// The classified form of the plain `{ code, message }` object the gateway
// rethrows when generation hits the 500-occurrence cap -- final review I1.
const CAP_EXCEEDED = classifyRecurringError(
  postgrestRejection('P0001', 'materializing this range would create more than 500 new occurrences'),
);

describe('AutoMaterializeBanner', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<AutoMaterializeBanner locale="en" state={{ status: 'idle' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while running', () => {
    const { container } = render(<AutoMaterializeBanner locale="en" state={{ status: 'running' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the English failure message as an alert, from the classified error', () => {
    render(<AutoMaterializeBanner locale="en" state={{ status: 'failed', error: CAP_EXCEEDED }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Upcoming bills couldn't be generated: That date range would generate too many occurrences at once.");
    expect(alert).not.toHaveTextContent('[object Object]');
  });

  it('shows the Arabic failure message as an alert, Arabic copy only', () => {
    render(<AutoMaterializeBanner locale="ar" state={{ status: 'failed', error: CAP_EXCEEDED }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('تعذر توليد الفواتير القادمة: سيؤدي هذا النطاق الزمني إلى إنشاء عدد كبير جدًا من الدفعات دفعة واحدة.');
    expect(alert.textContent).not.toMatch(/[A-Za-z]/);
  });
});
