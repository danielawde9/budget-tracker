import { planningRpc, type PlanningRpcClient } from '../planning-shared/rpc.js';
import {
  array, bigIntId, boolean, currency, date, enumValue, integer, minor, month,
  nullableBigIntId, nullableInteger, nullableMinor, nullableSignedIntegerText,
  nullableString, nullableUuid, object, planningMoneyInput, string, uniqueBy, uuid,
} from '../planning-shared/parse.js';
import type {
  AllocationCategoryPage,
  AllocationCategoryRow,
  AllocationGateway,
  AllocationGroupRow,
  AllocationHistoryPage,
  AllocationHistoryRow,
  AllocationMonthState,
  AllocationRowKind,
  AllocationTrend,
  AllocationTrendMonth,
  LoadCategoryPageInput,
  LoadHistoryPageInput,
  LoadMonthInput,
  LoadTrendInput,
  PlanningCommandReceipt,
  PublishMonthInput,
  PublishMonthResult,
  SaveTemplateInput,
  SaveTemplateResult,
} from './types.js';

export type AllocationDataClient = PlanningRpcClient;

const ROW_KINDS: readonly AllocationRowKind[] = ['spending', 'future', 'unmapped', 'uncategorized'];
const MAX_GROUP_ROWS = 14;
const MAX_CATEGORY_ROWS = 100;
const MAX_HISTORY_ROWS = 100;
const MAX_TREND_MONTHS = 12;

/** Converts a bigint-identifier string into the JS number RPC callers use for
 * a `bigint` SQL parameter, matching the existing Plan gateway's convention. */
function bigIntArg(value: string | null, field: string): number | null {
  if (value === null) return null;
  if (!/^(0|[1-9][0-9]{0,14})$/.test(value)) throw new Error(`Invalid ${field}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} is too large to send safely.`);
  return parsed;
}

function groupRow(value: unknown): AllocationGroupRow {
  const row = object(value);
  const rowKind = enumValue(row['rowKind'], ROW_KINDS, 'rowKind');
  const groupId = nullableUuid(row['groupId'], 'groupId');
  if ((rowKind === 'spending' || rowKind === 'future') !== (groupId !== null)) {
    throw new Error('A real group row must carry groupId, and a synthetic row must not.');
  }
  return {
    groupId,
    rowKind,
    nameEn: nullableString(row['nameEn'], 'nameEn'),
    nameAr: nullableString(row['nameAr'], 'nameAr'),
    order: nullableInteger(row['order'], 'order'),
    targetMinor: nullableMinor(row['targetMinor']),
    actualMinor: minor(row['actualMinor']),
    varianceMinor: nullableMinor(row['varianceMinor']),
    basisPoints: nullableInteger(row['basisPoints'], 'basisPoints'),
    actualShareOfIncomeBps: nullableSignedIntegerText(row['actualShareOfIncomeBps'], 'actualShareOfIncomeBps'),
    hasPlan: boolean(row['hasPlan'], 'hasPlan'),
  };
}

function parseGroups(value: unknown): readonly AllocationGroupRow[] {
  const rows = array(value, 'groups', MAX_GROUP_ROWS).map(groupRow);
  const realIds = new Set<string>();
  const syntheticKinds = new Set<AllocationRowKind>();
  for (const row of rows) {
    if (row.groupId !== null) {
      if (realIds.has(row.groupId)) throw new Error('Duplicate real group id in month state.');
      realIds.add(row.groupId);
    } else {
      if (syntheticKinds.has(row.rowKind)) throw new Error(`Duplicate synthetic ${row.rowKind} row in month state.`);
      syntheticKinds.add(row.rowKind);
    }
  }
  return rows;
}

function parseMonthState(value: unknown): AllocationMonthState {
  const row = object(value);
  return {
    snapshotId: nullableBigIntId(row['snapshotId'], 'snapshotId'),
    templateRevisionId: nullableBigIntId(row['templateRevisionId'], 'templateRevisionId'),
    incomeRevisionId: nullableBigIntId(row['incomeRevisionId'], 'incomeRevisionId'),
    hasPlan: boolean(row['hasPlan'], 'hasPlan'),
    plannedIncomeMinor: nullableMinor(row['plannedIncomeMinor']),
    actualIncomeMinor: minor(row['actualIncomeMinor']),
    expenseMinor: minor(row['expenseMinor']),
    incomeAfterSpendingMinor: minor(row['incomeAfterSpendingMinor']),
    ownDebtPaidMinor: minor(row['ownDebtPaidMinor']),
    remainingDebtMinor: minor(row['remainingDebtMinor']),
    leftToAllocateMinor: nullableMinor(row['leftToAllocateMinor']),
    childPlanChanged: boolean(row['childPlanChanged'], 'childPlanChanged'),
    asOf: string(row['asOf'], 'asOf'),
    groups: parseGroups(row['groups']),
  };
}

