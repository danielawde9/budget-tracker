import { useCallback, useEffect, useRef, useState } from 'react';
import type { Space } from '../loans/types.js';
import type { WorkspaceGateway } from './types.js';

export type WorkspaceStatus = 'loading' | 'empty' | 'ready' | 'error';

export function useWorkspace(gateway: WorkspaceGateway, userId: string) {
  const [status, setStatus] = useState<WorkspaceStatus>('loading');
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef('');
  const request = useRef(0);

  const storageKey = `budget:selected-space:${userId}`;

  const load = useCallback(async (resetSelection: boolean) => {
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
      const selected = visibleSpaces.find((space) => space.id === current)?.id
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

  return {
    status,
    spaces,
    selectedSpaceId,
    selectedSpace: spaces.find((space) => space.id === selectedSpaceId) ?? null,
    error,
    selectSpace,
    refresh: () => load(false),
  };
}
