import type { ExchangeClient, RecordExchangeInput } from './types.js';

interface ExchangeDataClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The database returned an invalid row.');
  }
  return value as Row;
}

function textValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new Error(`The database row is missing ${key}.`);
  return result;
}

export function createExchangeClient(client: ExchangeDataClient): ExchangeClient {
  return {
    async recordExchange(input: RecordExchangeInput) {
      const { data, error } = await client.rpc('record_usd_to_lbp_exchange', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_usd_wallet_id: input.usdWalletId,
        p_lbp_wallet_id: input.lbpWalletId,
        p_usd_amount_minor: input.usdAmountMinor,
        p_lbp_amount_minor: input.lbpAmountMinor,
        p_effective_date: input.effectiveDate,
      });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data) || data.length !== 1) throw new Error('Exchange command returned an unexpected result.');
      return { eventId: textValue(asRow(data[0]), 'id') };
    },
  };
}
