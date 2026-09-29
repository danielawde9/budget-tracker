import type { Currency } from '../loans/types.js';
import type { CategoriesGateway } from '../categories/types.js';
import type { WalletsGateway } from '../wallets/types.js';
import { isAmbiguousTransportFailure } from './errors.js';
import type { GoalsGateway, GoalDefinitionInput, GoalMilestoneInput, GoalMilestoneRow, GoalSummary } from './types.js';

/**
 * The guided "Buy it" flow on an active purchase goal: one guided action that
 * records the categorized expense, links it to the goal, and closes the goal,
 * using only commands that already exist (no new SQL or RPC). It wires three
 * existing operations in sequence:
 *
 *   1. `record_categorized_financial_event` -- the command the Wallets/Record
 *      flow already calls for a categorized expense.
 *   2. `link_goal_purchase` -- the goals purchase link, reconciled by request
 *      id instead of a pasted expense UUID.
 *   3. `revise_goal_plan` with `state: 'closed'` -- the goal's existing close
 *      path.
 *
 * Every step is idempotent on its own `request_id`, and this module ALWAYS
 * drives them with a fixed, caller-owned request id (`BuyItRequestIds`). If a
 * step's transport result is ambiguous it reconciles first (a request-id
 * lookup, plus a read-only `find_planning_command` receipt for the goals
 * commands) and only then falls back to an explicit, same-request-id retry --
 * so a retry or an ambiguous transport failure can never double-post the
 * expense or double-link the purchase.
 *
 * The function is deliberately gateway-agnostic: `BuyItCommands` is the exact
 * set of commands and lookups the flow needs, so it can be unit-tested without
 * React or Supabase, and adapted from the real gateways with `buyItCommands`.
 */

/** The three fixed, caller-owned request ids for one purchase attempt. They
 * are generated once and reused for every retry of that same attempt. */
export interface BuyItRequestIds {
  readonly record: string;
  readonly link: string;
  readonly close: string;
}

/** Everything a single purchase attempt needs. Built once from the goal's
 * current detail snapshot; a retry reuses the exact same value. */
export interface BuyItRequest {
  readonly goalId: string;
  readonly expectedHead: string;
  readonly expectedRevisionId: string;
  readonly definition: GoalDefinitionInput;
  readonly milestones: readonly GoalMilestoneInput[];
  readonly walletId: string;
  readonly categoryId: string;
  /** Positive integer-minor amount; the flow posts it as an expense outflow. */
  readonly amountMinor: string;
  /** `YYYY-MM-DD`, on or before the space's "today". */
  readonly effectiveDate: string;
}

/** The existing commands, as the flow needs them. Each returns whatever the
 * gateway returns; the flow only needs success/failure and the two ids. */
export interface BuyItCommands {
  /** Wallets/categories: record a categorized expense for a fixed request id. */
  recordCategorizedExpense(input: {
    requestId: string; effectiveDate: string; walletId: string; amountMinor: string; categoryId: string;
  }): Promise<{ eventId?: string }>;
  /** Wallets read-only: resolve a recorded event's id by its request id. */
  findEventIdByRequestId(requestId: string): Promise<string | null>;
  /** Goals: link the expense to the goal for a fixed request id. */
  linkPurchase(input: {
    requestId: string; expenseEventId: string; goalId: string; amountMinor: string; expectedHead: string;
  }): Promise<unknown>;
  /** Goals read-only: the reconciling receipt for a goals command. */
  findCommandReceipt(requestId: string): Promise<{ command: string } | null>;
  /** Goals: close the goal through the existing revise path. */
  revise(input: {
    requestId: string; goalId: string; expectedRevisionId: string;
    definition: GoalDefinitionInput; milestones: readonly GoalMilestoneInput[]; state: 'closed';
  }): Promise<unknown>;
}

export type BuyItStepStatus = 'success' | 'ambiguous' | 'failed' | 'not-attempted';

export interface BuyItStep {
  readonly status: BuyItStepStatus;
  /** True when the command's own response was lost but its effect was confirmed
   * by a request-id lookup or a command receipt. */
  readonly reconciled: boolean;
  /** The raw cause message for a failed/ambiguous step (null otherwise). The
   * UI localizes it the same way the goals dialogs do. */
  readonly message: string | null;
}

export interface BuyItOutcome {
  readonly record: BuyItStep;
  readonly link: BuyItStep;
  readonly close: BuyItStep;
  /** Non-null once the expense is known to exist (record succeeded). */
  readonly expenseEventId: string | null;
}

