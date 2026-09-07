import { Pool, type PoolClient } from 'pg';

export type SpaceKind = 'personal' | 'household';
export type Currency = 'USD' | 'LBP';
export type FinancialEventKind = 'opening_balance' | 'income' | 'expense' | 'transfer';
export type LoanDirection = 'they_owe_me' | 'i_owe_them';

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
  max: 2,
});

async function withUserSession<T>(
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

export function asUser(userId: string) {
  return {
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
