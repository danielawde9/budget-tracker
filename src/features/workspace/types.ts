import type { Currency, Space, SpaceKind, Wallet } from '../loans/types.js';
import type { SpaceClock } from './space-clock.js';

export interface CreateSpaceInput {
  name: string;
  kind: SpaceKind;
}

export interface CreateWalletInput {
  spaceId: string;
  name: string;
  currency: Currency;
}

export interface CreatedRecord {
  id: string;
}

/**
 * The starting-balance command the first-run wizard hands to the caller.
 * `requestId` stays fixed across retries so the opening balance is posted at
 * most once (`record_financial_event` is idempotent per `(space_id, request_id)`).
 */
export interface OpeningBalanceInput {
  spaceId: string;
  walletId: string;
  amountMinor: string;
  requestId: string;
}

export interface WorkspaceGateway {
  listSpaces(): Promise<readonly Space[]>;
  listWallets(spaceId: string): Promise<readonly Wallet[]>;
  /** W4a-1: the server's single clock for the space (`public.space_clock`). */
  loadSpaceClock(spaceId: string): Promise<SpaceClock>;
  createSpace(input: CreateSpaceInput): Promise<CreatedRecord>;
  createWallet(input: CreateWalletInput): Promise<CreatedRecord>;
}