const LINK_COMMAND = 'link_goal_purchase';
const CLOSE_COMMAND = 'revise_goal_plan';

const notAttempted: BuyItStep = { status: 'not-attempted', reconciled: false, message: null };

function successStep(reconciled: boolean): BuyItStep {
  return { status: 'success', reconciled, message: null };
}

function ambiguousStep(cause: unknown): BuyItStep {
  return { status: 'ambiguous', reconciled: false, message: errorMessage(cause) };
}

function failedStep(cause: unknown): BuyItStep {
  return { status: 'failed', reconciled: false, message: errorMessage(cause) };
}

function errorMessage(cause: unknown): string | null {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as { message?: unknown }).message === 'string') {
    const message = (cause as { message: string }).message;
    return message.trim() ? message : null;
  }
  return null;
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A reconciling lookup must never turn an ambiguous command into a crash: a
 * lookup failure leaves the step ambiguous (safe -- the retry reuses the same
 * request id), and its own message is preserved when the command had none. */
async function safeLookup(
  lookup: () => Promise<string | null>,
): Promise<{ found: string | null; error: unknown | null }> {
  try {
    return { found: await lookup(), error: null };
  } catch (cause) {
    return { found: null, error: cause };
  }
}

async function safeReceipt(
  lookup: () => Promise<{ command: string } | null>,
): Promise<{ command: string | null; error: unknown | null }> {
  try {
    const receipt = await lookup();
    return { command: receipt?.command ?? null, error: null };
  } catch (cause) {
    return { command: null, error: cause };
  }
}

async function runRecordStep(
  commands: BuyItCommands,
  request: BuyItRequest,
  requestId: string,
): Promise<{ step: BuyItStep; eventId: string | null }> {
  try {
    const result = await commands.recordCategorizedExpense({
      requestId,
      effectiveDate: request.effectiveDate,
      walletId: request.walletId,
      amountMinor: request.amountMinor,
      categoryId: request.categoryId,
    });
    // A record command that answers without an id is not trusted: fall back to
    // the same request-id lookup a lost response would use.
    const eventId = nonEmpty(result.eventId) ?? (await safeLookup(() => commands.findEventIdByRequestId(requestId))).found;
    if (!eventId) return { step: ambiguousStep(null), eventId: null };
    return { step: successStep(false), eventId };
  } catch (cause) {
    if (!isAmbiguousTransportFailure(cause)) return { step: failedStep(cause), eventId: null };
    const { found, error } = await safeLookup(() => commands.findEventIdByRequestId(requestId));
    if (found) return { step: successStep(true), eventId: found };
    return { step: ambiguousStep(error ?? cause), eventId: null };
  }
}

async function runGoalsStep(
  run: () => Promise<unknown>,
  reconcile: () => Promise<{ command: string | null; error: unknown | null }>,
  expectedCommand: string,
): Promise<BuyItStep> {
  try {
    await run();
    return successStep(false);
  } catch (cause) {
    if (!isAmbiguousTransportFailure(cause)) return failedStep(cause);
    const { command, error } = await reconcile();
    if (command === expectedCommand) return successStep(true);
    return ambiguousStep(error ?? cause);
  }
}

/**
 * Runs (or re-runs) one purchase attempt with the given fixed request ids.
 * Re-running with the same ids is safe and idempotent: each command replays on
 * its request id server-side, and any already-committed step is confirmed by a
 * lookup rather than repeated. Returns each step's honest status so the caller
 * can say exactly what was recorded, linked and closed -- and, when a later
 * step fails, that the money is already posted and what remains.
 */
export async function runBuyIt(
  commands: BuyItCommands,
  request: BuyItRequest,
  requestIds: BuyItRequestIds,
): Promise<BuyItOutcome> {
  const record = await runRecordStep(commands, request, requestIds.record);
  if (record.step.status !== 'success' || !record.eventId) {
    return { record: record.step, link: notAttempted, close: notAttempted, expenseEventId: null };
  }

  const eventId = record.eventId;
  const link = await runGoalsStep(
    () => commands.linkPurchase({
      requestId: requestIds.link,
      expenseEventId: eventId,
      goalId: request.goalId,
      amountMinor: request.amountMinor,
      expectedHead: request.expectedHead,
    }),
    () => safeReceipt(() => commands.findCommandReceipt(requestIds.link)),
    LINK_COMMAND,
  );
  if (link.status !== 'success') {
    return { record: record.step, link, close: notAttempted, expenseEventId: eventId };
  }

  const close = await runGoalsStep(
    () => commands.revise({
      requestId: requestIds.close,
      goalId: request.goalId,
      expectedRevisionId: request.expectedRevisionId,
      definition: request.definition,
      milestones: request.milestones,
      state: 'closed',
    }),
    () => safeReceipt(() => commands.findCommandReceipt(requestIds.close)),
    CLOSE_COMMAND,
  );

  return { record: record.step, link, close, expenseEventId: eventId };
}

