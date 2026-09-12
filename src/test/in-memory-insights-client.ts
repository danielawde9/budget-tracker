import type { CategoryBudgetRow, InsightsClient, WalletActivityRow } from '../features/insights/types.js';
import type { Currency } from '../features/loans/types.js';

export class InMemoryInsightsClient implements InsightsClient {
  activity: WalletActivityRow[] = [];
  budgetRows: CategoryBudgetRow[] = [];
  calls: Array<{ name: string; input: unknown }> = [];
  error: Error | null = null;

  async walletActivity(input: {
    spaceId: string; fromDate: string; toDate: string;
    walletId?: string | null; currency?: Currency | null; limit?: number;
  }): Promise<readonly WalletActivityRow[]> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'walletActivity', input });
    return this.activity;
  }
  async categoryActualVsBudget(spaceId: string, month: string): Promise<readonly CategoryBudgetRow[]> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'categoryActualVsBudget', input: { spaceId, month } });
    return this.budgetRows;
  }
}
