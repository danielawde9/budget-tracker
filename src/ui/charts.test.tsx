import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { LineChart } from './charts.tsx';

it('lets keyboard and pointer users inspect exact line chart values', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  render(<LineChart label="Savings" points={[{ label: 'Sep', value: 12345n }, { label: 'Oct', value: -500n }]} format={value => String(value / 100n)} formatValue={value => `$${Number(value) / 100}`} selectedIndex={1} onSelect={select} />);
  const september = screen.getByRole('button', { name: 'Sep: $123.45' });
  await user.hover(september);
  expect(select).toHaveBeenLastCalledWith(0);
  await user.tab();
  await user.keyboard('{End}');
  expect(screen.getByRole('button', { name: 'Oct: $-5' })).toHaveFocus();
  expect(select).toHaveBeenLastCalledWith(1);
});