function categoryRow(value: unknown): AllocationCategoryRow {
  const row = object(value);
  return {
    rootId: uuid(row['rootId'], 'rootId'),
    nameEn: nullableString(row['nameEn'], 'nameEn'),
    nameAr: nullableString(row['nameAr'], 'nameAr'),
    targetMinor: minor(row['targetMinor']),
    actualMinor: minor(row['actualMinor']),
    varianceMinor: minor(row['varianceMinor']),
    hasPlan: boolean(row['hasPlan'], 'hasPlan'),
    groupId: nullableUuid(row['groupId'], 'groupId'),
  };
}

function parseCategoryPage(value: unknown): AllocationCategoryPage {
  const row = object(value);
  const rows = uniqueBy(array(row['rows'], 'rows', MAX_CATEGORY_ROWS).map(categoryRow), (item) => item.rootId, 'rootId');
  return {
    rows,
    nextRootId: nullableUuid(row['nextRootId'], 'nextRootId'),
    hasMore: boolean(row['hasMore'], 'hasMore'),
  };
}

function historyRow(value: unknown): AllocationHistoryRow {
  const row = object(value);
  return {
    snapshotId: bigIntId(row['snapshotId'], 'snapshotId'),
    createdAt: string(row['createdAt'], 'createdAt'),
    actorId: uuid(row['actorId'], 'actorId'),
    plannedIncomeMinor: minor(row['plannedIncomeMinor']),
    templateRevisionId: bigIntId(row['templateRevisionId'], 'templateRevisionId'),
  };
}

function parseHistoryPage(value: unknown): AllocationHistoryPage {
  const row = object(value);
  const rows = uniqueBy(array(row['rows'], 'rows', MAX_HISTORY_ROWS).map(historyRow), (item) => item.snapshotId, 'snapshotId');
  return {
    rows,
    nextId: nullableBigIntId(row['nextId'], 'nextId'),
    hasMore: boolean(row['hasMore'], 'hasMore'),
  };
}

function trendMonth(value: unknown): AllocationTrendMonth {
  const row = object(value);
  return {
    month: month(row['month']),
    incomeMinor: minor(row['incomeMinor']),
    expenseMinor: minor(row['expenseMinor']),
    ownDebtPaidMinor: minor(row['ownDebtPaidMinor']),
    hasPlan: boolean(row['hasPlan'], 'hasPlan'),
    plannedIncomeMinor: nullableMinor(row['plannedIncomeMinor']),
  };
}

function parseTrend(value: unknown): AllocationTrend {
  const row = object(value);
  const months = uniqueBy(array(row['months'], 'months', MAX_TREND_MONTHS).map(trendMonth), (item) => item.month, 'month');
  return { months };
}

function saveTemplateResult(value: unknown): SaveTemplateResult {
  const row = object(value);
  return { templateRevisionId: bigIntId(row['templateRevisionId'], 'templateRevisionId') };
}

function publishMonthResult(value: unknown): PublishMonthResult {
  const row = object(value);
  return {
    snapshotId: bigIntId(row['snapshotId'], 'snapshotId'),
    incomeRevisionId: bigIntId(row['incomeRevisionId'], 'incomeRevisionId'),
  };
}

function receiptResult(value: unknown): PlanningCommandReceipt | null {
  if (value === null || value === undefined) return null;
  const row = object(value);
  return {
    command: string(row['command'], 'command'),
    sequenceId: bigIntId(row['sequenceId'], 'sequenceId'),
    result: row['result'],
  };
}

