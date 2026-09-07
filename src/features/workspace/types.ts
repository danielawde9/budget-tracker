import type { Currency, Space, SpaceKind, Wallet } from '../loans/types.js';

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

export interface WorkspaceGateway {
  listSpaces(): Promise<readonly Space[]>;
  listWallets(spaceId: string): Promise<readonly Wallet[]>;
  createSpace(input: CreateSpaceInput): Promise<CreatedRecord>;
  createWallet(input: CreateWalletInput): Promise<CreatedRecord>;
}
