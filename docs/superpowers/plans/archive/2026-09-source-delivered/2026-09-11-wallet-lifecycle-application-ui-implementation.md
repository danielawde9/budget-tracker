# Wallet Lifecycle Application/UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rename, archive, and restore to the Wallets UI on top of the already-merged `rename_wallet` / `archive_wallet` / `restore_wallet` / `get_wallet_command_result` database commands, with undo-gating for archived-wallet entries and one localized Loans error case.

**Architecture:** Extend the typed `WalletsGateway` and `useWallets` hook with the same request-idempotent, ambiguous-retry pattern every other wallet command already uses; add three new single-purpose dialogs mirroring the existing Category/Undo dialogs; wire them into `WalletsPage` behind a disclosed "Archived wallets" section and per-wallet action buttons; add one wallet-scoped error-classification module mirroring `categories/errors.ts`; add one new Loans error case for corrections blocked by an archived wallet.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, React 19, TypeScript strict, Vite, Supabase JS, Vitest, Testing Library, Playwright, semantic HTML, logical CSS properties.

**Spec:** `docs/superpowers/specs/2026-09-11-wallet-lifecycle-application-ui-design.md` (milestone 2, Application/UI). Milestone 1 (database) is merged on `main`; its contract (`docs/superpowers/specs/2026-09-11-wallet-rename-archive-design.md`) is unchanged by this plan.

## Global Constraints

- **Scope:** application/UI only. No `supabase/migrations/**`, no ops files, no hosted/live command, no push, no deploy.
- **No optimistic UI.** Every command refreshes the full snapshot on success, matching every existing wallet command.
- **Request-idempotent everywhere.** Each new command generates one browser request ID; an ambiguous transport failure reconciles via `getWalletCommandResult(spaceId, requestId)`, never blind-retries.
- **Wallet names render inside `<bdi>`** everywhere, including inside button accessible names, matching `Correct ${label}` → now applied as `Rename ${wallet.name}`, `Archive ${wallet.name}`, `Restore ${wallet.name}`.
- **Every string ships in English and Arabic.** No English fallback text reaches an Arabic render.
- **Archive dialog at a non-zero balance offers no archive control at all** — not a disabled button, no element with an accessible submit role.
- **Restore dialog has a single Restore button and no checkbox.**
- **Archived wallets render in a `<details>` section, absent entirely when there are none.**
- **TypeScript strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), NodeNext `.js`-suffixed relative imports.
- **Every task ends green:** `pnpm exec tsc --noEmit` exits 0 and the focused test file(s) pass before committing. `WalletsGateway`, `JournalMovement`, and `LoanErrorCode` are interfaces every implementer must satisfy — a task that extends one of them updates every implementer and every test double in the same commit, never split across tasks.
- **Git:** work on branch `claude/wallet-lifecycle-ui` created from `main` (which already has the milestone-1 migration). Conventional commits ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Never stage `.DS_Store`, `.claude-flow/`, `.swarm/`, `artifacts/.DS_Store`, `docs/.DS_Store`, `supabase/.temp/`, or `.superpowers/`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/features/wallets/errors.ts` (create) | Classifies wallet command rejections into typed, localized copy — mirrors `src/features/categories/errors.ts`. |
| `src/features/wallets/errors.test.ts` (create) | Proves every classification and both locales. |
| `src/features/wallets/types.ts` (modify) | New input/result types; `WalletsSnapshot.archivedWallets`; `JournalMovement.walletArchived`; `WalletsGateway` gains four methods. |
| `src/features/wallets/supabase-wallets-gateway.ts` (modify) | Implements the four new gateway methods; partitions active/archived wallets from one read; sets `walletArchived` per movement. |
| `src/features/wallets/supabase-wallets-gateway.test.ts` (modify) | RPC-boundary ratchet extended; new command and partition tests. |
| `src/test/in-memory-wallets-gateway.ts` (modify) | Test double implementing the four new methods for `wallets-page.test.tsx`. |
| `src/features/wallets/use-wallets.ts` (modify) | Three new hook commands; ambiguous reconciliation via `getWalletCommandResult`; `archivedWallets` passthrough. |
| `src/features/wallets/use-wallets.test.tsx` (modify) | Gateway mock extended; new hook-level command and reconciliation tests. |
| `src/features/wallets/rename-wallet-dialog.tsx` (create) | Rename dialog — mirrors `wallet-dialog.tsx`. |
| `src/features/wallets/rename-wallet-dialog.test.tsx` (create) | |
| `src/features/wallets/archive-wallet-dialog.tsx` (create) | Archive dialog with the zero/non-zero balance split — mirrors `categories/archive-category-dialog.tsx`. |
| `src/features/wallets/archive-wallet-dialog.test.tsx` (create) | |
| `src/features/wallets/restore-wallet-dialog.tsx` (create) | Restore dialog, single button, no checkbox. |
| `src/features/wallets/restore-wallet-dialog.test.tsx` (create) | |
| `src/features/wallets/wallets-page.tsx` (modify) | Rename/Archive buttons per active wallet; Archived wallets `<details>` section; undo-gating; three dialogs wired in. |
| `src/features/wallets/wallets-page.test.tsx` (modify) | Existing no-archive-button ratchet updated to the new reality; new coverage for the spec's UI behaviors. |
| `src/styles.css` (modify) | Two rules: the disclosure summary and the per-row footer that holds the new action buttons. |
| `src/features/loans/types.ts` (modify) | `LoanErrorCode` gains `'archived_wallet'`. |
| `src/features/loans/errors.ts` (modify) | One new classification case. |
| `src/features/loans/errors.test.ts` (modify) | Covers it. |
| `src/features/loans/loan-dialogs.tsx` (modify) | `ErrorNotice`'s Arabic table gains the new code (required for `arabic[error.code]` to stay total). |
| `e2e/fixtures/loans.ts` (modify) | Fixture RPC handlers for the four new commands; `protectedMutationNames` extended. |
| `e2e/wallets.visual.spec.ts` (modify) | Rename, archive-blocked, archive/restore round-trip, and Arabic mobile scenarios. |

---

### Task 1: Wallet error classification module

**Files:**
- Create: `src/features/wallets/errors.ts`
- Test: `src/features/wallets/errors.test.ts`

**Interfaces:**
- Produces: `WalletErrorCode`, `WalletErrorView { code; message; recovery }`, `classifyWalletError(cause: unknown): WalletErrorView`, `localizeWalletError(error: WalletErrorView, locale: 'en' | 'ar'): WalletErrorView`.

- [ ] **Step 1: Write the failing test**

Create `src/features/wallets/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { classifyWalletError, localizeWalletError } from './errors.js';

