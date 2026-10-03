import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { BudgetApi } from '../api/budget-api.ts';
import type { AccountWallet, Accounts, PlanGroup, PlanItem, PlanMonth, SpaceSummary } from '../api/schemas.ts';
import { useLoad, type Loaded } from '../ui/async.tsx';

/**
 * Everything a screen needs to read or write money in the selected space.
 * `version` changes after every successful command so every screen reloads
 * from the database; no screen keeps its own copy of a balance.
 */
export interface Catalog {
  readonly plan: PlanMonth;
  readonly accounts: Accounts;
}

export interface WorkspaceValue {
  readonly api: BudgetApi;
  readonly space: SpaceSummary;
  readonly spaces: readonly SpaceSummary[];
  readonly selectSpace: (spaceId: string) => void;
  readonly version: number;
  readonly refresh: () => void;
  readonly catalog: Loaded<Catalog>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ api, space, spaces, selectSpace, children }: {
  readonly api: BudgetApi;
  readonly space: SpaceSummary;
  readonly spaces: readonly SpaceSummary[];
  readonly selectSpace: (spaceId: string) => void;
  readonly children: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const catalog = useLoad<Catalog>(
    async () => {
      const [plan, accounts] = await Promise.all([api.planMonth(space.id, space.currentMonth), api.accounts(space.id)]);
      return { plan, accounts };
    },
    [api, space.id, space.currentMonth, version],
  );
  const value = useMemo<WorkspaceValue>(
    () => ({ api, space, spaces, selectSpace, version, refresh, catalog }),
    [api, space, spaces, selectSpace, version, refresh, catalog],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace outside WorkspaceProvider');
  return value;
}

export interface PickerItem {
  readonly itemId: string;
  readonly kind: PlanItem['kind'];
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly balances: PlanItem['balances'];
  readonly walletId: string | null;
}

export interface PickerGroup {
  readonly groupId: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly items: readonly PickerItem[];
}

/** Plan items grouped as in the plan, flexible item last, for pickers. */
export function pickerGroups(plan: PlanMonth): PickerGroup[] {
  return plan.groups.map((group: PlanGroup) => ({
    groupId: group.groupId,
    nameEn: group.nameEn,
    nameAr: group.nameAr,
    items: [...group.items, ...(group.flex ? [group.flex] : [])].map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      balances: item.balances,
      walletId: item.walletId,
    })),
  }));
}

export function findItem(plan: PlanMonth, itemId: string): PickerItem | null {
  for (const group of pickerGroups(plan)) {
    const found = group.items.find((item) => item.itemId === itemId);
    if (found) return found;
  }
  return null;
}

export const activeWallets = (accounts: Accounts, kind: AccountWallet['kind']): AccountWallet[] =>
  accounts.wallets.filter((wallet) => wallet.kind === kind && !wallet.archived);
