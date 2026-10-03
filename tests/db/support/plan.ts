import type pg from 'pg';
import type { BudgetHarness } from './budget.ts';

export interface PlanItemPayload {
  itemId: string | null;
  kind: 'spending' | 'reserve' | 'goal' | 'loan_payment';
  nameEn: string | null;
  nameAr: string | null;
  monthlyMinor: string;
  targetMinor: string | null;
  targetDate: string | null;
  walletId: string | null;
}

export interface PlanGroupPayload {
  groupId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  percentBps: number;
  flexNameEn?: string | null;
  flexNameAr?: string | null;
  items: PlanItemPayload[];
}

export interface PlanPayload {
  expectedIncomeMinor: string;
  groups: PlanGroupPayload[];
  archiveItemIds: string[];
  archiveGroupIds: string[];
}

export function monthOf(day: string, offset = 0): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

/** The plan in effect for `month`, shaped as a save_plan payload. */
export async function currentPlan(pool: pg.Pool, spaceId: string, month: string): Promise<{ revision: number; payload: PlanPayload }> {
  const version = await pool.query<{ id: string; revision: number; income: string }>(
    `select id, revision, expected_income_minor::text as income from budget.plan_versions
      where space_id = $1 and effective_month <= $2::date order by effective_month desc limit 1`,
    [spaceId, month],
  );
  const head = version.rows[0];
  if (!head) throw new Error('No plan version');
  const groups = await pool.query<{ group_id: string; name_en: string | null; name_ar: string | null; percent_bps: number }>(
    `select g.id as group_id, g.name_en, g.name_ar, vg.percent_bps
       from budget.plan_version_groups vg join budget.plan_groups g on g.id = vg.group_id
      where vg.version_id = $1 order by vg.position`,
    [head.id],
  );
  const items = await pool.query<{ group_id: string; item_id: string; kind: PlanItemPayload['kind']; name_en: string | null; name_ar: string | null; monthly: string; target: string | null; target_date: string | null; wallet_id: string | null }>(
    `select vi.group_id, i.id as item_id, i.kind, i.name_en, i.name_ar, vi.monthly_minor::text as monthly,
            i.target_minor::text as target, i.target_date::text as target_date, i.wallet_id
       from budget.plan_version_items vi join budget.items i on i.id = vi.item_id
      where vi.version_id = $1 and i.archived_at is null order by vi.position`,
    [head.id],
  );
  return {
    revision: head.revision,
    payload: {
      expectedIncomeMinor: head.income,
      groups: groups.rows.map((group) => ({
        groupId: group.group_id,
        nameEn: group.name_en,
        nameAr: group.name_ar,
        percentBps: group.percent_bps,
        items: items.rows
          .filter((item) => item.group_id === group.group_id)
          .map((item) => ({
            itemId: item.item_id,
            kind: item.kind,
            nameEn: item.name_en,
            nameAr: item.name_ar,
            monthlyMinor: item.monthly,
            targetMinor: item.target,
            targetDate: item.target_date,
            walletId: item.wallet_id,
          })),
      })),
      archiveItemIds: [],
      archiveGroupIds: [],
    },
  };
}

export function newItem(kind: PlanItemPayload['kind'], nameEn: string, monthly: bigint, extra: Partial<PlanItemPayload> = {}): PlanItemPayload {
  return { itemId: null, kind, nameEn, nameAr: null, monthlyMinor: monthly.toString(), targetMinor: null, targetDate: null, walletId: null, ...extra };
}

export function setMonthly(payload: PlanPayload, nameEn: string, monthly: bigint): void {
  for (const group of payload.groups) {
    for (const item of group.items) {
      if (item.nameEn === nameEn) {
        item.monthlyMinor = monthly.toString();
        return;
      }
    }
  }
  throw new Error(`No planned item ${nameEn}`);
}

export function groupNamed(payload: PlanPayload, nameEn: string): PlanGroupPayload {
  const group = payload.groups.find((candidate) => candidate.nameEn === nameEn);
  if (!group) throw new Error(`No group ${nameEn}`);
  return group;
}

/** Applies the owner's worked-example plan ($4,110) to the current month. */
export async function applyExamplePlan(h: BudgetHarness, month = monthOf(h.today)): Promise<void> {
  const { revision, payload } = await currentPlan(h.pool, h.spaceId, month);
  setMonthly(payload, 'Rent', 100000n);
  setMonthly(payload, 'Bills', 25000n);
  setMonthly(payload, 'Groceries', 60000n);
  setMonthly(payload, 'Transport', 25000n);
  setMonthly(payload, 'Insurance reserve', 15000n);
  groupNamed(payload, 'Essentials').items.push(newItem('loan_payment', 'Car loan payment', 20000n));
  setMonthly(payload, 'Eating out', 12000n);
  setMonthly(payload, 'Fun', 8550n);
  groupNamed(payload, 'Short-term goals').items.push(
    newItem('goal', 'Holiday', 40000n, { targetMinor: '250000' }),
    newItem('goal', 'Laptop', 21650n, { targetMinor: '130000' }),
  );
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload });
}

export interface PlanLine {
  readonly group: string;
  readonly item: string;
  readonly planned: string;
}

export async function planLines(pool: pg.Pool, spaceId: string, month: string): Promise<PlanLine[]> {
  const result = await pool.query<{ group_name: string; item_name: string; planned: string }>(
    `select g.name_en as group_name, coalesce(i.name_en, i.name_ar) as item_name, l.planned_minor::text as planned
       from budget.plan_lines($1, $2::date) l
       join budget.plan_groups g on g.id = l.group_id
       join budget.items i on i.id = l.item_id
      order by l.group_position, l.item_order`,
    [spaceId, month],
  );
  return result.rows.map((row) => ({ group: row.group_name, item: row.item_name, planned: row.planned }));
}
