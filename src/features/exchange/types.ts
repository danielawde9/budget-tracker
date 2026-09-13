export interface RecordExchangeInput {
  spaceId: string;
  requestId: string;
  usdWalletId: string;
  lbpWalletId: string;
  usdAmountMinor: string;
  lbpAmountMinor: string;
  effectiveDate: string;
}

export interface ExchangeClient {
  recordExchange(input: RecordExchangeInput): Promise<{ eventId: string }>;
}
