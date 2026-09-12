import type { BudgetCategoryPage, BudgetCurrencySummary, PlanClient, SetCategoryTargetInput, SetIncomePlanInput } from '../features/plan/types.js';

export class InMemoryPlanClient implements PlanClient {
  summaries: BudgetCurrencySummary[] = [];
  categoryPage: BudgetCategoryPage = { rows: [], nextCursor: null };
  calls: Array<{ name: string; input: unknown }> = [];
  error: Error | null = null;
  private revision = 0;

  async loadCurrencySummary(): Promise<readonly BudgetCurrencySummary[]> {
    if (this.error) throw this.error;
    return this.summaries;
  }
  async loadCategoryPage(): Promise<BudgetCategoryPage> {
    if (this.error) throw this.error;
    return this.categoryPage;
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
