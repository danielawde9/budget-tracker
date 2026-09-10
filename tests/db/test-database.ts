import { Pool, type PoolClient } from 'pg';

export type SpaceKind = 'personal' | 'household';
export type Currency = 'USD' | 'LBP';
export type FinancialEventKind = 'opening_balance' | 'income' | 'expense' | 'transfer';
export type LoanDirection = 'they_owe_me' | 'i_owe_them';
export type CategoryKind = 'income' | 'expense';

export interface Space {
  id: string;
}

export interface Wallet {
  id: string;
}

export interface MovementInput {
  walletId: string;
  amountMinor: string;
}

export interface FinancialEventInput {
  spaceId: string;
  requestId: string;
  kind: FinancialEventKind;
  effectiveDate: string;
  movements: MovementInput[];
}

export interface CategoryInput {
  spaceId: string;
  requestId: string;
  kind: CategoryKind;
  nameEn?: string | null;
  nameAr?: string | null;
}

export interface CategorizedFinancialEventInput extends FinancialEventInput {
  categoryId: string;
}

export interface LoanOpeningInput {
  spaceId: string;
  requestId: string;
  direction: LoanDirection;
  personName: string;
  currency: Currency;
  amountMinor: string;
  effectiveDate: string;
  dueDate?: string;
  note?: string;
}

export interface CashLoanInput extends LoanOpeningInput {
  walletId: string;
}

export interface LoanRepaymentInput {
  spaceId: string;
  requestId: string;
  loanId: string;
  walletId: string;
  amountMinor: string;
  effectiveDate: string;
}

export interface LoanMonthlyTargetInput {
  spaceId: string;
  requestId: string;
  loanId: string;
  month: string;
  targetMinor: string;
}

function databaseUrl(): string {
  const value = process.env.BUDGET_TEST_DATABASE_URL;

  if (!value) {
    throw new Error('BUDGET_TEST_DATABASE_URL must be set for database integration tests');
  }

  return value;
}

const pool = new Pool({
  connectionString: databaseUrl(),
  connectionTimeoutMillis: 10_000,
  max: 8,
});

export async function databaseQuery<Row extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function ensureAuthUser(
  userId: string,
  email: string,
  confirmed = true,
): Promise<void> {
  await pool.query(
    `insert into auth.users (
       id, aud, role, email, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     )
     values ($1, 'authenticated', 'authenticated', $2, case when $3 then now() else null end,
       '{}', '{}', now(), now())
     on conflict (id) do update
     set email = excluded.email,
         email_confirmed_at = excluded.email_confirmed_at,
         updated_at = now()`,
    [userId, email, confirmed],
  );
}

export async function withAdminTransaction<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function grantFinancialHistoryWritesForTest(): Promise<void> {
  await pool.query(
    `grant update, delete, truncate on public.financial_events, public.wallet_movements,
       public.loan_postings to authenticated`,
  );
  await pool.query(
    `create policy financial_events_test_write on public.financial_events
       for update to authenticated using (true) with check (true)`,
  );
  await pool.query(
    `create policy loan_postings_test_delete on public.loan_postings
       for delete to authenticated using (true)`,
  );
}

export async function revokeFinancialHistoryWritesForTest(): Promise<void> {
  await pool.query('drop policy if exists financial_events_test_write on public.financial_events');
  await pool.query('drop policy if exists loan_postings_test_delete on public.loan_postings');
  await pool.query(
    `revoke update, delete, truncate on public.financial_events, public.wallet_movements,
       public.loan_postings from authenticated`,
  );
}

export async function financialWriterFunctionNames(): Promise<string[]> {
  const result = await pool.query<{ proname: string }>(
    `select p.proname
     from pg_proc as p
     join pg_namespace as namespace on namespace.oid = p.pronamespace
     where namespace.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~* $1
     order by p.proname`,
    [
      'insert[[:space:]]+into[[:space:]]+public\\.(financial_events|wallet_movements|loan_postings|financial_event_categories)',
    ],
  );

  return result.rows.map((row) => row.proname);
}

