import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asAnon, asUser, callAs, createUser, rpc } from './support/actor.ts';
import { setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

let db: TestDatabase;
let h: BudgetHarness;
let wallet: string;
const clientId = randomUUID();
beforeAll(async () => { db = await freshDatabase(); h = await setupSpace(db.pool); wallet = await h.wallet('Cash', 'cash', 'USD', 100000n); });
afterAll(async () => { await db?.close(); });

const credentials = new Map<string,string>();
const hash = (v:string) => createHash('sha256').update(v).digest('hex');
async function connect(client = clientId, name = 'Codex') {
  const token = randomBytes(32).toString('hex'), code = randomBytes(32).toString('hex');
  await h.call('mcp_grant_client', { p_client: client, p_space: h.spaceId, p_name: name, p_token_hash: hash(token), p_code_hash: hash(code) });
  credentials.set(client,token);
  await asAnon(db.pool,c=>rpc(c,'mcp_exchange_code',{p_client:client,p_code:code,p_token:token}));
  return {token,code};
}
async function connector<T = Record<string, unknown>>(name: string, args = {}, client = clientId): Promise<T> {
  return asAnon(db.pool,c => rpc<T>(c,name,{...args,p_token:credentials.get(client) ?? '0'.repeat(64)}));
}
const income = () => ({ p_request: randomUUID(), p_kind: 'income', p_wallet: wallet, p_currency: 'USD', p_amount: '12345', p_on: h.today });

it('binds context to the authorized user/client/space, with no balances or history', async () => {
  await connect();
  const context = await connector('mcp_context');
  expect(context).toMatchObject({ spaceId: h.spaceId, today: h.today, wallets: [{ id: wallet, name: 'Cash', currency: 'USD' }] });
  expect(JSON.stringify(context)).not.toMatch(/balance|entries|email/);
  await expect(connector('mcp_context', {}, randomUUID())).rejects.toMatchObject({ code: '42501' });
  await expect(asAnon(db.pool,c=>rpc(c,'mcp_context',{p_token:'f'.repeat(64)}))).rejects.toMatchObject({code:'42501'});
});
it('posts exact income once, reconciles a receipt and refuses changed retries', async () => {
  await connect();
  const args = income();
  const before = await h.walletBalance(wallet);
  const [a, b] = await Promise.all([connector('mcp_record_entry', args), connector('mcp_record_entry', args)]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ status: 'posted', requestId: args.p_request, kind: 'income', amountMinor: '12345', currency: 'USD' });
  expect(await h.walletBalance(wallet)).toBe(before + 12345n);
  expect(await connector('mcp_entry_status', { p_request: args.p_request })).toEqual(a);
  await expect(connector('mcp_record_entry', { ...args, p_amount: '12346' })).rejects.toMatchObject({ message: 'BUDGET_REQUEST_CONFLICT' });
});
it('saves an unfunded expense directly using app coverage rules and preserves Arabic notes', async () => {
  await connect();
  const args = { ...income(), p_kind: 'expense', p_item: await h.item('Other essentials'), p_amount: '2000', p_memo: 'قهوة' };
  const before = await h.walletBalance(wallet);
  const receipt = await connector('mcp_record_entry', args);
  expect(receipt).toMatchObject({ kind: 'expense', amountMinor: '2000', memo: 'قهوة', coveredMinor: '2000' });
  expect(await h.walletBalance(wallet)).toBe(before - 2000n);
});
it('denies generic commands, table access and grant creation to the connector backend role', async () => {
  await expect(asAnon(db.pool,c=>rpc(c,'record_income',{p_space:h.spaceId,p_request:randomUUID(),p_wallet:wallet,p_amount:'1',p_on:h.today}))).rejects.toMatchObject({code:'42501'});
  await expect(asAnon(db.pool,c=>rpc(c,'create_space',{p_request:randomUUID(),p_name:'No'}))).rejects.toMatchObject({code:'42501'});
  await expect(asAnon(db.pool,c=>c.query('select * from budget.entries'))).rejects.toMatchObject({code:'42501'});
  await expect(asAnon(db.pool,c=>rpc(c,'mcp_grant_client',{p_client:clientId,p_space:h.spaceId,p_name:'No',p_token_hash:'0'.repeat(64),p_code_hash:'0'.repeat(64)}))).rejects.toMatchObject({code:'42501'});
});
it('refuses invalid money, wrong currency and another space wallet', async () => {
  await connect();
  for (const p_amount of ['0', '-1', '1.1', '1000000000000001']) {
    await expect(connector('mcp_record_entry', { ...income(), p_amount })).rejects.toThrow();
  }
  await expect(connector('mcp_record_entry', { ...income(), p_currency: 'LBP' })).rejects.toThrow();
  const other = await setupSpace(db.pool);
  const otherWallet = await other.wallet('Private', 'cash', 'USD');
  await expect(connector('mcp_record_entry', { ...income(), p_wallet: otherWallet })).rejects.toThrow();
});
it('keeps LBP as exact whole lira and namespaces request IDs by client', async () => {
  await connect();
  const lbp = await h.wallet('LBP', 'cash', 'LBP');
  const args = { ...income(), p_wallet: lbp, p_currency: 'LBP', p_amount: '89500' };
  await connector('mcp_record_entry', args);
  const secondClient = randomUUID();
  await connect(secondClient,'Other client');
  await connector('mcp_record_entry', args, secondClient);
  expect(await h.walletBalance(lbp)).toBe(179000n);
});
it('rechecks membership and cannot expose another grant receipts', async () => {
  await connect();
  const args = income();
  await connector('mcp_record_entry', args);
  const otherClient = randomUUID();
  await connect(otherClient,'Other');
  expect(await connector('mcp_entry_status', { p_request: args.p_request }, otherClient)).toMatchObject({ status: 'not_found' });
  await db.pool.query('update budget.space_members set role=$1 where user_id=$2 and space_id=$3', ['member', h.userId, h.spaceId]);
  await expect(connector('mcp_context')).rejects.toMatchObject({ code: '42501' });
  await db.pool.query('update budget.space_members set role=$1 where user_id=$2 and space_id=$3', ['owner', h.userId, h.spaceId]);
});
it('revokes reads, writes and receipts immediately without affecting browser commands', async () => {
  await connect();
  await h.call('mcp_revoke_client', { p_client: clientId });
  for (const [name, args] of [['mcp_context', {}], ['mcp_record_entry', income()], ['mcp_entry_status', { p_request: randomUUID() }]] as const) {
    await expect(connector(name, args)).rejects.toMatchObject({ code: '42501' });
  }
  await expect(h.command('record_income', { p_wallet: wallet, p_amount: '1', p_on: h.today })).resolves.toHaveProperty('entryId');
});
it('allows only owners to grant and refuses OAuth impersonation of the browser', async () => {
  const stranger = await createUser(db.pool);
  await expect(callAs(db.pool, stranger, 'mcp_grant_client', { p_client: clientId, p_space: h.spaceId, p_name: 'No', p_token_hash:'0'.repeat(64),p_code_hash:'0'.repeat(64) })).rejects.toThrow();
  await expect(asUser(db.pool, h.userId, async c => {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: h.userId, client_id: clientId })]);
    return rpc(c, 'mcp_grant_client', { p_client: clientId, p_space: h.spaceId, p_name: 'No', p_token_hash:'0'.repeat(64),p_code_hash:'0'.repeat(64) });
  })).rejects.toThrow();
});
it('consumes connection codes once and stores no plaintext credentials', async () => {
  const {token,code}=await connect();
  await expect(asAnon(db.pool,c=>rpc(c,'mcp_exchange_code',{p_client:clientId,p_token:token,p_code:code}))).rejects.toMatchObject({code:'42501'});
  const row=await db.pool.query('select token_hash,code_hash from budget.mcp_grants where user_id=$1 and client_id=$2',[h.userId,clientId]);
  expect(row.rows[0]).toEqual({token_hash:hash(token),code_hash:null});
});
