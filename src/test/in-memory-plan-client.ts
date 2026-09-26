import type { BudgetCategoryRow, BudgetCurrencySummary, PlanClient, SetCategoryTargetInput, SetIncomePlanInput } from '../features/plan/types.js';
import type { Currency } from '../features/loans/types.js';

export class InMemoryPlanClient implements PlanClient {
  summaries: BudgetCurrencySummary[] = [];
  categoryRows: BudgetCategoryRow[] = [];
  calls: Array<{ name: string; input: unknown }> = [];
  error: Error | null = null;
  private revision = 0;

  async loadCurrencySummary(): Promise<readonly BudgetCurrencySummary[]> {
    if (this.error) throw this.error;
    return this.summaries;
  }
  async loadCategoryRows(_spaceId: string, _month: string, currency: Currency): Promise<readonly BudgetCategoryRow[]> {
    if (this.error) throw this.error;
    return this.categoryRows.filter((row) => row.currency === currency);
  }
  async setIncomePlan(input: SetIncomePlanInput): Promise<{ revisionId: string }> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'setIncomePlan', input });
    return { revisionId: String(++this.revision) };
  }
  async setCategoryTarget(input: SetCategoryTargetInput): Promise<{ revisionId: string }> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'setCategoryTarget', input });
    return { revisionId: String(++this.revision) };
  }
}