export async function financialTableWritePrivileges(
  roleName: 'authenticated' | 'service_role' = 'authenticated',
): Promise<Array<{ table_name: string; writable: boolean }>> {
  const result = await pool.query<{ table_name: string; writable: boolean }>(
    `select
       table_name,
       has_table_privilege($1, format('public.%I', table_name), 'insert')
         or has_table_privilege($1, format('public.%I', table_name), 'update')
         or has_table_privilege($1, format('public.%I', table_name), 'delete')
         or has_table_privilege($1, format('public.%I', table_name), 'truncate') as writable
     from unnest($2::text[]) as table_name
     order by table_name`,
    [
      roleName,
      [
        'wallets',
        'financial_events',
        'wallet_movements',
        'loans',
        'loan_postings',
        'loan_monthly_target_revisions',
        'financial_event_categories',
        ],
    ],
  );

  return result.rows;
}

export async function anonymousWalletBalance(walletId: string): Promise<string> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query('set local role anon');
    const result = await client.query<{ amount_minor: string }>(
      'select amount_minor from public.wallet_balances where wallet_id = $1',
      [walletId],
    );
    await client.query('commit');
    return result.rows[0]?.amount_minor ?? '0';
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function withUserSession<T>(
  userId: string,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query(
      `insert into auth.users (
         id,
         aud,
         role,
         email,
         raw_app_meta_data,
         raw_user_meta_data,
         created_at,
         updated_at
       )
       values ($1, 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())
       on conflict (id) do nothing`,
      [userId, `test-${userId}@budget.invalid`],
    );
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query('set local role authenticated');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryAsUser<T extends Record<string, unknown> = Record<string, unknown>>(
  userId: string,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return withUserSession(userId, async (client) => {
    const result = await client.query<T>(text, values);
    return result.rows;
  });
}

export async function queryAsRole<T extends Record<string, unknown> = Record<string, unknown>>(
  role: 'anon' | 'authenticated' | 'service_role',
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    const result = await client.query<T>(text, values);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryAsRoleWithActor<T extends Record<string, unknown> = Record<string, unknown>>(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query(`set local role ${role}`);
    const result = await client.query<T>(text, values);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function withAnonymousSession<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query('set local role anon');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function withServiceRoleSession<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function runConcurrentUserActions<T>(
  actions: Array<{ userId: string; action: (client: PoolClient) => Promise<T> }>,
): Promise<PromiseSettledResult<T>[]> {
  if (actions.length < 2 || actions.length > 6) {
    throw new Error('concurrent database actions require between two and six participants');
  }

  const clients = await Promise.all(actions.map(() => pool.connect()));
  let waiting = 0;
  let releaseBarrier: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });

  try {
    await Promise.all(
      clients.map(async (client, index) => {
        const participant = actions[index];
        if (!participant) throw new Error('missing concurrency participant');
        await pool.query(
          `insert into auth.users (
             id, aud, role, email, email_confirmed_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at
           ) values ($1, 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())
           on conflict (id) do nothing`,
          [participant.userId, `concurrent-${participant.userId}@budget.invalid`],
        );
        await client.query('begin');
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
          participant.userId,
        ]);
        await client.query('set local role authenticated');
      }),
    );

    return await Promise.allSettled(
      clients.map(async (client, index) => {
        const participant = actions[index];
        if (!participant) throw new Error('missing concurrency participant');
        waiting += 1;
        if (waiting === actions.length) releaseBarrier?.();
        await barrier;
        try {
          const result = await participant.action(client);
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      }),
    );
  } finally {
    clients.forEach((client) => client.release());
  }
}

