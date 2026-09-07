import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LoansDataClient } from '../loans/supabase-loans-gateway.js';
import { createSupabaseWorkspaceGateway } from './supabase-workspace-gateway.js';

function recordingClient(rowsByRelation: Record<string, unknown[]> = {}) {
  const calls: Array<{ type: 'from' | 'eq' | 'limit' | 'rpc'; name: string; value?: unknown }> = [];
  const client: LoansDataClient = {
    from(relation) {
      calls.push({ type: 'from', name: relation });
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { calls.push({ type: 'eq', name: column, value }); return builder; },
        is: () => builder,
        order: () => builder,
        limit: (count: number) => { calls.push({ type: 'limit', name: relation, value: count }); return Promise.resolve({ data: rowsByRelation[relation] ?? [], error: null }); },
      };
      return builder;
    },
    async rpc(name, args) {
      calls.push({ type: 'rpc', name, value: args });
      return { data: [{ id: name === 'create_space' ? 'space-new' : 'wallet-new' }], error: null };
    },
  };
  return { client, calls };
}

describe('Supabase workspace gateway', () => {
  it('uses bounded safe reads for visible spaces and wallets', async () => {
    const recorder = recordingClient({
      spaces: [{ id: 'space-1', name: 'My money', kind: 'personal' }],
      wallets: [{ id: 'wallet-1', space_id: 'space-1', name: 'Daily USD', currency: 'USD', archived_at: null }],
    });
    const gateway = createSupabaseWorkspaceGateway(recorder.client);

    await expect(gateway.listSpaces()).resolves.toEqual([{ id: 'space-1', name: 'My money', kind: 'personal' }]);
    await expect(gateway.listWallets('space-1')).resolves.toEqual([{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null }]);
    expect(recorder.calls).toContainEqual({ type: 'eq', name: 'space_id', value: 'space-1' });
    expect(recorder.calls.filter((call) => call.type === 'limit').map((call) => call.value)).toEqual([501, 501]);
  });

  it('creates a space and wallet only through their exact protected commands', async () => {
    const recorder = recordingClient();
    const gateway = createSupabaseWorkspaceGateway(recorder.client);

    await expect(gateway.createSpace({ name: 'Our home', kind: 'household' })).resolves.toEqual({ id: 'space-new' });
    await expect(gateway.createWallet({ spaceId: 'space-new', name: 'Home USD', currency: 'USD' })).resolves.toEqual({ id: 'wallet-new' });

    expect(recorder.calls.filter((call) => call.type === 'rpc')).toEqual([
      { type: 'rpc', name: 'create_space', value: { p_name: 'Our home', p_kind: 'household' } },
      { type: 'rpc', name: 'create_wallet', value: { p_space_id: 'space-new', p_name: 'Home USD', p_currency: 'USD' } },
    ]);
  });

  it('rejects overflowing reads instead of silently truncating', async () => {
    const recorder = recordingClient({ spaces: Array.from({ length: 501 }, (_, index) => ({ id: `space-${index}`, name: `Space ${index}`, kind: 'personal' })) });
    await expect(createSupabaseWorkspaceGateway(recorder.client).listSpaces()).rejects.toThrow('Spaces has more than 500 rows');
  });

  it('keeps every browser data gateway free of direct protected-table writes', () => {
    const featureRoot = resolve(process.cwd(), 'src/features');
    const gatewayFiles = readdirSync(resolve(featureRoot, 'loans')).filter((name) => name.endsWith('gateway.ts')).map((name) => resolve(featureRoot, 'loans', name));
    gatewayFiles.push(...readdirSync(resolve(featureRoot, 'workspace')).filter((name) => name.endsWith('gateway.ts')).map((name) => resolve(featureRoot, 'workspace', name)));
    const source = gatewayFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(source).not.toMatch(/\.(?:insert|update|delete|upsert|truncate)\s*\(/);
    const onboardingSource = readFileSync(resolve(featureRoot, 'workspace/supabase-workspace-gateway.ts'), 'utf8');
    expect([...onboardingSource.matchAll(/runCommand\('([^']+)'/g)].map((match) => match[1])).toEqual(['create_space', 'create_wallet']);
  });
});