describe('wallet errors', () => {
  it.each([
    [{ code: '42501', message: 'an active space membership is required' }, 'missing_membership'],
    [{ code: 'P0001', message: 'the wallet already has this name' }, 'already_has_name'],
    [{ code: 'P0001', message: 'the wallet name must be 1 to 120 characters' }, 'invalid_name'],
    [{ code: 'P0001', message: 'the wallet is already archived' }, 'already_archived'],
    [{ code: 'P0001', message: 'the wallet is not archived' }, 'not_archived'],
    [{ code: 'P0001', message: 'the wallet is archived' }, 'wallet_archived'],
    [{ code: 'P0001', message: 'the wallet balance must be zero to archive' }, 'non_zero_balance'],
    [{ code: 'P0001', message: 'request ID was already used with different data' }, 'request_collision'],
  ] as const)('maps %s to %s without exposing database internals', (cause, code) => {
    const result = classifyWalletError(cause);
    expect(result.code).toBe(code);
    expect(result.message).not.toMatch(/wallet_command_requests|fingerprint|constraint/i);
    expect(result.recovery.length).toBeGreaterThan(0);
  });

  it('fails closed with safe copy for an unknown rejection', () => {
    expect(classifyWalletError(new Error('wallet_command_requests_wallet_fkey violated'))).toEqual({
      code: 'unknown',
      message: 'This wallet request was not accepted.',
      recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
    });
  });

  it.each([
    'missing_membership',
    'already_has_name',
    'invalid_name',
    'wallet_archived',
    'already_archived',
    'not_archived',
    'non_zero_balance',
    'request_collision',
    'unknown',
  ] as const)('localizes %s without reusing English fallback copy', (code) => {
    const result = localizeWalletError({ code, message: 'English message', recovery: 'English recovery' }, 'ar');
    expect(result.code).toBe(code);
    expect(result.message).toMatch(/[؀-ۿ]/);
    expect(result.recovery).toMatch(/[؀-ۿ]/);
    expect(`${result.message} ${result.recovery}`).not.toContain('English');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/wallets/errors.test.ts --config vitest.ui.config.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/wallets/errors.ts`:

```ts
export type WalletErrorCode =
  | 'missing_membership'
  | 'already_has_name'
  | 'invalid_name'
  | 'wallet_archived'
  | 'already_archived'
  | 'not_archived'
  | 'non_zero_balance'
  | 'request_collision'
  | 'unknown';

export interface WalletErrorView {
  code: WalletErrorCode;
  message: string;
  recovery: string;
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

function errorLike(cause: unknown): ErrorLike {
  return cause && typeof cause === 'object' ? cause as ErrorLike : {};
}

export function classifyWalletError(cause: unknown): WalletErrorView {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';

  if (code === '42501' || /active space membership|permission denied/i.test(message)) {
    return {
      code: 'missing_membership',
      message: 'You no longer have access to this space.',
      recovery: 'Refresh the visible spaces, then choose one you can still access.',
    };
  }
  if (/the wallet already has this name/i.test(message)) {
    return {
      code: 'already_has_name',
      message: 'This wallet already has this name.',
      recovery: 'Choose a different name, or close without saving.',
    };
  }
  if (/the wallet name must be 1 to 120 characters/i.test(message)) {
    return {
      code: 'invalid_name',
      message: 'Enter a name between 1 and 120 characters.',
      recovery: 'Shorten or complete the name and try again.',
    };
  }
  if (/the wallet is already archived/i.test(message)) {
    return {
      code: 'already_archived',
      message: 'This wallet is already archived.',
      recovery: 'Refresh the wallet list to see its current state.',
    };
  }
  if (/the wallet is not archived/i.test(message)) {
    return {
      code: 'not_archived',
      message: 'This wallet is not archived.',
      recovery: 'Refresh the wallet list to see its current state.',
    };
  }
  if (/the wallet is archived/i.test(message)) {
    return {
      code: 'wallet_archived',
      message: 'This wallet is archived.',
      recovery: 'Restore it first, then try again.',
    };
  }
  if (/the wallet balance must be zero to archive/i.test(message)) {
    return {
      code: 'non_zero_balance',
      message: 'This wallet still has money in it.',
      recovery: 'Undo or move its transactions until the balance is 0.',
    };
  }
  if (/request ID was already used with different data/i.test(message)) {
    return {
      code: 'request_collision',
      message: 'This request no longer matches the original details.',
      recovery: 'Review the current values and submit them as a new request.',
    };
  }
  return {
    code: 'unknown',
    message: 'This wallet request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<WalletErrorCode, Pick<WalletErrorView, 'message' | 'recovery'>> = {
  missing_membership: {
    message: 'لم يعد لديك وصول إلى هذه المساحة.',
    recovery: 'حدّث المساحات المتاحة، ثم اختر مساحة لا يزال بإمكانك الوصول إليها.',
  },
  already_has_name: {
    message: 'تحمل هذه المحفظة هذا الاسم بالفعل.',
    recovery: 'اختر اسمًا مختلفًا، أو أغلق دون حفظ.',
  },
  invalid_name: {
    message: 'أدخل اسمًا بين حرف واحد و120 حرفًا.',
    recovery: 'قصّر الاسم أو أكمله وحاول مجددًا.',
  },
  wallet_archived: {
    message: 'هذه المحفظة مؤرشفة.',
    recovery: 'استعدها أولًا، ثم حاول مجددًا.',
  },
  already_archived: {
    message: 'هذه المحفظة مؤرشفة بالفعل.',
    recovery: 'حدّث قائمة المحافظ لعرض حالتها الحالية.',
  },
  not_archived: {
    message: 'هذه المحفظة غير مؤرشفة.',
    recovery: 'حدّث قائمة المحافظ لعرض حالتها الحالية.',
  },
  non_zero_balance: {
    message: 'لا تزال هذه المحفظة تحتوي على مال.',
    recovery: 'تراجع عن معاملاتها أو انقلها حتى يصبح الرصيد صفرًا.',
  },
  request_collision: {
    message: 'لم يعد هذا الطلب يطابق التفاصيل الأصلية.',
    recovery: 'راجع القيم الحالية وأرسلها كطلب جديد.',
  },
  unknown: {
    message: 'لم يتم قبول طلب المحفظة.',
    recovery: 'راجع التفاصيل وحاول مجددًا. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeWalletError(error: WalletErrorView, locale: 'en' | 'ar'): WalletErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/wallets/errors.test.ts --config vitest.ui.config.ts`
Expected: PASS, 19 tests (8 classification + 1 fallback + 9 localization + 1 describe overhead is not a test — total is 8 + 1 + 9 = 18; confirm the printed count matches 18).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/wallets/errors.ts src/features/wallets/errors.test.ts
git commit -m "feat(wallets): add wallet command error classification" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Branch `claude/wallet-lifecycle-ui` should already exist, created from `main` before this task starts. If it doesn't, `git switch -c claude/wallet-lifecycle-ui` first.)

---

### Task 2: Extend wallet types and both gateway implementations

**Files:**
- Modify: `src/features/wallets/types.ts`
- Modify: `src/features/wallets/supabase-wallets-gateway.ts`
- Modify: `src/features/wallets/supabase-wallets-gateway.test.ts`
- Modify: `src/test/in-memory-wallets-gateway.ts`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `RenameWalletInput { spaceId; requestId; walletId; name }`, `WalletLifecycleInput { spaceId; requestId; walletId }`, `WalletCommandKind = 'rename_wallet' | 'archive_wallet' | 'restore_wallet'`, `WalletCommandRecord { commandKind: WalletCommandKind; walletId: string }`, `WalletsSnapshot.archivedWallets: readonly WalletProjection[]`, `JournalMovement.walletArchived: boolean`, `WalletsGateway.renameWallet/archiveWallet/restoreWallet/getWalletCommandResult`. Task 3 (hook) and every dialog consume these.

- [ ] **Step 1: Write the failing gateway tests**

In `src/features/wallets/supabase-wallets-gateway.test.ts`, change line 76's expected movement to include the new field:

```ts
    expect(snapshot.history.events[0]?.movements).toEqual([{ walletId: 'wallet-1', walletName: 'Daily', currency: 'USD', amountMinor: '1250', walletArchived: false }]);
```

Change the ratchet test's expected RPC name array:

```ts
  it('ratchets browser writes and mutation RPCs to the approved boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/wallets/supabase-wallets-gateway.ts'), 'utf8');
    expect(source).not.toMatch(/\.(insert|update|delete|upsert|truncate)\s*\(/);
    const rpcNames = [...source.matchAll(/runCommand\('([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(rpcNames)].sort()).toEqual([
      'archive_wallet', 'create_wallet', 'record_financial_event', 'rename_wallet', 'restore_wallet', 'reverse_financial_event',
    ]);
  });
```

Append these new tests to the end of the `describe` block, before its closing `});`:

```ts
  it('partitions active and archived wallets from one wallet read', async () => {
    const { client } = clientWith({
      wallets: [
        { id: 'wallet-1', space_id: 'space-1', name: 'Daily', currency: 'USD', archived_at: null },
        { id: 'wallet-2', space_id: 'space-1', name: 'Old envelope', currency: 'USD', archived_at: '2026-09-10T11:00:00Z' },
        { id: 'wallet-3', space_id: 'space-1', name: 'Older envelope', currency: 'LBP', archived_at: '2026-09-05T09:00:00Z' },
      ],
      wallet_balances: [
        { wallet_id: 'wallet-1', space_id: 'space-1', currency: 'USD', amount_minor: '1250' },
        { wallet_id: 'wallet-2', space_id: 'space-1', currency: 'USD', amount_minor: '0' },
        { wallet_id: 'wallet-3', space_id: 'space-1', currency: 'LBP', amount_minor: '0' },
      ],
    });
    const snapshot = await createSupabaseWalletsGateway(client).loadSnapshot('space-1');

    expect(snapshot.wallets.map((wallet) => wallet.id)).toEqual(['wallet-1']);
    expect(snapshot.archivedWallets.map((wallet) => wallet.id)).toEqual(['wallet-2', 'wallet-3']);
    expect(snapshot.archivedWallets[0]?.archivedAt).toBe('2026-09-10T11:00:00Z');
  });

  it('marks a movement into an archived wallet', async () => {
    const { client } = clientWith({
      wallets: [{ id: 'wallet-1', space_id: 'space-1', name: 'Old envelope', currency: 'USD', archived_at: '2026-09-10T11:00:00Z' }],
      wallet_balances: [],
      wallet_movements: [{ event_id: 'event-1', wallet_id: 'wallet-1', amount_minor: '500' }],
    });
    const snapshot = await createSupabaseWalletsGateway(client).loadSnapshot('space-1');
    expect(snapshot.history.events[0]?.movements[0]?.walletArchived).toBe(true);
  });

  it('sends exact approved RPC payloads for rename, archive, and restore', async () => {
    const { client, rpcCalls } = clientWith();
    const gateway = createSupabaseWalletsGateway(client);
    await gateway.renameWallet({ spaceId: 'space-1', requestId: 'request-1', walletId: 'wallet-1', name: '  Travel cash  ' });
    await gateway.archiveWallet({ spaceId: 'space-1', requestId: 'request-2', walletId: 'wallet-1' });
    await gateway.restoreWallet({ spaceId: 'space-1', requestId: 'request-3', walletId: 'wallet-1' });

    expect(rpcCalls).toEqual([
      { name: 'rename_wallet', args: { p_space_id: 'space-1', p_request_id: 'request-1', p_wallet_id: 'wallet-1', p_name: 'Travel cash' } },
      { name: 'archive_wallet', args: { p_space_id: 'space-1', p_request_id: 'request-2', p_wallet_id: 'wallet-1' } },
      { name: 'restore_wallet', args: { p_space_id: 'space-1', p_request_id: 'request-3', p_wallet_id: 'wallet-1' } },
    ]);
  });

  it('returns each new wallet command\'s normalized id', async () => {
    const { client } = clientWith();
    const gateway = createSupabaseWalletsGateway(client);
    await expect(gateway.renameWallet({ spaceId: 'space-1', requestId: 'request-1', walletId: 'wallet-1', name: 'Travel cash' }))
      .resolves.toEqual({ id: walletCommandId });
    await expect(gateway.archiveWallet({ spaceId: 'space-1', requestId: 'request-2', walletId: 'wallet-1' }))
      .resolves.toEqual({ id: walletCommandId });
    await expect(gateway.restoreWallet({ spaceId: 'space-1', requestId: 'request-3', walletId: 'wallet-1' }))
      .resolves.toEqual({ id: walletCommandId });
  });

  it.each([
    ['null data', null, /exactly one result/],
    ['zero rows', [], /exactly one result/],
    ['a null row', [null], /invalid row/],
    ['a missing identifier', [{}], /missing id/],
    ['a malformed identifier', [{ id: 'wallet-new' }], /invalid id/],
  ] as const)('rejects %s for every new wallet command before success handling', async (_label, response, message) => {
    const commands = [
      { rpc: 'rename_wallet', invoke: (gateway: ReturnType<typeof createSupabaseWalletsGateway>) => gateway.renameWallet({ spaceId: 'space-1', requestId: 'request-1', walletId: 'wallet-1', name: 'Travel cash' }) },
      { rpc: 'archive_wallet', invoke: (gateway: ReturnType<typeof createSupabaseWalletsGateway>) => gateway.archiveWallet({ spaceId: 'space-1', requestId: 'request-2', walletId: 'wallet-1' }) },
      { rpc: 'restore_wallet', invoke: (gateway: ReturnType<typeof createSupabaseWalletsGateway>) => gateway.restoreWallet({ spaceId: 'space-1', requestId: 'request-3', walletId: 'wallet-1' }) },
    ] as const;
    for (const command of commands) {
      const { client } = clientWith({}, { [command.rpc]: response });
      await expect(command.invoke(createSupabaseWalletsGateway(client))).rejects.toThrow(message);
    }
  });

  it('parses a present wallet command result and returns null for an empty one', async () => {
    const { client, rpcCalls } = clientWith({}, {
      get_wallet_command_result: [{ command_kind: 'archive_wallet', wallet_id: 'wallet-1' }],
    });
    const gateway = createSupabaseWalletsGateway(client);
    await expect(gateway.getWalletCommandResult('space-1', 'request-1'))
      .resolves.toEqual({ commandKind: 'archive_wallet', walletId: 'wallet-1' });
    expect(rpcCalls).toContainEqual({ name: 'get_wallet_command_result', args: { p_space_id: 'space-1', p_request_id: 'request-1' } });

    const { client: emptyClient } = clientWith({}, { get_wallet_command_result: [] });
    await expect(createSupabaseWalletsGateway(emptyClient).getWalletCommandResult('space-1', 'request-2')).resolves.toBeNull();
  });

  it('rejects an unsupported wallet command kind', async () => {
    const { client } = clientWith({}, { get_wallet_command_result: [{ command_kind: 'create_wallet', wallet_id: 'wallet-1' }] });
    await expect(createSupabaseWalletsGateway(client).getWalletCommandResult('space-1', 'request-1'))
      .rejects.toThrow(/unsupported wallet command kind/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/wallets/supabase-wallets-gateway.test.ts --config vitest.ui.config.ts`
Expected: FAIL — the movement/ratchet tests fail on the new expectations; the new tests fail with `gateway.renameWallet is not a function` (and similar) or a TypeScript compile error from the missing properties, since `WalletsSnapshot`/`WalletsGateway` do not yet declare them.

- [ ] **Step 3: Extend the types**

In `src/features/wallets/types.ts`, change `WalletsSnapshot`:

```ts
export interface WalletsSnapshot {
  wallets: readonly WalletProjection[];
  archivedWallets: readonly WalletProjection[];
  history: JournalPage;
}
```

Change `JournalMovement`:

```ts
export interface JournalMovement {
  walletId: string;
  walletName: string;
  currency: Currency;
  amountMinor: string;
  walletArchived: boolean;
}
```

Add, directly below `CreateWalletInput`:

```ts
export interface RenameWalletInput {
  spaceId: string;
  requestId: string;
  walletId: string;
  name: string;
}

export interface WalletLifecycleInput {
  spaceId: string;
  requestId: string;
  walletId: string;
}

export type WalletCommandKind = 'rename_wallet' | 'archive_wallet' | 'restore_wallet';

export interface WalletCommandRecord {
  commandKind: WalletCommandKind;
  walletId: string;
}
```

Change `WalletsGateway`:

```ts
export interface WalletsGateway {
  loadSnapshot(spaceId: string): Promise<WalletsSnapshot>;
  loadHistoryPage(spaceId: string, cursor: string): Promise<JournalPage>;
  createWallet(input: CreateWalletInput): Promise<CommandResult>;
  renameWallet(input: RenameWalletInput): Promise<CommandResult>;
  archiveWallet(input: WalletLifecycleInput): Promise<CommandResult>;
  restoreWallet(input: WalletLifecycleInput): Promise<CommandResult>;
  getWalletCommandResult(spaceId: string, requestId: string): Promise<WalletCommandRecord | null>;
  recordEvent(input: RecordEventInput): Promise<CommandResult>;
  reverseEvent(input: ReverseEventInput): Promise<CommandResult>;
  findEventByRequestId(spaceId: string, requestId: string): Promise<JournalEvent | null>;
}
```

- [ ] **Step 4: Implement the real gateway**

In `src/features/wallets/supabase-wallets-gateway.ts`, add to the import list from `./types.js`:

```ts
  RenameWalletInput,
  WalletCommandRecord,
  WalletLifecycleInput,
```

Change `MutationName`:

```ts
type MutationName = 'create_wallet' | 'rename_wallet' | 'archive_wallet' | 'restore_wallet' | 'record_financial_event' | 'reverse_financial_event';
```

Change `commandResult`:

```ts
function commandResult(data: unknown[] | null, name: MutationName): CommandResult {
  if (data?.length !== 1) throw new Error('The wallet command must return exactly one result.');
  const id = uuidValue(asRow(data[0]), 'id');
  return name === 'create_wallet' || name === 'rename_wallet' || name === 'archive_wallet' || name === 'restore_wallet'
    ? { id }
    : { eventId: id };
}
```

In `composeEvents`, change the movement construction:

```ts
      const movement: JournalMovement = {
        walletId,
        walletName: wallet.name,
        currency: wallet.currency,
        amountMinor: minorValue(value, 'amount_minor'),
        walletArchived: wallet.archivedAt !== null,
      };
```

Change `loadSnapshot`:

```ts
    async loadSnapshot(spaceId) {
      const [walletRows, balanceRows] = await Promise.all([
        loadWalletRows(spaceId),
        rows(
          client.from('wallet_balances').select('wallet_id,space_id,currency,amount_minor')
            .eq('space_id', spaceId).limit(WALLET_READ_LIMIT + 1),
          'Wallet balances',
          WALLET_READ_LIMIT,
        ),
      ]);
      const walletById = walletMap(walletRows, spaceId);
      for (const value of balanceRows) {
        if (textValue(value, 'space_id') !== spaceId) throw new Error('A wallet balance escaped the selected space.');
        const wallet = walletById.get(textValue(value, 'wallet_id'));
        if (!wallet || wallet.currency !== currencyValue(value, 'currency')) {
          throw new Error('A wallet balance does not match its wallet.');
        }
        walletById.set(wallet.id, { ...wallet, balanceMinor: minorValue(value, 'amount_minor') });
      }
      const allWallets = [...walletById.values()];
      return {
        wallets: allWallets.filter((wallet) => wallet.archivedAt === null),
        archivedWallets: allWallets
          .filter((wallet) => wallet.archivedAt !== null)
          .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? '')),
        history: await loadPage(spaceId, 0, walletById),
      };
    },
```

Add three command functions and the reconciliation read directly after `createWallet(...)` inside the returned object (before `recordEvent(...)`):

```ts
    renameWallet(input: RenameWalletInput) {
      return runCommand('rename_wallet', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_wallet_id: input.walletId,
        p_name: input.name.trim(),
      });
    },

    archiveWallet(input: WalletLifecycleInput) {
      return runCommand('archive_wallet', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_wallet_id: input.walletId,
      });
    },

    restoreWallet(input: WalletLifecycleInput) {
      return runCommand('restore_wallet', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_wallet_id: input.walletId,
      });
    },

    async getWalletCommandResult(spaceId, requestId): Promise<WalletCommandRecord | null> {
      const result = await client.rpc('get_wallet_command_result', { p_space_id: spaceId, p_request_id: requestId });
      if (result.error) throw result.error;
      const values = result.data ?? [];
      if (values.length > 1) throw new Error('Wallet command reconciliation must return at most one result.');
      if (values.length === 0) return null;
      const row = asRow(values[0]);
      const commandKind = textValue(row, 'command_kind');
      if (commandKind !== 'rename_wallet' && commandKind !== 'archive_wallet' && commandKind !== 'restore_wallet') {
        throw new Error('The database returned an unsupported wallet command kind.');
      }
      return { commandKind, walletId: uuidValue(row, 'wallet_id') };
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/wallets/supabase-wallets-gateway.test.ts --config vitest.ui.config.ts`
Expected: PASS, 15 tests (7 existing + 8 new).

- [ ] **Step 6: Update the in-memory test double**

Replace the full content of `src/test/in-memory-wallets-gateway.ts`:

```ts
import type {
  CreateWalletInput,
  JournalEvent,
  JournalPage,
  RecordEventInput,
  RenameWalletInput,
  ReverseEventInput,
  WalletCommandRecord,
  WalletLifecycleInput,
  WalletProjection,
  WalletsGateway,
  WalletsSnapshot,
} from '../features/wallets/types.js';

export const walletFixtures: readonly WalletProjection[] = [
  { id: 'wallet-usd-1', spaceId: 'personal-space', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '125050' },
  { id: 'wallet-usd-2', spaceId: 'personal-space', name: 'Reserve USD', currency: 'USD', archivedAt: null, balanceMinor: '50000' },
  { id: 'wallet-lbp-1', spaceId: 'personal-space', name: 'Daily LBP', currency: 'LBP', archivedAt: null, balanceMinor: '2500000' },
];

export const journalFixtures: readonly JournalEvent[] = [
  {
    id: 'event-income', spaceId: 'personal-space', requestId: 'request-income', kind: 'income',
    effectiveDate: '2026-09-07', createdAt: '2026-09-07T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: false,
    movements: [{ walletId: 'wallet-usd-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '25050', walletArchived: false }],
  },
  {
    id: 'event-loan', spaceId: 'personal-space', requestId: 'request-loan', kind: 'loan_lend',
    effectiveDate: '2026-09-06', createdAt: '2026-09-06T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: true,
    movements: [{ walletId: 'wallet-usd-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-50000', walletArchived: false }],
  },
];

export class InMemoryWalletsGateway implements WalletsGateway {
  wallets = [...walletFixtures];
  archivedWallets: WalletProjection[] = [];
  events = [...journalFixtures];
  error: Error | null = null;
  calls: Array<{ name: string; input: unknown }> = [];
  walletCommandResults = new Map<string, WalletCommandRecord>();

  private failIfNeeded() {
    if (this.error) throw this.error;
  }

  async loadSnapshot(spaceId: string): Promise<WalletsSnapshot> {
    this.calls.push({ name: 'loadSnapshot', input: spaceId });
    this.failIfNeeded();
    return {
      wallets: this.wallets.filter((wallet) => wallet.spaceId === spaceId),
      archivedWallets: this.archivedWallets.filter((wallet) => wallet.spaceId === spaceId),
      history: { events: this.events.filter((event) => event.spaceId === spaceId), nextCursor: null },
    };
  }

  async loadHistoryPage(spaceId: string, cursor: string): Promise<JournalPage> {
    this.calls.push({ name: 'loadHistoryPage', input: { spaceId, cursor } });
    this.failIfNeeded();
    return { events: [], nextCursor: null };
  }

  async createWallet(input: CreateWalletInput) {
    this.calls.push({ name: 'createWallet', input });
    this.failIfNeeded();
    const id = `wallet-${this.wallets.length + this.archivedWallets.length + 1}`;
    this.wallets = [...this.wallets, { id, ...input, archivedAt: null, balanceMinor: '0' }];
    return { id };
  }

  async renameWallet(input: RenameWalletInput) {
    this.calls.push({ name: 'renameWallet', input });
    this.failIfNeeded();
    this.wallets = this.wallets.map((wallet) => wallet.id === input.walletId ? { ...wallet, name: input.name } : wallet);
    this.walletCommandResults.set(input.requestId, { commandKind: 'rename_wallet', walletId: input.walletId });
    return { id: input.walletId };
  }

  async archiveWallet(input: WalletLifecycleInput) {
    this.calls.push({ name: 'archiveWallet', input });
    this.failIfNeeded();
    const wallet = this.wallets.find((item) => item.id === input.walletId);
    if (wallet) {
      this.wallets = this.wallets.filter((item) => item.id !== input.walletId);
      this.archivedWallets = [...this.archivedWallets, { ...wallet, archivedAt: '2026-09-11T12:00:00Z' }];
    }
    this.walletCommandResults.set(input.requestId, { commandKind: 'archive_wallet', walletId: input.walletId });
    return { id: input.walletId };
  }

  async restoreWallet(input: WalletLifecycleInput) {
    this.calls.push({ name: 'restoreWallet', input });
    this.failIfNeeded();
    const wallet = this.archivedWallets.find((item) => item.id === input.walletId);
    if (wallet) {
      this.archivedWallets = this.archivedWallets.filter((item) => item.id !== input.walletId);
      this.wallets = [...this.wallets, { ...wallet, archivedAt: null }];
    }
    this.walletCommandResults.set(input.requestId, { commandKind: 'restore_wallet', walletId: input.walletId });
    return { id: input.walletId };
  }

  async getWalletCommandResult(_spaceId: string, requestId: string) {
    this.calls.push({ name: 'getWalletCommandResult', input: requestId });
    return this.walletCommandResults.get(requestId) ?? null;
  }

  async recordEvent(input: RecordEventInput) {
    this.calls.push({ name: 'recordEvent', input });
    this.failIfNeeded();
    return { eventId: 'event-new' };
  }

  async reverseEvent(input: ReverseEventInput) {
    this.calls.push({ name: 'reverseEvent', input });
    this.failIfNeeded();
    return { eventId: 'reversal-new' };
  }

  async findEventByRequestId(spaceId: string, requestId: string) {
    this.calls.push({ name: 'findEventByRequestId', input: { spaceId, requestId } });
    return this.events.find((event) => event.spaceId === spaceId && event.requestId === requestId) ?? null;
  }
}
```

- [ ] **Step 7: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0. (This will still list errors in `use-wallets.ts`/`use-wallets.test.tsx`/`wallets-page.tsx` if they exist yet — they don't; those are unmodified and only *consume* `WalletsGateway`, so a `WalletsGateway`-typed value must supply the four new methods everywhere one is constructed. Confirm no such errors appear; if any do, they mean another file builds a `WalletsGateway` object literal this task missed — find it with `grep -rn "WalletsGateway = {" src` and add the four methods there too before proceeding.)

- [ ] **Step 8: Run the full UI suite**

Run: `pnpm test:ui`
Expected: PASS, all files (the in-memory gateway change must not break any existing `wallets-page.test.tsx` test, since every added field/method is additive and every existing fixture still satisfies its own assertions).

- [ ] **Step 9: Commit**

```bash
git add src/features/wallets/types.ts src/features/wallets/supabase-wallets-gateway.ts \
  src/features/wallets/supabase-wallets-gateway.test.ts src/test/in-memory-wallets-gateway.ts
git commit -m "feat(wallets): add rename, archive, restore to the wallets gateway" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extend the wallets hook

**Files:**
- Modify: `src/features/wallets/use-wallets.ts`
- Modify: `src/features/wallets/use-wallets.test.tsx`

**Interfaces:**
- Consumes: `RenameWalletInput`, `WalletLifecycleInput`, `WalletCommandRecord` (Task 2); `gateway.renameWallet/archiveWallet/restoreWallet/getWalletCommandResult` (Task 2).
- Produces: hook return gains `archivedWallets: readonly WalletProjection[]`, `renameWallet(input: { walletId: string; name: string }): Promise<CommandOutcome>`, `archiveWallet(input: { walletId: string }): Promise<CommandOutcome>`, `restoreWallet(input: { walletId: string }): Promise<CommandOutcome>`. `useWallets`'s `ambiguous.kind` gains `'rename' | 'archive' | 'restore'`. Tasks 4–7 consume these.

- [ ] **Step 1: Write the failing hook tests**

In `src/features/wallets/use-wallets.test.tsx`, extend the `gateway()` helper's default object (add after `createWallet`, before `recordEvent`):

```ts
    renameWallet: vi.fn(async () => ({ id: 'wallet-1' })),
    archiveWallet: vi.fn(async () => ({ id: 'wallet-1' })),
    restoreWallet: vi.fn(async () => ({ id: 'wallet-1' })),
    getWalletCommandResult: vi.fn(async () => null),
```

Append these tests before the final `});` that closes the `describe('useWallets', ...)` block:

```ts
  it.each(['renameWallet', 'archiveWallet', 'restoreWallet'] as const)('posts %s with a fresh request ID and refreshes on success', async (method) => {
    const service = gateway();
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const draft = method === 'renameWallet' ? { walletId: 'wallet-1', name: 'Travel cash' } : { walletId: 'wallet-1' };
    await act(async () => {
      await expect(result.current[method](draft as never)).resolves.toEqual({ status: 'success', reconciled: false });
    });

    const spy = service[method] as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledWith({ ...draft, spaceId: 'space-1', requestId: 'request-fixed' });
    expect(service.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reconciles an ambiguous rename via the wallet command result before offering retry', async () => {
    const renameWallet = vi.fn(async () => { throw new Error('Connection timeout'); });
    const getWalletCommandResult = vi.fn(async () => ({ commandKind: 'rename_wallet' as const, walletId: 'wallet-1' }));
    const service = gateway({ renameWallet, getWalletCommandResult });
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.renameWallet({ walletId: 'wallet-1', name: 'Travel cash' }))
        .resolves.toEqual({ status: 'success', reconciled: true });
    });

    expect(getWalletCommandResult).toHaveBeenCalledWith('space-1', 'request-fixed');
    expect(result.current.ambiguous).toBeNull();
    expect(renameWallet).toHaveBeenCalledOnce();
  });

  it('offers an explicit identical retry when the wallet command result does not match', async () => {
    const archiveWallet = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce({ id: 'wallet-1' });
    const getWalletCommandResult = vi.fn(async () => null);
    const service = gateway({ archiveWallet, getWalletCommandResult });
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.archiveWallet({ walletId: 'wallet-1' })).resolves.toEqual({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.ambiguous).toEqual({ kind: 'archive', requestId: 'request-fixed' });

    await act(async () => { await result.current.retryAmbiguous(); });
    expect(archiveWallet).toHaveBeenCalledTimes(2);
    expect(archiveWallet.mock.calls[0]?.[0]).toEqual(archiveWallet.mock.calls[1]?.[0]);
  });

  it('retains the identical restore command when its reconciliation read itself fails', async () => {
    const restoreWallet = vi.fn(async () => { throw new Error('Connection timeout'); });
    const getWalletCommandResult = vi.fn(async () => { throw new Error('Reconciliation read failed'); });
    const service = gateway({ restoreWallet, getWalletCommandResult });
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.restoreWallet({ walletId: 'wallet-1' })).rejects.toThrow('Reconciliation read failed');
    });
    expect(result.current.ambiguous).toEqual({ kind: 'restore', requestId: 'request-fixed' });

    await act(async () => { await result.current.retryAmbiguous(); });
    expect(restoreWallet).toHaveBeenCalledTimes(2);
  });

  it('passes archived wallets through from the loaded snapshot', async () => {
    const archived = { id: 'wallet-old', spaceId: 'space-1', name: 'Old envelope', currency: 'USD' as const, archivedAt: '2026-09-10T00:00:00Z', balanceMinor: '0' };
    const service = gateway({ loadSnapshot: vi.fn(async () => ({ ...emptySnapshot, archivedWallets: [archived] })) });
    const { result } = renderHook(() => useWallets(service, 'space-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.archivedWallets).toEqual([archived]);
  });
```

Add `archivedWallets: []` to both `emptySnapshot` and `walletSnapshot` fixture constants at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/wallets/use-wallets.test.tsx --config vitest.ui.config.ts`
Expected: FAIL — `result.current.renameWallet is not a function` (and the equivalents), plus the two fixture constants failing a `WalletsSnapshot` type check until the hook and its types (already extended in Task 2) are wired together here.

- [ ] **Step 3: Implement the hook changes**

In `src/features/wallets/use-wallets.ts`, add to the import from `./types.js`:

```ts
  RenameWalletInput,
  WalletCommandRecord,
  WalletLifecycleInput,
```

Change `WalletsView`:

```ts
interface WalletsView {
  loadedSpaceId: string;
  status: WalletsStatus;
  wallets: readonly WalletProjection[];
  archivedWallets: readonly WalletProjection[];
  events: readonly JournalEvent[];
  nextCursor: string | null;
  error: string | null;
  categoryError: CategoryErrorView | null;
}
```

Change `emptyView`:

```ts
const emptyView = (spaceId: string): WalletsView => ({
  loadedSpaceId: spaceId,
  status: 'loading',
  wallets: [],
  archivedWallets: [],
  events: [],
  nextCursor: null,
  error: null,
  categoryError: null,
});
```

Change `applySnapshot`:

```ts
  const applySnapshot = useCallback((targetSpaceId: string, snapshot: WalletsSnapshot) => {
    setHistoryPaginationError(null);
    setView({
      loadedSpaceId: targetSpaceId,
      status: 'ready',
      wallets: snapshot.wallets,
      archivedWallets: snapshot.archivedWallets,
      events: snapshot.history.events,
      nextCursor: snapshot.history.nextCursor,
      error: null,
      categoryError: null,
    });
  }, []);
```

Change `RetryCommand`, adding three variants and their draft types directly above it:

```ts
type RenameDraft = Omit<RenameWalletInput, 'spaceId' | 'requestId'>;
type LifecycleDraft = Omit<WalletLifecycleInput, 'spaceId' | 'requestId'>;
type RetryCommand =
  | { kind: 'record'; requestId: string; input: RecordEventInput; categoryId: string | null }
  | { kind: 'reverse'; requestId: string; input: ReverseEventInput }
  | { kind: 'rename'; requestId: string; input: RenameWalletInput }
  | { kind: 'archive'; requestId: string; input: WalletLifecycleInput }
  | { kind: 'restore'; requestId: string; input: WalletLifecycleInput };
```

Replace the whole `reconcileCommand` function with:

```ts
  const walletLifecycleKind = (kind: 'rename' | 'archive' | 'restore') =>
    kind === 'rename' ? 'rename_wallet' as const : kind === 'archive' ? 'archive_wallet' as const : 'restore_wallet' as const;

  const reconcileCommand = useCallback(async (
    command: RetryCommand,
  ): Promise<CommandOutcome> => {
    const categorized = command.kind === 'record' && command.categoryId !== null;
    if (command.kind === 'rename' || command.kind === 'archive' || command.kind === 'restore') {
      try {
        if (command.kind === 'rename') await gateway.renameWallet(command.input);
        else if (command.kind === 'archive') await gateway.archiveWallet(command.input);
        else await gateway.restoreWallet(command.input);
        const refreshed = await refreshAfterCommand(false);
        return { status: refreshed ? 'success' : 'refresh-required', reconciled: false };
      } catch (cause) {
        if (!isAmbiguousTransportFailure(cause)) throw cause;
        let record: WalletCommandRecord | null;
        try {
          record = await gateway.getWalletCommandResult(command.input.spaceId, command.requestId);
        } catch (reconciliationCause) {
          if (currentSpace.current === command.input.spaceId) setRetry(command);
          throw reconciliationCause;
        }
        if (record && record.commandKind === walletLifecycleKind(command.kind) && record.walletId === command.input.walletId) {
          const refreshed = await refreshAfterCommand(false);
          return { status: refreshed ? 'success' : 'refresh-required', reconciled: true };
        }
        setRetry(command);
        return { status: 'ambiguous', reconciled: false };
      }
    }
    try {
      if (command.kind === 'reverse') {
        await gateway.reverseEvent(command.input);
      } else if (command.categoryId) {
        if (!categoriesGateway) throw new Error('Categorized posting is not available.');
        if (!isCategoryKind(command.input.kind)) throw new Error('Only income and expense events can be categorized.');
        await categoriesGateway.recordCategorizedEvent({
          spaceId: command.input.spaceId,
          requestId: command.input.requestId,
          kind: command.input.kind,
          effectiveDate: command.input.effectiveDate,
          movements: command.input.movements,
          categoryId: command.categoryId,
        });
      } else {
        await gateway.recordEvent(command.input);
      }
      const refreshed = await refreshAfterCommand(categorized);
      return { status: categorized && !refreshed ? 'refresh-required' : 'success', reconciled: false };
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      let event;
      try {
        event = command.kind === 'record' && command.categoryId && categoriesGateway
          ? await categoriesGateway.findCategorizedEventByRequestId(command.input.spaceId, command.requestId)
          : await gateway.findEventByRequestId(command.input.spaceId, command.requestId);
      } catch (reconciliationCause) {
        if (currentSpace.current === command.input.spaceId) setRetry(command);
        throw reconciliationCause;
      }
      if (event) {
        if (command.kind === 'record' && command.categoryId && 'categoryId' in event && event.categoryId !== command.categoryId) {
          throw new Error('The request ID resolved to an event with a different category. Refresh before trying again.');
        }
        const refreshed = await refreshAfterCommand(categorized);
        return { status: categorized && !refreshed ? 'refresh-required' : 'success', reconciled: true };
      }
      setRetry(command);
      return { status: 'ambiguous', reconciled: false };
    }
  }, [categoriesGateway, gateway, refreshAfterCommand]);
```

Add three callbacks directly after `reverseEvent`, before `retryAmbiguous`:

```ts
  const renameWallet = useCallback(async (input: RenameDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = { kind: 'rename', requestId, input: { ...input, spaceId, requestId } };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);

  const archiveWallet = useCallback(async (input: LifecycleDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = { kind: 'archive', requestId, input: { ...input, spaceId, requestId } };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);

  const restoreWallet = useCallback(async (input: LifecycleDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = { kind: 'restore', requestId, input: { ...input, spaceId, requestId } };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);
```

Change the returned object at the end of the hook, adding `archivedWallets` after `wallets` and the three callbacks after `reverseEvent`:

```ts
  return {
    status: visible ? view.status : 'loading' as const,
    wallets: visible ? view.wallets : [],
    archivedWallets: visible ? view.archivedWallets : [],
    events: visible ? view.events : [],
    nextCursor: visible ? view.nextCursor : null,
    error: visible ? view.error : null,
    categoryError: visible ? view.categoryError : null,
    historyPaginationError: visible ? historyPaginationError : null,
    pending,
    loadingMore,
    ambiguous: retry ? { kind: retry.kind, requestId: retry.requestId } : null,
    refresh: () => load(),
    recoverRefresh: () => load(true, false),
    loadMore,
    createWallet,
    recordEvent,
    reverseEvent,
    renameWallet,
    archiveWallet,
    restoreWallet,
    retryAmbiguous,
    clearAmbiguous: () => setRetry(null),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/wallets/use-wallets.test.tsx --config vitest.ui.config.ts`
Expected: PASS, 30 tests (25 existing + 5 new).

- [ ] **Step 5: Typecheck and run the full UI suite**

Run: `pnpm exec tsc --noEmit && pnpm test:ui`
Expected: both exit 0 / all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/wallets/use-wallets.ts src/features/wallets/use-wallets.test.tsx
git commit -m "feat(wallets): add rename, archive, restore commands to the wallets hook" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Rename wallet dialog

**Files:**
- Create: `src/features/wallets/rename-wallet-dialog.tsx`
- Test: `src/features/wallets/rename-wallet-dialog.test.tsx`

**Interfaces:**
- Consumes: `WalletProjection` (Task 2), `CommandOutcome` (`use-wallets.ts`), `classifyWalletError`/`localizeWalletError` (Task 1), `DialogShell` (existing).
- Produces: `RenameWalletDialog(props: { locale; wallet: WalletProjection; pending; ambiguous; onClose(); onClearAmbiguous(); onRetry(): Promise<CommandOutcome>; onSubmit(input: { walletId: string; name: string }): Promise<CommandOutcome> })`. Task 7 renders it.

- [ ] **Step 1: Write the failing test**

Create `src/features/wallets/rename-wallet-dialog.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WalletProjection } from './types.js';
import { RenameWalletDialog } from './rename-wallet-dialog.js';

const wallet: WalletProjection = { id: 'wallet-1', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '1250' };

function renderDialog(locale: 'en' | 'ar' = 'en', onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }))) {
  const user = userEvent.setup();
  render(<RenameWalletDialog locale={locale} wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
  return { onSubmit, user };
}

describe('RenameWalletDialog', () => {
  it('pre-fills the current name and disables Save until it changes', async () => {
    const { user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    expect(input).toHaveValue('Daily USD');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(input);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(input, 'Travel cash');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('submits the trimmed name and shows a confirmation', async () => {
    const { onSubmit, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, '  Travel cash  ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({ walletId: 'wallet-1', name: 'Travel cash' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wallet renamed');
  });

  it('surfaces a classified rejection without exposing database text', async () => {
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'the wallet already has this name' }; });
    const { user } = renderDialog('en', onSubmit);
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, 'Reserve USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This wallet already has this name.');
    expect(alert).not.toMatch(/wallet_command_requests/);
  });

  it('offers an explicit unchanged retry while ambiguous', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('Connection timeout'); });
    const onRetry = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    const user = userEvent.setup();
    render(<RenameWalletDialog locale="en" wallet={wallet} pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={onRetry} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, 'Reserve USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Retry unchanged rename' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders in Arabic with the wallet name isolated', async () => {
    renderDialog('ar');
    const dialog = screen.getByRole('dialog', { name: 'إعادة تسمية المحفظة' });
    expect(within(dialog).getByLabelText('اسم المحفظة')).toHaveValue('Daily USD');
    expect(within(dialog).getByRole('button', { name: 'حفظ' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/wallets/rename-wallet-dialog.test.tsx --config vitest.ui.config.ts`
Expected: FAIL — `Cannot find module './rename-wallet-dialog.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/wallets/rename-wallet-dialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { classifyWalletError, localizeWalletError } from './errors.js';
import { DialogShell } from './dialog-shell.js';
import type { CommandOutcome } from './use-wallets.js';
import type { WalletProjection } from './types.js';

interface RenameWalletDialogProps {
  locale: Locale;
  wallet: WalletProjection;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { walletId: string; name: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function RenameWalletDialog(props: RenameWalletDialogProps) {
  const [name, setName] = useState(props.wallet.name);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const trimmed = name.trim();
  const unchanged = trimmed === props.wallet.name;

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged name.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الاسم نفسه فقط.'));
    } catch (cause) {
      const result = localizeWalletError(classifyWalletError(cause), props.locale);
      setError(`${result.message} ${result.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || unchanged) return;
    void run(() => props.onSubmit({ walletId: props.wallet.id, name: trimmed }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Rename wallet', 'إعادة تسمية المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}>
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Wallet renamed', 'تمت إعادة تسمية المحفظة')}</strong><p>{t(props.locale, 'The new name now shows everywhere this wallet appears, including past entries.', 'يظهر الاسم الجديد الآن في كل مكان تظهر فيه هذه المحفظة، بما في ذلك القيود السابقة.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Rename wallet', 'إعادة تسمية المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form onSubmit={submit}>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged rename', 'إعادة تسمية دون تغيير')}</button></div>}</div>}
      <label className="full-field">{t(props.locale, 'Wallet name', 'اسم المحفظة')}<input data-autofocus value={name} maxLength={120} disabled={props.pending} onChange={(event) => { setName(event.target.value); setError(null); props.onClearAmbiguous(); }} /></label>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending || !trimmed || unchanged}>{props.pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button></div>
    </form>
  </DialogShell>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/wallets/rename-wallet-dialog.test.tsx --config vitest.ui.config.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/wallets/rename-wallet-dialog.tsx src/features/wallets/rename-wallet-dialog.test.tsx
git commit -m "feat(wallets): add the rename wallet dialog" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Archive wallet dialog

**Files:**
- Create: `src/features/wallets/archive-wallet-dialog.tsx`
- Test: `src/features/wallets/archive-wallet-dialog.test.tsx`

**Interfaces:**
- Consumes: `WalletProjection`, `formatMinorAmount` (`money.ts`, existing), `CommandOutcome`, `classifyWalletError`/`localizeWalletError`, `DialogShell`.
- Produces: `ArchiveWalletDialog(props: { locale; wallet: WalletProjection; pending; ambiguous; onClose(); onClearAmbiguous(); onRetry(): Promise<CommandOutcome>; onSubmit(input: { walletId: string }): Promise<CommandOutcome> })`. Task 7 renders it.

- [ ] **Step 1: Write the failing test**

Create `src/features/wallets/archive-wallet-dialog.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WalletProjection } from './types.js';
import { ArchiveWalletDialog } from './archive-wallet-dialog.js';

const zeroWallet: WalletProjection = { id: 'wallet-1', spaceId: 'space-1', name: 'Travel fund', currency: 'USD', archivedAt: null, balanceMinor: '0' };
const fundedWallet: WalletProjection = { id: 'wallet-2', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '125050' };

describe('ArchiveWalletDialog', () => {
  it('requires deliberate confirmation at a zero balance and never offers deletion', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    render(<ArchiveWalletDialog locale="en" wallet={zeroWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    expect(within(dialog).getByText('Travel fund').closest('bdi')).not.toBeNull();
    expect(within(dialog).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Archive wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirm that you understand');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive wallet' }));
    expect(onSubmit).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wallet archived');
  });

  it('offers no archive action at all for a non-zero balance', () => {
    render(<ArchiveWalletDialog locale="en" wallet={fundedWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    expect(within(dialog).getByText('$1,250.50')).toBeInTheDocument();
    expect(within(dialog).getByText(/Undo or move its transactions/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Archive wallet' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('surfaces a database-confirmed non-zero-balance rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'the wallet balance must be zero to archive' }; });
    render(<ArchiveWalletDialog locale="en" wallet={zeroWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This wallet still has money in it.');
  });

  it('renders the non-zero-balance explanation in Arabic', () => {
    render(<ArchiveWalletDialog locale="ar" wallet={fundedWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'أرشفة المحفظة' });
    expect(within(dialog).queryByRole('button', { name: 'أرشفة المحفظة' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/تراجع عن معاملاتها/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/wallets/archive-wallet-dialog.test.tsx --config vitest.ui.config.ts`
Expected: FAIL — `Cannot find module './archive-wallet-dialog.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/wallets/archive-wallet-dialog.tsx`:

```tsx
import { useId, useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { classifyWalletError, localizeWalletError } from './errors.js';
import { DialogShell } from './dialog-shell.js';
import { formatMinorAmount } from './money.js';
import type { CommandOutcome } from './use-wallets.js';
import type { WalletProjection } from './types.js';

interface ArchiveWalletDialogProps {
  locale: Locale;
  wallet: WalletProjection;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { walletId: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function ArchiveWalletDialog(props: ArchiveWalletDialogProps) {
  const descriptionId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const zeroBalance = BigInt(props.wallet.balanceMinor) === 0n;

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged wallet.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذه المحفظة نفسها فقط.'));
    } catch (cause) {
      const result = localizeWalletError(classifyWalletError(cause), props.locale);
      setError(`${result.message} ${result.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!zeroBalance) return;
    if (!confirmed) {
      setError(t(props.locale, 'Confirm that you understand this wallet will leave active balances.', 'أكد أنك تفهم أن هذه المحفظة ستغادر الأرصدة الفعالة.'));
      return;
    }
    void run(() => props.onSubmit({ walletId: props.wallet.id }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Archive wallet', 'أرشفة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Wallet archived', 'تمت أرشفة المحفظة')}</strong><p id={descriptionId}>{t(props.locale, 'It leaves active balances and every wallet picker. Its history stays, and it can be restored.', 'تغادر الأرصدة الفعالة وكل قائمة محافظ. يبقى سجلها، ويمكن استعادتها.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Archive wallet', 'أرشفة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <form onSubmit={submit}>
      {zeroBalance
        ? <p id={descriptionId} className="dialog-intro">{t(props.locale, 'Archive', 'أرشفة')} <strong><bdi>{props.wallet.name}</bdi></strong>? {t(props.locale, 'It leaves active balances and every wallet picker. Its history stays, and it can be restored.', 'ستغادر الأرصدة الفعالة وكل قائمة محافظ. يبقى سجلها، ويمكن استعادتها.')}</p>
        : <p id={descriptionId} className="dialog-intro">{t(props.locale, 'This wallet still has money in it', 'لا تزال هذه المحفظة تحتوي على مال')}: <bdi>{formatMinorAmount(props.wallet.balanceMinor, props.wallet.currency, props.locale)}</bdi>. {t(props.locale, 'Undo or move its transactions until the balance is 0.', 'تراجع عن معاملاتها أو انقلها حتى يصبح الرصيد صفرًا.')}</p>}
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged archive', 'إعادة الأرشفة دون تغيير')}</button></div>}</div>}
      {zeroBalance && <label className="confirm"><input data-autofocus type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setError(null); props.onClearAmbiguous(); }} />{t(props.locale, 'I understand this wallet will leave active balances and every wallet picker.', 'أفهم أن هذه المحفظة ستغادر الأرصدة الفعالة وكل قائمة محافظ.')}</label>}
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, zeroBalance ? 'Cancel' : 'Close', zeroBalance ? 'إلغاء' : 'إغلاق')}</button>{zeroBalance && <button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Archiving…', 'جارٍ الأرشفة…') : t(props.locale, 'Archive wallet', 'أرشفة المحفظة')}</button>}</div>
    </form>
  </DialogShell>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/wallets/archive-wallet-dialog.test.tsx --config vitest.ui.config.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/wallets/archive-wallet-dialog.tsx src/features/wallets/archive-wallet-dialog.test.tsx
git commit -m "feat(wallets): add the archive wallet dialog" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Restore wallet dialog

**Files:**
- Create: `src/features/wallets/restore-wallet-dialog.tsx`
- Test: `src/features/wallets/restore-wallet-dialog.test.tsx`

**Interfaces:**
- Consumes: `WalletProjection`, `CommandOutcome`, `classifyWalletError`/`localizeWalletError`, `DialogShell`.
- Produces: `RestoreWalletDialog(props: { locale; wallet: WalletProjection; pending; ambiguous; onClose(); onClearAmbiguous(); onRetry(): Promise<CommandOutcome>; onSubmit(input: { walletId: string }): Promise<CommandOutcome> })`. Task 7 renders it.

- [ ] **Step 1: Write the failing test**

Create `src/features/wallets/restore-wallet-dialog.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WalletProjection } from './types.js';
import { RestoreWalletDialog } from './restore-wallet-dialog.js';

const wallet: WalletProjection = { id: 'wallet-1', spaceId: 'space-1', name: 'Travel fund', currency: 'USD', archivedAt: '2026-09-10T00:00:00Z', balanceMinor: '0' };

describe('RestoreWalletDialog', () => {
  it('offers a single Restore action with no checkbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    render(<RestoreWalletDialog locale="en" wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Travel fund').closest('bdi')).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(onSubmit).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wallet restored');
  });

  it('surfaces a not-archived rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'the wallet is not archived' }; });
    render(<RestoreWalletDialog locale="en" wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This wallet is not archived.');
  });

  it('offers an explicit unchanged retry while ambiguous', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('Connection timeout'); });
    const onRetry = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    const user = userEvent.setup();
    render(<RestoreWalletDialog locale="en" wallet={wallet} pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={onRetry} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Retry unchanged restore' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders in Arabic', () => {
    render(<RestoreWalletDialog locale="ar" wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'استعادة المحفظة' });
    expect(within(dialog).getByRole('button', { name: 'استعادة' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/wallets/restore-wallet-dialog.test.tsx --config vitest.ui.config.ts`
Expected: FAIL — `Cannot find module './restore-wallet-dialog.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/wallets/restore-wallet-dialog.tsx`:

```tsx
import { useId, useState } from 'react';

import type { Locale } from '../loans/types.js';
import { classifyWalletError, localizeWalletError } from './errors.js';
import { DialogShell } from './dialog-shell.js';
import type { CommandOutcome } from './use-wallets.js';
import type { WalletProjection } from './types.js';

interface RestoreWalletDialogProps {
  locale: Locale;
  wallet: WalletProjection;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { walletId: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function RestoreWalletDialog(props: RestoreWalletDialogProps) {
  const descriptionId = useId();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged wallet.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذه المحفظة نفسها فقط.'));
    } catch (cause) {
      const result = localizeWalletError(classifyWalletError(cause), props.locale);
      setError(`${result.message} ${result.recovery}`);
    }
  }

  if (success) return <DialogShell title={t(props.locale, 'Restore wallet', 'استعادة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Wallet restored', 'تمت استعادة المحفظة')}</strong><p id={descriptionId}>{t(props.locale, 'It is back in active balances and every wallet picker.', 'عادت إلى الأرصدة الفعالة وكل قائمة محافظ.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Restore wallet', 'استعادة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <p id={descriptionId} className="dialog-intro">{t(props.locale, 'Restore', 'استعادة')} <strong><bdi>{props.wallet.name}</bdi></strong>? {t(props.locale, 'It returns to active balances and every wallet picker.', 'ستعود إلى الأرصدة الفعالة وكل قائمة محافظ.')}</p>
    {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged restore', 'إعادة الاستعادة دون تغيير')}</button></div>}</div>}
    <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="button" data-autofocus disabled={props.pending} onClick={() => void run(() => props.onSubmit({ walletId: props.wallet.id }))}>{props.pending ? t(props.locale, 'Restoring…', 'جارٍ الاستعادة…') : t(props.locale, 'Restore', 'استعادة')}</button></div>
  </DialogShell>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/wallets/restore-wallet-dialog.test.tsx --config vitest.ui.config.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/wallets/restore-wallet-dialog.tsx src/features/wallets/restore-wallet-dialog.test.tsx
git commit -m "feat(wallets): add the restore wallet dialog" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire rename, archive, restore, and undo-gating into the Wallets page

**Files:**
- Modify: `src/features/wallets/wallets-page.tsx`
- Modify: `src/features/wallets/wallets-page.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `RenameWalletDialog` (Task 4), `ArchiveWalletDialog` (Task 5), `RestoreWalletDialog` (Task 6), `walletState.archivedWallets/renameWallet/archiveWallet/restoreWallet` (Task 3), `event.movements[].walletArchived` (Task 2).

- [ ] **Step 1: Write the failing page tests**

In `src/features/wallets/wallets-page.test.tsx`, change line 47 (the existing over-broad ratchet) from:

```ts
    expect(screen.queryByRole('button', { name: /archive|delete/i })).not.toBeInTheDocument();
```

to:

```ts
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
```

Append these tests before the final `});` that closes `describe('WalletsPage', ...)`:

```ts
  it('renames a wallet from its row action and shows the new name everywhere it appears', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Rename Daily USD' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, 'Everyday USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByText('Wallet renamed');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(screen.getAllByText('Everyday USD').every((element) => element.closest('bdi') !== null)).toBe(true);
    expect(gateway.calls.filter((call) => call.name === 'renameWallet')).toHaveLength(1);
  });

  it('archives a zero-balance wallet into the collapsed archived section and restores it', async () => {
    const gateway = new InMemoryWalletsGateway();
    gateway.wallets = gateway.wallets.map((wallet) => wallet.id === 'wallet-lbp-1' ? { ...wallet, balanceMinor: '0' } : wallet);
    const { user } = await renderPage(gateway);

    expect(screen.queryByText(/Archived wallets/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive Daily LBP' }));
    const archiveDialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    await user.click(within(archiveDialog).getByRole('checkbox'));
    await user.click(within(archiveDialog).getByRole('button', { name: 'Archive wallet' }));
    await within(archiveDialog).findByText('Wallet archived');
    await user.click(within(archiveDialog).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('button', { name: 'Archive Daily LBP' })).not.toBeInTheDocument();
    await user.click(screen.getByText('Archived wallets (1)'));
    expect(screen.getByText('Daily LBP').closest('bdi')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Restore Daily LBP' }));
    const restoreDialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    await user.click(within(restoreDialog).getByRole('button', { name: 'Restore' }));
    await within(restoreDialog).findByText('Wallet restored');
    await user.click(within(restoreDialog).getByRole('button', { name: 'Done' }));

    expect(screen.getByRole('button', { name: 'Archive Daily LBP' })).toBeInTheDocument();
    expect(screen.queryByText(/Archived wallets/)).not.toBeInTheDocument();
  });

  it('a non-zero-balance wallet offers no archive action', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Archive Daily USD' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    expect(within(dialog).queryByRole('button', { name: 'Archive wallet' })).not.toBeInTheDocument();
  });

  it('gates undo behind a restore message when a movement touches an archived wallet', async () => {
    const gateway = new InMemoryWalletsGateway();
    const archivedWallet = { id: 'wallet-usd-1', spaceId: 'personal-space', name: 'Daily USD', currency: 'USD' as const, archivedAt: '2026-09-08T00:00:00Z', balanceMinor: '0' };
    gateway.wallets = gateway.wallets.filter((wallet) => wallet.id !== 'wallet-usd-1');
    gateway.archivedWallets = [archivedWallet];
    gateway.events = gateway.events.map((event) => event.id === 'event-income'
      ? { ...event, movements: event.movements.map((movement) => ({ ...movement, walletArchived: true })) }
      : event);
    await renderPage(gateway);

    expect(screen.queryByRole('button', { name: 'Undo income' })).not.toBeInTheDocument();
    const gated = screen.getByText((_content, element) => element?.textContent === 'Restore Daily USD to undo this');
    expect(gated.querySelector('bdi')).not.toBeNull();
  });
```

`InMemoryWalletsGateway` and its `archivedWallets` field come from the class Task 2 already exports; no new import is needed beyond the existing `InMemoryWalletsGateway` import at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/wallets/wallets-page.test.tsx --config vitest.ui.config.ts`
Expected: FAIL — no `Rename Daily USD` / `Archive Daily USD` buttons exist yet; no archived section renders; the gating test finds the plain Undo button instead.

- [ ] **Step 3: Implement the page changes**

In `src/features/wallets/wallets-page.tsx`, add to the existing imports:

```ts
import { ArchiveWalletDialog } from './archive-wallet-dialog.js';
import { RenameWalletDialog } from './rename-wallet-dialog.js';
import { RestoreWalletDialog } from './restore-wallet-dialog.js';
```

Change `type OpenDialog`:

```ts
type OpenDialog = 'wallet' | 'transaction' | { correction: JournalEvent } | { rename: WalletProjection } | { archive: WalletProjection } | { restore: WalletProjection } | null;
```

Add `WalletProjection` to the existing `import type { JournalEvent, JournalEventKind, WalletsGateway } from './types.js';` line, making it:

```ts
import type { JournalEvent, JournalEventKind, WalletProjection, WalletsGateway } from './types.js';
```

Add this pure helper directly below `const generalKinds = new Set<JournalEventKind>([...]);`:

```ts
function archivedMovementWallet(event: JournalEvent): string | null {
  return event.movements.find((movement) => movement.walletArchived)?.walletName ?? null;
}
```

In the component body, change the active-wallets list rendering from:

```tsx
        {walletState.wallets.length === 0 ? <div className="empty wallet-empty"><strong>{t(locale, 'No wallets yet', 'لا توجد محافظ بعد')}</strong><p>{t(locale, 'Create a USD or LBP wallet to start this space’s journal.', 'أنشئ محفظة بالدولار أو الليرة لبدء سجل هذه المساحة.')}</p><button type="button" onClick={() => setDialog('wallet')}>{t(locale, 'Create first wallet', 'إنشاء أول محفظة')}</button></div> : <ul className="wallet-list">{walletState.wallets.map((wallet) => <li key={wallet.id}><div><bdi>{wallet.name}</bdi><span>{wallet.currency}</span></div><bdi className="wallet-balance">{formatMinorAmount(wallet.balanceMinor, wallet.currency, locale)}</bdi></li>)}</ul>}
      </section>
```

to:

```tsx
        {walletState.wallets.length === 0 ? <div className="empty wallet-empty"><strong>{t(locale, 'No wallets yet', 'لا توجد محافظ بعد')}</strong><p>{t(locale, 'Create a USD or LBP wallet to start this space’s journal.', 'أنشئ محفظة بالدولار أو الليرة لبدء سجل هذه المساحة.')}</p><button type="button" onClick={() => setDialog('wallet')}>{t(locale, 'Create first wallet', 'إنشاء أول محفظة')}</button></div> : <ul className="wallet-list">{walletState.wallets.map((wallet) => <li key={wallet.id}>
          <div><bdi>{wallet.name}</bdi><span>{wallet.currency}</span></div>
          <bdi className="wallet-balance">{formatMinorAmount(wallet.balanceMinor, wallet.currency, locale)}</bdi>
          <footer><button type="button" className="text-button" onClick={() => setDialog({ rename: wallet })}>{t(locale, 'Rename', 'إعادة تسمية')} <bdi>{wallet.name}</bdi></button><button type="button" className="text-button" onClick={() => setDialog({ archive: wallet })}>{t(locale, 'Archive', 'أرشفة')} <bdi>{wallet.name}</bdi></button></footer>
        </li>)}</ul>}
      </section>

      {walletState.archivedWallets.length > 0 && <details className="archived-wallets">
        <summary>{t(locale, `Archived wallets (${walletState.archivedWallets.length})`, `المحافظ المؤرشفة (${walletState.archivedWallets.length})`)}</summary>
        <ul className="wallet-list">{walletState.archivedWallets.map((wallet) => <li key={wallet.id}>
          <div><bdi>{wallet.name}</bdi><span>{wallet.currency} · <time dateTime={wallet.archivedAt ?? undefined}>{(wallet.archivedAt ?? '').slice(0, 10)}</time></span></div>
          <button type="button" className="text-button" onClick={() => setDialog({ restore: wallet })}>{t(locale, 'Restore', 'استعادة')} <bdi>{wallet.name}</bdi></button>
        </li>)}</ul>
      </details>}
```

In the journal list's footer, change:

```tsx
            <footer>{canCorrect && <button type="button" className="text-button" onClick={() => setDialog({ correction: event })}>{t(locale, `Undo ${label.toLowerCase()}`, `تراجع عن ${label}`)}</button>}{event.loanLinked && <button type="button" className="text-button" onClick={onOpenLoans}>{t(locale, 'Manage in Loans', 'الإدارة في القروض')}</button>}</footer>
```

to:

```tsx
            <footer>{canCorrect && (archivedMovementWallet(event) ? <span className="undo-gated">{t(locale, 'Restore', 'استعد')} <bdi>{archivedMovementWallet(event)}</bdi> {t(locale, 'to undo this', 'للتراجع عن هذا')}</span> : <button type="button" className="text-button" onClick={() => setDialog({ correction: event })}>{t(locale, `Undo ${label.toLowerCase()}`, `تراجع عن ${label}`)}</button>)}{event.loanLinked && <button type="button" className="text-button" onClick={onOpenLoans}>{t(locale, 'Manage in Loans', 'الإدارة في القروض')}</button>}</footer>
```

At the bottom, change the existing correction-dialog line (adding the discriminant it now needs, since `OpenDialog`'s object variant is no longer unique) and add the three new dialogs after it:

```tsx
    {dialog && typeof dialog === 'object' && 'correction' in dialog && <CorrectionDialog locale={locale} event={dialog.correction} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'reverse'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.reverseEvent} />}
    {dialog && typeof dialog === 'object' && 'rename' in dialog && <RenameWalletDialog locale={locale} wallet={dialog.rename} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'rename'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.renameWallet} />}
    {dialog && typeof dialog === 'object' && 'archive' in dialog && <ArchiveWalletDialog locale={locale} wallet={dialog.archive} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'archive'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.archiveWallet} />}
    {dialog && typeof dialog === 'object' && 'restore' in dialog && <RestoreWalletDialog locale={locale} wallet={dialog.restore} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'restore'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.restoreWallet} />}
