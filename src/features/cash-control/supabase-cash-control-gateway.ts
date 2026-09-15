import { planningRpc, type PlanningRpcClient } from '../planning-shared/rpc.js';
import {
  array, boolean, currency, date, enumValue, integer, minor, nullableBigIntId, nullableMinor,
  nullableString, object, string, uniqueBy, uuid,
} from '../planning-shared/parse.js';
import type {
  AvailableCashGroupRow,
  AvailableCashSummary,
  CashControlGateway,
  CashOutlook,
  CashOutlookDay,
  CashOutlookScenario,
  CashOutlookState,
  CashSummaryState,
  LoadAvailableInput,
  LoadOutlookInput,
} from './types.js';

export type CashControlDataClient = PlanningRpcClient;

const SUMMARY_STATES: readonly CashSummaryState[] = ['ready', 'unplanned', 'incomplete'];
const OUTLOOK_STATES: readonly CashOutlookState[] = ['ready', 'incomplete'];
const OUTLOOK_SCENARIOS: readonly CashOutlookScenario[] = ['expected', 'no_future_income'];

const MAX_GROUP_ROWS = 12;
const MAX_OUTLOOK_DAYS = 90;

function groupRow(value: unknown): AvailableCashGroupRow {
  const row = object(value);
  return {
    id: uuid(row['id'], 'id'),
    nameEn: nullableString(row['nameEn'], 'nameEn'),
    nameAr: nullableString(row['nameAr'], 'nameAr'),
    budgetRemainingMinor: minor(row['budgetRemainingMinor']),
    unpaidBillsMinor: nullableMinor(row['unpaidBillsMinor']),
    goalOverlapMinor: nullableMinor(row['goalOverlapMinor']),
    commitmentMinor: minor(row['commitmentMinor']),
  };
}

function parseAvailableCashSummary(value: unknown): AvailableCashSummary {
  const row = object(value);
  const groups = uniqueBy(
    array(row['groups'], 'groups', MAX_GROUP_ROWS).map(groupRow),
    (item) => item.id,
    'groups',
  );
  return {
    currency: currency(row['currency']),
    asOf: date(row['asOf']),
    state: enumValue(row['state'], SUMMARY_STATES, 'state'),
    needsReview: boolean(row['needsReview'], 'needsReview'),
    snapshotId: nullableBigIntId(row['snapshotId'], 'snapshotId'),
    cashMinor: minor(row['cashMinor']),
    goalClaimsMinor: minor(row['goalClaimsMinor']),
    expenseCommitmentsMinor: nullableMinor(row['expenseCommitmentsMinor']),
    debtCommitmentsMinor: nullableMinor(row['debtCommitmentsMinor']),
    goalTopupsMinor: nullableMinor(row['goalTopupsMinor']),
    futureHeadroomMinor: nullableMinor(row['futureHeadroomMinor']),
    availableMinor: nullableMinor(row['availableMinor']),
    deficitMinor: nullableMinor(row['deficitMinor']),
    spendableMinor: nullableMinor(row['spendableMinor']),
    dailyExtraGuideMinor: nullableMinor(row['dailyExtraGuideMinor']),
    daysRemaining: integer(row['daysRemaining'], 'daysRemaining'),
    receivedIncomeMinor: minor(row['receivedIncomeMinor']),
    ordinarySpendingMinor: minor(row['ordinarySpendingMinor']),
    incomeMinusSpendingMinor: minor(row['incomeMinusSpendingMinor']),
    uncategorizedMinor: minor(row['uncategorizedMinor']),
    unmaterializedCount: integer(row['unmaterializedCount'], 'unmaterializedCount'),
    groups,
  };
}

function outlookDay(value: unknown): CashOutlookDay {
  const row = object(value);
  return {
    date: date(row['date']),
    openingCashMinor: minor(row['openingCashMinor']),
    expectedIncomeMinor: minor(row['expectedIncomeMinor']),
    expectedOutflowMinor: minor(row['expectedOutflowMinor']),
    closingCashMinor: minor(row['closingCashMinor']),
  };
}

function parseCashOutlook(value: unknown): CashOutlook {
  const row = object(value);
  const days = uniqueBy(
    array(row['days'], 'days', MAX_OUTLOOK_DAYS).map(outlookDay),
    (item) => item.date,
    'days',
  );
  const firstNegativeDate = row['firstNegativeDate'];
  return {
    currency: currency(row['currency']),
    startDate: date(row['startDate']),
    scenario: enumValue(row['scenario'], OUTLOOK_SCENARIOS, 'scenario'),
    assumption: string(row['assumption'], 'assumption'),
    days,
    firstNegativeDate: firstNegativeDate === null || firstNegativeDate === undefined ? null : date(firstNegativeDate),
    state: enumValue(row['state'], OUTLOOK_STATES, 'state'),
    overdueCount: integer(row['overdueCount'], 'overdueCount'),
    overdueMinor: minor(row['overdueMinor']),
  };
}

/** Client-side mirror of `cash_outlook`'s own `p_days between 1 and 90`
 * guard -- rejected before ever calling the transport, the same way the
 * recurring gateway rejects an incomplete page cursor up front. */
function requireDaysInRange(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_OUTLOOK_DAYS) {
    throw new Error('days must be an integer between 1 and 90.');
  }
}

export function createSupabaseCashControlGateway(client: CashControlDataClient): CashControlGateway {
  return {
    async loadAvailable(input: LoadAvailableInput, signal?: AbortSignal): Promise<AvailableCashSummary> {
      const data = await planningRpc(client, 'available_cash_summary', {
        p_space_id: input.spaceId,
        p_currency: currency(input.currency),
        p_as_of_date: date(input.asOfDate),
      }, signal);
      return parseAvailableCashSummary(data);
    },

    async loadOutlook(input: LoadOutlookInput, signal?: AbortSignal): Promise<CashOutlook> {
      requireDaysInRange(input.days);
      const data = await planningRpc(client, 'cash_outlook', {
        p_space_id: input.spaceId,
        p_currency: currency(input.currency),
        p_start_date: date(input.startDate),
        p_days: input.days,
        p_scenario: enumValue(input.scenario, OUTLOOK_SCENARIOS, 'scenario'),
      }, signal);
      return parseCashOutlook(data);
    },
  };
}