export function asUser(userId: string) {
  return {
    async createCategory(input: CategoryInput): Promise<{ id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ id: string }>(
          `select * from public.create_category(
             $1, $2, $3::public.category_kind, $4, $5
           )`,
          [input.spaceId, input.requestId, input.kind, input.nameEn ?? null, input.nameAr ?? null],
        );
        const category = result.rows[0];

        if (!category) {
          throw new Error('create_category returned no category');
        }

        return category;
      });
    },
    async archiveCategory(
      spaceId: string,
      requestId: string,
      categoryId: string,
    ): Promise<{ id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ id: string }>(
          'select * from public.archive_category($1, $2, $3)',
          [spaceId, requestId, categoryId],
        );
        const category = result.rows[0];

        if (!category) {
          throw new Error('archive_category returned no category');
        }

        return category;
      });
    },
    async categoryCommandResult(
      spaceId: string,
      requestId: string,
    ): Promise<{ command_kind: string; category_id: string; created_at: Date } | undefined> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{
          command_kind: string;
          category_id: string;
          created_at: Date;
        }>('select * from public.get_category_command_result($1, $2)', [spaceId, requestId]);
        return result.rows[0];
      });
    },
    async recordCategorizedEvent(input: CategorizedFinancialEventInput): Promise<{ id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ id: string }>(
          `select * from public.record_categorized_financial_event(
             $1, $2, $3::public.financial_event_kind, $4::date, $5::jsonb, $6
           )`,
          [
            input.spaceId,
            input.requestId,
            input.kind,
            input.effectiveDate,
            JSON.stringify(input.movements),
            input.categoryId,
          ],
        );
        const event = result.rows[0];

        if (!event) {
          throw new Error('record_categorized_financial_event returned no event');
        }

        return event;
      });
    },
    async openLoanOutstanding(input: LoanOpeningInput): Promise<{ loan_id: string; event_id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ loan_id: string; event_id: string }>(
          `select *
           from public.open_loan_outstanding(
             $1, $2, $3::public.loan_direction, $4, $5::public.currency_code,
             $6, $7::date, $8::date, $9
           )`,
          [
            input.spaceId,
            input.requestId,
            input.direction,
            input.personName,
            input.currency,
            input.amountMinor,
            input.effectiveDate,
            input.dueDate ?? null,
            input.note ?? null,
          ],
        );
        const loan = result.rows[0];

        if (!loan) {
          throw new Error('open_loan_outstanding returned no loan');
        }

        return loan;
      });
    },
    async recordCashLoan(input: CashLoanInput): Promise<{ loan_id: string; event_id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ loan_id: string; event_id: string }>(
          `select *
           from public.record_cash_loan(
             $1, $2, $3::public.loan_direction, $4, $5::public.currency_code,
             $6, $7, $8::date, $9::date, $10
           )`,
          [
            input.spaceId,
            input.requestId,
            input.direction,
            input.personName,
            input.currency,
            input.walletId,
            input.amountMinor,
            input.effectiveDate,
            input.dueDate ?? null,
            input.note ?? null,
          ],
        );
        const loan = result.rows[0];

        if (!loan) {
          throw new Error('record_cash_loan returned no loan');
        }

        return loan;
      });
    },
    async repayLoan(input: LoanRepaymentInput): Promise<{ event_id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ event_id: string }>(
          'select * from public.record_loan_repayment($1, $2, $3, $4, $5, $6::date)',
          [
            input.spaceId,
            input.requestId,
            input.loanId,
            input.walletId,
            input.amountMinor,
            input.effectiveDate,
          ],
        );
        const repayment = result.rows[0];

        if (!repayment) {
          throw new Error('record_loan_repayment returned no event');
        }

        return repayment;
      });
    },
    async setLoanMonthlyTarget(input: LoanMonthlyTargetInput): Promise<{ id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ id: string }>(
          'select * from public.set_loan_monthly_target($1, $2, $3, $4::date, $5)',
          [input.spaceId, input.requestId, input.loanId, input.month, input.targetMinor],
        );
        const target = result.rows[0];

        if (!target) {
          throw new Error('set_loan_monthly_target returned no target');
        }

        return target;
      });
    },
    async monthlyLoanPlan(
      spaceId: string,
      month: string,
    ): Promise<Array<Record<string, string | null>>> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<Record<string, string | null>>(
          'select * from public.loan_monthly_plan($1, $2::date)',
          [spaceId, month],
        );

        return result.rows;
      });
    },
    async monthlyLoanCurrencySummary(
      spaceId: string,
      month: string,
    ): Promise<Array<Record<string, string | null>>> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<Record<string, string | null>>(
          'select * from public.loan_monthly_currency_summary($1, $2::date)',
          [spaceId, month],
        );

        return result.rows;
      });
    },
    async createSpace(name: string, kind: SpaceKind): Promise<Space> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<Space>(
          'select * from public.create_space($1, $2)',
          [name, kind],
        );
        const space = result.rows[0];

        if (!space) {
          throw new Error('create_space returned no space');
        }

        return space;
      });
    },
    async createWallet(spaceId: string, name: string, currency: Currency): Promise<Wallet> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<Wallet>(
          'select * from public.create_wallet($1, $2, $3::public.currency_code)',
          [spaceId, name, currency],
        );
        const wallet = result.rows[0];

        if (!wallet) {
          throw new Error('create_wallet returned no wallet');
        }

        return wallet;
      });
    },
    async recordEvent(input: FinancialEventInput): Promise<{ id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ id: string }>(
          `select *
           from public.record_financial_event(
             $1,
             $2,
             $3::public.financial_event_kind,
             $4::date,
             $5::jsonb
           )`,
          [
            input.spaceId,
            input.requestId,
            input.kind,
            input.effectiveDate,
            JSON.stringify(input.movements),
          ],
        );
        const event = result.rows[0];

        if (!event) {
          throw new Error('record_financial_event returned no event');
        }

        return event;
      });
    },
    async walletBalance(walletId: string): Promise<string> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ amount_minor: string }>(
          'select amount_minor from public.wallet_balances where wallet_id = $1',
          [walletId],
        );

        return result.rows[0]?.amount_minor ?? '0';
      });
    },
    async loanBalance(loanId: string): Promise<string> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ outstanding_minor: string }>(
          'select outstanding_minor from public.loan_balances where loan_id = $1',
          [loanId],
        );

        return result.rows[0]?.outstanding_minor ?? '0';
      });
    },
    async reconstructedLoanBalance(loanId: string): Promise<string> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ amount_minor: string }>(
          `select coalesce(sum(principal_delta_minor), 0)::text as amount_minor
           from public.loan_postings
           where loan_id = $1`,
          [loanId],
        );

        return result.rows[0]?.amount_minor ?? '0';
      });
    },
    async reconstructedWalletBalance(walletId: string): Promise<string> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ amount_minor: string }>(
          `select coalesce(sum(amount_minor), 0)::text as amount_minor
           from public.wallet_movements
           where wallet_id = $1`,
          [walletId],
        );

        return result.rows[0]?.amount_minor ?? '0';
      });
    },
    async updatePostedEvent(eventId: string): Promise<void> {
      return withUserSession(userId, async (client) => {
        await client.query(
          'update public.financial_events set effective_date = effective_date where id = $1',
          [eventId],
        );
      });
    },
    async deleteLoanPosting(eventId: string): Promise<void> {
      return withUserSession(userId, async (client) => {
        await client.query('delete from public.loan_postings where event_id = $1', [eventId]);
      });
    },
    async truncateLoanPostings(): Promise<void> {
      return withUserSession(userId, async (client) => {
        await client.query('truncate public.loan_postings');
      });
    },
    async reverseEvent(
      spaceId: string,
      requestId: string,
      eventId: string,
      effectiveDate: string,
    ): Promise<{ id: string }> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ id: string }>(
          'select * from public.reverse_financial_event($1, $2, $3, $4::date)',
          [spaceId, requestId, eventId, effectiveDate],
        );
        const event = result.rows[0];

        if (!event) {
          throw new Error('reverse_financial_event returned no event');
        }

        return event;
      });
    },
    async incomeEventCount(spaceId: string): Promise<number> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<{ count: string }>(
          `select count(*)::text as count
           from public.financial_events
           where space_id = $1
             and kind = 'income'`,
          [spaceId],
        );

        return Number(result.rows[0]?.count ?? '0');
      });
    },
  };
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
