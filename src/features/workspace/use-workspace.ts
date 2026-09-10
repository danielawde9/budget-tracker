import { useCallback, useEffect, useRef, useState } from 'react';
import type { Space } from '../loans/types.js';
import type { CreateSpaceInput, CreateWalletInput, CreatedRecord, WorkspaceGateway } from './types.js';

export type WorkspaceStatus = 'loading' | 'empty' | 'ready' | 'error';

function isAmbiguousTransportFailure(cause: unknown): boolean {
  const value = cause instanceof Error
    ? cause.message
    : cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
      ? cause.message
      : '';
  return /network|failed to fetch|load failed|connection|timeout/i.test(value);
}

function rejected(label: 'space' | 'wallet'): Error {
  return new Error(`The ${label} was not created. Check the entered details and try again.`);
}

export function useWorkspace(gateway: WorkspaceGateway, userId: string) {
  const [status, setStatus] = useState<WorkspaceStatus>('loading');
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef('');
  const request = useRef(0);

  const storageKey = `budget:selected-space:${userId}`;

  const load = useCallback(async (resetSelection: boolean, preferredSpaceId = '') => {
    const requestId = ++request.current;
    setStatus('loading');
    setError(null);
    if (resetSelection) {
      selectedRef.current = '';
      setSelectedSpaceId('');
      setSpaces([]);
    }
    try {
      const visibleSpaces = await gateway.listSpaces();
      if (request.current !== requestId) return;
      setSpaces(visibleSpaces);
      if (visibleSpaces.length === 0) {
        selectedRef.current = '';
        setSelectedSpaceId('');
        localStorage.removeItem(storageKey);
        setStatus('empty');
        return;
      }
      const stored = localStorage.getItem(storageKey) ?? '';
      const current = resetSelection ? '' : selectedRef.current;
      const selected = visibleSpaces.find((space) => space.id === preferredSpaceId)?.id
        ?? visibleSpaces.find((space) => space.id === current)?.id
        ?? visibleSpaces.find((space) => space.id === stored)?.id
        ?? visibleSpaces[0]?.id
        ?? '';
      selectedRef.current = selected;
      setSelectedSpaceId(selected);
      localStorage.setItem(storageKey, selected);
      setStatus('ready');
    } catch {
      if (request.current !== requestId) return;
      setSpaces([]);
      selectedRef.current = '';
      setSelectedSpaceId('');
      setError('We could not load your spaces. Check your connection and try again.');
      setStatus('error');
    }
  }, [gateway, storageKey]);

  useEffect(() => {
    void load(true);
    return () => { request.current += 1; };
  }, [load]);

  const selectSpace = useCallback((spaceId: string) => {
    if (!spaces.some((space) => space.id === spaceId)) return;
    selectedRef.current = spaceId;
    setSelectedSpaceId(spaceId);
    localStorage.setItem(storageKey, spaceId);
  }, [spaces, storageKey]);

  const createFirstSpace = useCallback(async (input: CreateSpaceInput): Promise<CreatedRecord> => {
    try {
      return await gateway.createSpace(input);
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw rejected('space');
      let visible: readonly Space[] = [];
      try {
        visible = await gateway.listSpaces();
      } catch {
        throw new Error('We checked your visible spaces, but the connection is still unavailable. Reconnect before trying again.');
      }
      const normalizedName = input.name.trim();
      const match = visible.find((space) => space.kind === input.kind && space.name === normalizedName);
      if (match) return { id: match.id };
      throw new Error('We checked your visible spaces. Nothing matched, so review the name before trying again.');
    }
  }, [gateway]);

  const createFirstWallet = useCallback(async (input: CreateWalletInput): Promise<CreatedRecord> => {
    let created: CreatedRecord;
    try {
      created = await gateway.createWallet(input);
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw rejected('wallet');
      let visible = [] as Awaited<ReturnType<WorkspaceGateway['listWallets']>>;
      try {
        visible = await gateway.listWallets(input.spaceId);
      } catch {
        throw new Error('We checked your visible wallets, but the connection is still unavailable. Reconnect before trying again.');
      }
      const normalizedName = input.name.trim();
      const match = visible.find((wallet) => wallet.currency === input.currency && wallet.name === normalizedName);
      if (!match) throw new Error('We checked your visible wallets. Nothing matched, so review the wallet before trying again.');
      created = { id: match.id };
    }
    await load(false);
    return created;
  }, [gateway, load]);

  return {
    status,
    spaces,
    selectedSpaceId,
    selectedSpace: spaces.find((space) => space.id === selectedSpaceId) ?? null,
    error,
    selectSpace,
    refresh: (preferredSpaceId?: string) => load(false, preferredSpaceId),
    createFirstSpace,
    createFirstWallet,
  };
}