```

- [ ] **Step 4: Add the CSS**

In `src/styles.css`, directly after the existing `.journal-list footer { display: flex; justify-content: flex-end; margin-block-start: 8px; }` rule, add:

```css
.wallet-list li > footer { grid-column: 1 / -1; display: flex; gap: 4px; margin-block-start: 4px; }
.archived-wallets { margin-block-start: 20px; }
.archived-wallets > summary { cursor: pointer; font-weight: 700; padding-block: 10px; list-style: none; }
.archived-wallets > summary::-webkit-details-marker { display: none; }
.undo-gated { color: #68756c; font-size: .82rem; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/wallets/wallets-page.test.tsx --config vitest.ui.config.ts`
Expected: PASS, 30 tests (26 existing, one changed, 4 new).

- [ ] **Step 6: Typecheck and run the full UI suite**

Run: `pnpm exec tsc --noEmit && pnpm test:ui`
Expected: both exit 0 / all pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/wallets/wallets-page.tsx src/features/wallets/wallets-page.test.tsx src/styles.css
git commit -m "feat(wallets): wire rename, archive, restore, and undo-gating into the wallets page" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Loans — one localized archived-wallet correction message

**Files:**
- Modify: `src/features/loans/types.ts`
- Modify: `src/features/loans/errors.ts`
- Modify: `src/features/loans/errors.test.ts`
- Modify: `src/features/loans/loan-dialogs.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LoanErrorCode` gains `'archived_wallet'`; `classifyLoanError` classifies `every wallet movement must use an active wallet`.

- [ ] **Step 1: Write the failing tests**

In `src/features/loans/errors.test.ts`, add to the existing `it.each` array (as the last row before the closing `] as const`):

```ts
    ['every wallet movement must use an active wallet', 'archived_wallet'],
```

Append after the `it('explains the dependent-repayment recovery order', ...)` test:

```ts
  it('explains the archived-wallet recovery', () => {
    expect(classifyLoanError({ message: 'every wallet movement must use an active wallet' }).recovery).toBe(
      'Restore it in Wallets first.',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/loans/errors.test.ts --config vitest.ui.config.ts`
Expected: FAIL — the new `it.each` row expects `code: 'archived_wallet'` but `classifyLoanError` falls through to `'database_rejection'`; TypeScript also rejects `'archived_wallet'` as not assignable to `LoanErrorCode` until Step 3.

- [ ] **Step 3: Extend the type and classifier**

In `src/features/loans/types.ts`, change `LoanErrorCode`:

```ts
export type LoanErrorCode =
  | 'wrong_currency'
  | 'overpayment'
  | 'retry_collision'
  | 'missing_membership'
  | 'dependent_repayment'
  | 'target_above_outstanding'
  | 'archived_wallet'
  | 'database_rejection';
```

In `src/features/loans/errors.ts`, add a case directly after the `wrong_currency` block:

```ts
  if (message.includes('every wallet movement must use an active wallet')) {
    return {
      code: 'archived_wallet',
      title: "This entry's wallet is archived",
      message,
      recovery: 'Restore it in Wallets first.',
    };
  }
```

- [ ] **Step 4: Extend the Arabic error table**

In `src/features/loans/loan-dialogs.tsx`, in `ErrorNotice`'s `arabic` object, add a row directly after `wrong_currency`:

```ts
    archived_wallet: ['محفظة هذا القيد مؤرشفة', 'استعد المحفظة من صفحة المحافظ أولًا.'],
```

- [ ] **Step 5: Write and run the dialog-level test**

Create `src/features/loans/loan-dialogs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CorrectionDialog } from './loan-dialogs.js';
import type { Loan } from './types.js';

const loan: Loan = {
  id: 'loan-1', spaceId: 'space-1', direction: 'they_owe_me', personName: 'Sami', currency: 'USD',
  effectiveDate: '2026-09-01', dueDate: null, note: null, outstandingMinor: '5000',
  originalPrincipalMinor: '5000', totalRepaidMinor: '0', status: 'outstanding',
  plan: { targetMinor: '0', actualRepaymentMinor: '0', remainingReservationMinor: '0', dueAmountMinor: '0', expectedCollectionMinor: '0' },
};

describe('Loans CorrectionDialog archived-wallet rejection', () => {
  it('shows the localized message in English', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => { throw new Error('every wallet movement must use an active wallet'); });
    render(<CorrectionDialog loan={loan} eventId="event-1" locale="en" onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add reversal' }));
    expect(await screen.findByText("This entry's wallet is archived")).toBeInTheDocument();
    expect(screen.getByText('Restore it in Wallets first.')).toBeInTheDocument();
  });

  it('shows the localized message in Arabic without the raw database text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => { throw new Error('every wallet movement must use an active wallet'); });
    render(<CorrectionDialog loan={loan} eventId="event-1" locale="ar" onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'إضافة القيد العكسي' }));
    expect(await screen.findByText('محفظة هذا القيد مؤرشفة')).toBeInTheDocument();
    expect(screen.getByText('استعد المحفظة من صفحة المحافظ أولًا.')).toBeInTheDocument();
    expect(screen.queryByText(/every wallet movement/)).not.toBeInTheDocument();
  });
});
```

Run: `pnpm exec vitest run src/features/loans/errors.test.ts src/features/loans/loan-dialogs.test.tsx --config vitest.ui.config.ts`
Expected: PASS, 12 tests (10 in `errors.test.ts` — 7 existing classification rows + 1 new + the dependent-repayment recovery test + the new archived-wallet recovery test + the safe-unknown test + the non-message test = confirm 10 against the printed count — plus 2 new dialog tests).

- [ ] **Step 6: Typecheck and run the full UI suite**

Run: `pnpm exec tsc --noEmit && pnpm test:ui`
Expected: both exit 0 / all pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/loans/types.ts src/features/loans/errors.ts src/features/loans/errors.test.ts \
  src/features/loans/loan-dialogs.tsx src/features/loans/loan-dialogs.test.tsx
git commit -m "feat(loans): localize corrections blocked by an archived wallet" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end fixture and Playwright coverage

**Files:**
- Modify: `e2e/fixtures/loans.ts`
- Modify: `e2e/wallets.visual.spec.ts`

**Interfaces:**
- Consumes: the built application (Tasks 1–7).

- [ ] **Step 1: Extend the fixture**

In `e2e/fixtures/loans.ts`, add to `protectedMutationNames`:

```ts
  'archive_wallet',
  'rename_wallet',
  'restore_wallet',
```

(keep the `Set` alphabetically ordered, matching its existing entries).

Add, directly below the `const categoryCommandResults = new Map...` line inside `installLoansApiFixture`:

```ts
  const walletCommandResults = new Map<string, { command_kind: 'rename_wallet' | 'archive_wallet' | 'restore_wallet'; wallet_id: string }>();
```

Add these four route handlers directly after the existing `/rpc/create_wallet` block:

```ts
    if (path.endsWith('/rpc/rename_wallet')) {
      const body = request.postDataJSON() as { p_request_id: string; p_wallet_id: string; p_name: string };
      const wallet = visibleWallets.find((item) => item.id === body.p_wallet_id);
      if (!wallet) return json(route, { message: 'the wallet does not belong to the requested space' }, 400);
      wallet.name = body.p_name;
      walletCommandResults.set(body.p_request_id, { command_kind: 'rename_wallet', wallet_id: wallet.id });
      return json(route, [{ id: wallet.id }]);
    }
    if (path.endsWith('/rpc/archive_wallet')) {
      const body = request.postDataJSON() as { p_request_id: string; p_wallet_id: string };
      const wallet = visibleWallets.find((item) => item.id === body.p_wallet_id);
      if (!wallet) return json(route, { message: 'the wallet does not belong to the requested space' }, 400);
      const balance = visibleWalletBalances.find((item) => item.wallet_id === wallet.id);
      if (balance && BigInt(balance.amount_minor) !== 0n) {
        return json(route, { message: 'the wallet balance must be zero to archive' }, 400);
      }
      wallet.archived_at = '2026-09-11T12:00:00Z';
      walletCommandResults.set(body.p_request_id, { command_kind: 'archive_wallet', wallet_id: wallet.id });
      return json(route, [{ id: wallet.id }]);
    }
    if (path.endsWith('/rpc/restore_wallet')) {
      const body = request.postDataJSON() as { p_request_id: string; p_wallet_id: string };
      const wallet = visibleWallets.find((item) => item.id === body.p_wallet_id);
      if (!wallet) return json(route, { message: 'the wallet does not belong to the requested space' }, 400);
      wallet.archived_at = null;
      walletCommandResults.set(body.p_request_id, { command_kind: 'restore_wallet', wallet_id: wallet.id });
      return json(route, [{ id: wallet.id }]);
    }
    if (path.endsWith('/rpc/get_wallet_command_result')) {
      const body = request.postDataJSON() as { p_request_id: string };
      const result = walletCommandResults.get(body.p_request_id);
      return json(route, result ? [result] : []);
    }
```

- [ ] **Step 2: Write the failing Playwright specs**

Append to `e2e/wallets.visual.spec.ts`, before its final closing brace of the file (after the last existing `test(...)` block):

```ts
test('renaming a wallet updates its name everywhere, including posted history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'Rename Daily USD' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename wallet' });
  await dialog.getByLabel('Wallet name').fill('Everyday USD');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet renamed');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Everyday USD').first()).toBeVisible();
  await expect(page.getByText('Loan payment')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallet-renamed.png'), fullPage: true });
});

test('a non-zero-balance wallet offers no archive action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'Archive Daily USD' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive wallet' });
  await expect(dialog.getByText('$1,250.50')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Archive wallet' })).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-archive-blocked.png') });
});

test('archiving a zero-balance wallet with history gates its Undo actions, and restoring returns them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'New wallet' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create a wallet' });
  await dialog.getByLabel('Wallet name').fill('Travel fund');
  await dialog.getByRole('button', { name: 'Create wallet' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Travel fund')).toBeVisible();

  // Post an equal income and expense on Travel fund itself (not the default
  // wallet) so it returns to exactly zero while leaving two still-undoable
  // entries in its history — the only way to observe undo-gating for real.
  for (const kind of ['income', 'expense'] as const) {
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const txDialog = page.getByRole('dialog', { name: 'Add a transaction' });
    await txDialog.getByLabel('Type').selectOption(kind);
    await txDialog.getByLabel('Wallet').selectOption({ label: 'Travel fund · USD' });
    await txDialog.getByLabel('Amount').fill('10');
    await txDialog.getByRole('button', { name: 'Review transaction' }).click();
    await txDialog.getByRole('button', { name: kind === 'income' ? 'Record income' : 'Record expense' }).click();
    await expect(txDialog.getByRole('status')).toContainText('Transaction recorded');
    await txDialog.getByRole('button', { name: 'Done' }).click();
  }
  await expect(page.getByRole('button', { name: 'Undo income' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo expense' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Archive Travel fund' }).click();
  dialog = page.getByRole('dialog', { name: 'Archive wallet' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Archive wallet' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet archived');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Archive Travel fund' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo income' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo expense' })).toHaveCount(0);
  await expect(page.getByText('Restore Travel fund to undo this').first()).toBeVisible();
  await page.getByText('Archived wallets (1)').click();
  await expect(page.getByText('Travel fund')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallet-archived.png'), fullPage: true });

  await page.getByRole('button', { name: 'Restore Travel fund' }).click();
  dialog = page.getByRole('dialog', { name: 'Restore wallet' });
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet restored');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Archive Travel fund' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo income' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo expense' }).first()).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallet-restored.png'), fullPage: true });
});

test('Arabic mobile archived wallets disclosure and restore render right-to-left', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openWallets(page);
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.getByRole('button', { name: 'أرشفة Home LBP' }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'أرشفة المحفظة' });
  await expect(archiveDialog.getByRole('button', { name: 'أرشفة المحفظة' })).toHaveCount(0);
  await archiveDialog.getByRole('button', { name: 'إغلاق' }).click();
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-archive-blocked.png'), fullPage: true });
});
```

- [ ] **Step 3: Run the specs to verify the new ones fail**

Run: `env -u NO_COLOR pnpm exec playwright test e2e/wallets.visual.spec.ts`
Expected: the 4 new tests FAIL (no `Rename Daily USD` / `Archive …` buttons exist yet in the built app); every pre-existing test in this file still passes.

- [ ] **Step 4: Build and run the specs to verify they pass**

Run: `pnpm build && env -u NO_COLOR pnpm exec playwright test e2e/wallets.visual.spec.ts`
Expected: PASS, all tests in the file (existing + 4 new). Note the mobile Arabic test uses the fixture's `lbp-wallet` (display name "Home LBP", balance LBP 2,500,000 — non-zero), matching the Arabic archive-button label pattern `أرشفة Home LBP` exactly as rendered (the wallet name inside the button is not translated).

- [ ] **Step 5: Run the full Playwright suite once**

Run: `env -u NO_COLOR pnpm exec playwright test`
Expected: PASS, every project/file (confirms nothing in Categories or Loans e2e broke from the fixture and `protectedMutationNames` changes).

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/loans.ts e2e/wallets.visual.spec.ts
git commit -m "test(wallets): cover rename, archive, and restore end to end" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Final gate and handoff

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run every gate fresh**

```bash
pnpm typecheck
pnpm test:ui
pnpm test:worker
pnpm build
env -u NO_COLOR pnpm exec playwright test
git diff --check
git status --short
```

Expected: `typecheck` and `build` exit 0; `test:ui` passes every file (including the 6 new/changed wallets files and the 2 new/changed loans files from this plan); `test:worker` unaffected (no worker file touched); the full Playwright suite passes (Wallets, Categories, Loans, private UAT); `git diff --check` prints nothing; `git status --short` shows only the pre-existing untracked baseline (`.DS_Store`, `.claude-flow/`, `.swarm/`, `artifacts/.DS_Store`, `docs/.DS_Store`, `supabase/.temp/`).

- [ ] **Step 2: Spec coverage check**

Confirm each spec section maps to a passing test: Rename (Task 4 + Task 7's page test); Archive at zero and non-zero balance (Task 5 + Task 7); Restore (Task 6 + Task 7); Archived wallets section presence/absence (Task 7); Undo gating (Task 7); Loans archived-wallet message (Task 8); gateway partition and RPC payloads (Task 2); hook reconciliation via `getWalletCommandResult` (Task 3); e2e round trip and Arabic mobile (Task 9).

- [ ] **Step 3: Hand off**

Report the branch, commit list (`git log --oneline main..HEAD`), and gate evidence. Do **not** merge, push, or deploy. Next step for the owner: review, then merge.
