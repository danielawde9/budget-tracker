import { useCallback, useEffect, useRef, useState } from 'react';
import type { Space, Wallet } from '../loans/types.js';
import {
  clearOnboardingProgress,
  readOnboardingProgress,
  writeOnboardingProgress,
  type OnboardingProgress,
  type OnboardingSetup,
} from './onboarding-progress.js';
import type { CreateSpaceInput, CreateWalletInput, CreatedRecord, WorkspaceGateway } from './types.js';
import { setActiveSpaceClock } from './space-clock.js';
import { readWelcomeSeen, writeWelcomeSeen } from './welcome-seen.js';

export type WorkspaceStatus = 'loading' | 'empty' | 'onboarding' | 'ready' | 'error';

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
  const [setup, setSetup] = useState<OnboardingSetup | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef('');
  const spacesRef = useRef<readonly Space[]>([]);
  const request = useRef(0);

  const storageKey = `budget:selected-space:${userId}`;

  const load = useCallback(async (resetSelection: boolean, preferredSpaceId = '') => {
    const requestId = ++request.current;
    setStatus('loading');
    setError(null);
    setShowWelcome(false);
    if (resetSelection) {
      selectedRef.current = '';
      setSelectedSpaceId('');
      setSpaces([]);
      spacesRef.current = [];
    }
    try {
      const visibleSpaces = await gateway.listSpaces();
      if (request.current !== requestId) return;
      spacesRef.current = visibleSpaces;
      setSpaces(visibleSpaces);
      if (visibleSpaces.length === 0) {
        selectedRef.current = '';
        setSelectedSpaceId('');
        localStorage.removeItem(storageKey);
        clearOnboardingProgress(userId);
        setSetup(null);
        setShowWelcome(false);
        setActiveSpaceClock(null);
        setStatus('empty');
        return;
      }
      // A stored first-run setup resumes before the shell appears, so a person
      // who abandoned after the space step can still create the missing wallet
      // (and, later, the starting balance).
      const progress = readOnboardingProgress(userId);
      if (progress) {
        const pending = visibleSpaces.find((space) => space.id === progress.spaceId);
        if (!pending) {
          clearOnboardingProgress(userId);
        } else {
          let wallet: Wallet | undefined;
          try {
            wallet = (await gateway.listWallets(progress.spaceId))[0];
          } catch {
            // The wallet read only decides whether to skip ahead; trust the stored step.
            wallet = undefined;
          }
          if (request.current !== requestId) return;
          setSetup({ ...progress, ...(wallet ? { wallet: { id: wallet.id, currency: wallet.currency } } : {}) });
          setShowWelcome(false);
          setStatus('onboarding');
          return;
        }
      }
      setSetup(null);
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
      // W4a-1: the server owns "today". Load the selected space's clock before
      // the shell renders so the Control Room never derives its own month/as-of.
      const clock = await gateway.loadSpaceClock(selected);
      if (request.current !== requestId) return;
      setActiveSpaceClock(clock);
      setStatus('ready');
      // Recomputed from the flag: a refresh closes a replayed tour (replay it
      // again if that happens); dismissal always wins because it writes the flag.
      setShowWelcome(!readWelcomeSeen(userId));
    } catch {
      if (request.current !== requestId) return;
      spacesRef.current = [];
      setSpaces([]);
      setSetup(null);
      setShowWelcome(false);
      selectedRef.current = '';
      setSelectedSpaceId('');
      setActiveSpaceClock(null);
      setError('We could not load your spaces. Check your connection and try again.');
      setStatus('error');
    }
  }, [gateway, storageKey, userId]);

  useEffect(() => {
    void load(true);
    return () => { request.current += 1; };
  }, [load]);

  // Clear the shared clock when the workspace unmounts (e.g. sign-out), so a
  // later mount never renders against a stale space's "today".
  useEffect(() => () => { setActiveSpaceClock(null); }, []);

  const selectSpace = useCallback((spaceId: string) => {
    if (!spaces.some((space) => space.id === spaceId)) return;
    selectedRef.current = spaceId;
    setSelectedSpaceId(spaceId);
    localStorage.setItem(storageKey, spaceId);
    void gateway.loadSpaceClock(spaceId).then(
      (clock) => { if (selectedRef.current === spaceId) setActiveSpaceClock(clock); },
      () => { if (selectedRef.current === spaceId) setActiveSpaceClock(null); },
    );
  }, [spaces, storageKey, gateway]);

  const saveOnboardingProgress = useCallback((progress: OnboardingProgress) => {
    writeOnboardingProgress(userId, progress);
    setSetup(progress);
  }, [userId]);

  const finishOnboarding = useCallback((spaceId?: string) => {
    clearOnboardingProgress(userId);
    // A person who just completed first-run setup skips the welcome tour.
    writeWelcomeSeen(userId);
    setShowWelcome(false);
    setSetup(null);
    return load(false, spaceId ?? '');
  }, [load, userId]);

  const dismissWelcome = useCallback(() => {
    writeWelcomeSeen(userId);
    setShowWelcome(false);
  }, [userId]);

  const replayWelcome = useCallback(() => {
    setShowWelcome(true);
  }, []);

  const createFirstSpace = useCallback(async (input: CreateSpaceInput): Promise<CreatedRecord> => {
    try {
      return await gateway.createSpace(input);
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw rejected('space');
      // Recovery accepts only a space that was not visible before this command:
      // a space that already existed with the same name is not the created one.
      const known = new Set(spacesRef.current.map((space) => space.id));
      let visible: readonly Space[] = [];
      try {
        visible = await gateway.listSpaces();
      } catch {
        throw new Error('We checked your visible spaces, but the connection is still unavailable. Reconnect before trying again.');
      }
      const normalizedName = input.name.trim();
      const match = visible.find((space) => !known.has(space.id) && space.kind === input.kind && space.name === normalizedName);
      if (match) return { id: match.id };
      throw new Error('We checked your visible spaces. Nothing matched, so review the name before trying again.');
    }
  }, [gateway]);

  const createFirstWallet = useCallback(async (input: CreateWalletInput): Promise<CreatedRecord> => {
    let visibleBefore: readonly Wallet[];
    try {
      visibleBefore = await gateway.listWallets(input.spaceId);
    } catch {
      throw new Error('We checked your visible wallets, but the connection is still unavailable. Reconnect before trying again.');
    }
    const known = new Set(visibleBefore.map((wallet) => wallet.id));
    try {
      return await gateway.createWallet(input);
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw rejected('wallet');
      // Recovery accepts only a wallet that appeared after the failed command:
      // a wallet that already existed with the same name and currency is not the created one.
      let visible: readonly Wallet[];
      try {
        visible = await gateway.listWallets(input.spaceId);
      } catch {
        throw new Error('We checked your visible wallets, but the connection is still unavailable. Reconnect before trying again.');
      }
      const normalizedName = input.name.trim();
      const match = visible.find((wallet) => !known.has(wallet.id) && wallet.currency === input.currency && wallet.name === normalizedName);
      if (!match) throw new Error('We checked your visible wallets. Nothing matched, so review the wallet before trying again.');
      return { id: match.id };
    }
  }, [gateway]);

  const refresh = useCallback((preferredSpaceId?: string) => load(false, preferredSpaceId), [load]);

  return {
    status,
    spaces,
    selectedSpaceId,
    selectedSpace: spaces.find((space) => space.id === selectedSpaceId) ?? null,
    onboardingSetup: setup,
    showWelcome,
    dismissWelcome,
    replayWelcome,
    error,
    selectSpace,
    refresh,
    saveOnboardingProgress,
    finishOnboarding,
    createFirstSpace,
    createFirstWallet,
  };
}