function templateGroupArg(group: SaveTemplateInput['groups'][number]): Record<string, unknown> {
  return {
    id: uuid(group.id, 'group.id'),
    purpose: group.purpose,
    nameEn: group.nameEn,
    nameAr: group.nameAr,
    order: integer(group.order, 'group.order'),
    basisPoints: integer(group.basisPoints, 'group.basisPoints'),
  };
}

function rootMappingArg(mapping: SaveTemplateInput['rootMappings'][number]): Record<string, unknown> {
  return { categoryId: uuid(mapping.categoryId, 'rootMapping.categoryId'), groupId: uuid(mapping.groupId, 'rootMapping.groupId') };
}

function rootTargetArg(target: PublishMonthInput['rootTargets'][number]): Record<string, unknown> {
  return {
    categoryId: uuid(target.categoryId, 'rootTarget.categoryId'),
    amountMinor: planningMoneyInput(target.amountMinor),
    expectedRevisionId: target.expectedRevisionId,
  };
}

export function createSupabaseAllocationGateway(client: AllocationDataClient): AllocationGateway {
  return {
    async loadMonth(input: LoadMonthInput, signal?: AbortSignal) {
      const data = await planningRpc(client, 'allocation_month_state', {
        p_space_id: input.spaceId,
        p_month: month(input.month),
        p_currency: currency(input.currency),
        p_snapshot_id: bigIntArg(input.snapshotId, 'snapshotId'),
      }, signal);
      return parseMonthState(data);
    },

    async loadCategoryPage(input: LoadCategoryPageInput, signal?: AbortSignal) {
      const data = await planningRpc(client, 'allocation_category_page', {
        p_space_id: input.spaceId,
        p_month: month(input.month),
        p_currency: currency(input.currency),
        p_snapshot_id: bigIntArg(input.snapshotId, 'snapshotId'),
        p_group_id: input.groupId,
        p_after_root_id: input.afterRootId,
        p_limit: input.limit,
      }, signal);
      return parseCategoryPage(data);
    },

    async loadHistoryPage(input: LoadHistoryPageInput, signal?: AbortSignal) {
      const data = await planningRpc(client, 'allocation_history_page', {
        p_space_id: input.spaceId,
        p_month: month(input.month),
        p_currency: currency(input.currency),
        p_before_id: bigIntArg(input.beforeId, 'beforeId'),
        p_limit: input.limit,
      }, signal);
      return parseHistoryPage(data);
    },

    async loadTrend(input: LoadTrendInput, signal?: AbortSignal) {
      const data = await planningRpc(client, 'allocation_trend', {
        p_space_id: input.spaceId,
        p_currency: currency(input.currency),
        p_first_month: month(input.firstMonth),
        p_month_count: input.monthCount,
      }, signal);
      return parseTrend(data);
    },

    async saveTemplate(input: SaveTemplateInput): Promise<SaveTemplateResult> {
      if (input.groups.length > 12) throw new Error('Too many allocation groups.');
      if (input.rootMappings.length > 200) throw new Error('Too many root mappings.');
      const data = await planningRpc(client, 'save_allocation_template', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_currency: currency(input.currency),
        p_expected_revision_id: bigIntArg(input.expectedRevisionId, 'expectedRevisionId'),
        p_groups: input.groups.map(templateGroupArg),
        p_root_mappings: input.rootMappings.map(rootMappingArg),
      });
      return saveTemplateResult(data);
    },

    async publishMonth(input: PublishMonthInput): Promise<PublishMonthResult> {
      if (input.rootTargets.length > 200) throw new Error('Too many root targets.');
      const data = await planningRpc(client, 'publish_allocation_month', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_month: month(input.month),
        p_currency: currency(input.currency),
        p_expected_snapshot_id: bigIntArg(input.expectedSnapshotId, 'expectedSnapshotId'),
        p_template_revision_id: bigIntArg(input.templateRevisionId, 'templateRevisionId'),
        p_expected_income_revision_id: bigIntArg(input.expectedIncomeRevisionId, 'expectedIncomeRevisionId'),
        p_income_minor: planningMoneyInput(input.incomeMinor),
        p_root_targets: input.rootTargets.map(rootTargetArg),
        p_loan_group_id: input.loanGroupId,
      });
      return publishMonthResult(data);
    },

    async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
      const data = await planningRpc(client, 'find_planning_command', { p_space_id: spaceId, p_request_id: requestId });
      return receiptResult(data);
    },
  };
}
