import type { ExchangeClient, RecordExchangeInput } from '../features/exchange/types.js';

export class InMemoryExchangeClient implements ExchangeClient {
  calls: Array<{ name: string; input: RecordExchangeInput }> = [];
  error: Error | null = null;
  result: { eventId: string } = { eventId: 'evt-1' };

  async recordExchange(input: RecordExchangeInput): Promise<{ eventId: string }> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'recordExchange', input });
    return this.result;
  }
}