/**
 * The buy-it environment threaded from the Control Room into the goal detail:
 * the raw gateways (the wallets/categories recording commands, and the goals
 * commands) plus the reference lists the dialog needs, all read-only here.
 * `src/features/wallets/**` stays untouched -- this bundle only *calls* the
 * commands it already exposes.
 */
export interface GoalBuyItEnvironment {
  readonly spaceId: string;
  /** The space-clock "today" (`YYYY-MM-DD`) -- never the browser's own date. */
  readonly today: string;
  readonly wallets: WalletsGateway;
  readonly categories: CategoriesGateway;
  readonly goals: GoalsGateway;
  readonly walletOptions: readonly { id: string; name: string; currency: string }[];
  readonly categoryOptions: readonly { id: string; nameEn: string | null; nameAr: string | null }[];
}

/** Adapts the real gateways to the flow's command surface, freezing the
 * space id and the expense sign convention in one place. */
export function buyItCommands(environment: GoalBuyItEnvironment): BuyItCommands {
  return {
    recordCategorizedExpense: (input) => environment.categories.recordCategorizedEvent({
      spaceId: environment.spaceId,
      requestId: input.requestId,
      kind: 'expense',
      effectiveDate: input.effectiveDate,
      movements: [{ walletId: input.walletId, amountMinor: `-${input.amountMinor}` }],
      categoryId: input.categoryId,
    }),
    findEventIdByRequestId: async (requestId) => {
      const event = await environment.wallets.findEventByRequestId(environment.spaceId, requestId);
      return event?.id ?? null;
    },
    linkPurchase: (input) => environment.goals.linkPurchase({
      spaceId: environment.spaceId,
      requestId: input.requestId,
      expenseEventId: input.expenseEventId,
      lines: [{ goalId: input.goalId, amountMinor: input.amountMinor, expectedHead: input.expectedHead }],
    }),
    findCommandReceipt: async (requestId) => {
      const receipt = await environment.goals.findCommand(environment.spaceId, requestId);
      return receipt ? { command: receipt.command } : null;
    },
    revise: (input) => environment.goals.revise({
      spaceId: environment.spaceId,
      requestId: input.requestId,
      goalId: input.goalId,
      expectedRevisionId: input.expectedRevisionId,
      definition: input.definition,
      milestones: input.milestones,
      state: 'closed',
    }),
  };
}

/**
 * Reconstructs the full revise input from a goal detail snapshot, exactly as
 * the detail page's own pause/resume/close path already does: `goal_detail`'s
 * summary does not carry `note`, the goal's base monthly amount or `priority`,
 * so these three are re-entered fresh (see `docs/decisions.md`), and the
 * close revision states the person is not editing them here.
 */
export function goalRevisionFromDetail(
  summary: GoalSummary,
  milestones: readonly GoalMilestoneRow[],
): { expectedRevisionId: string; definition: GoalDefinitionInput; milestones: GoalMilestoneInput[] } {
  return {
    expectedRevisionId: summary.revisionId,
    definition: {
      kind: summary.kind,
      currency: summary.currency,
      nameEn: summary.nameEn,
      nameAr: summary.nameAr,
      note: null,
      targetMinor: summary.targetMinor,
      deadline: summary.dueDate,
      contributionMode: summary.dueDate !== null ? 'by_deadline' : 'manual_monthly',
      monthlyAmountMinor: summary.dueDate !== null ? null : (summary.monthlyTargetMinor ?? '0'),
      priority: 0,
    },
    milestones: milestones.map((row) => ({
      id: row.id,
      kind: row.kind,
      labelEn: row.labelEn,
      labelAr: row.labelAr,
      thresholdMinor: row.thresholdMinor,
      dueDate: row.dueDate,
      ordinal: row.ordinal,
    })),
  };
}
