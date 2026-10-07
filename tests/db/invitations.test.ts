import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { asAnon, callAs, createUser, rpc } from './support/actor.ts';
import { rawSpace, type RawSpace } from './support/raw.ts';
let db: TestDatabase;
let space: RawSpace;
let recipient: string;
const email = 'guest@test.local';
const token = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
beforeAll(async () => { db = await freshDatabase(); space = await rawSpace(db.pool); recipient = await createUser(db.pool, email); });
afterAll(async () => { await db?.close(); });
const create = (secret: string, recipientEmail = email, request = randomUUID()) => callAs<{ invitationId: string; expiresAt: string }>(db.pool, space.userId, 'create_space_invitation', { p_space: space.spaceId, p_request: request, p_email: recipientEmail, p_token: secret });
it('only the owner creates invitations and browser roles cannot read the token table', async () => {
  await expect(callAs(db.pool, recipient, 'create_space_invitation', { p_space: space.spaceId, p_request: randomUUID(), p_email: email, p_token: token() })).rejects.toMatchObject({ message: 'BUDGET_OWNER_REQUIRED' });
  await expect(asAnon(db.pool, c => rpc(c, 'space_invitations', { p_space: space.spaceId }))).rejects.toMatchObject({ code: '42501' });
  await expect(db.pool.query("select relrowsecurity from pg_class where oid = 'budget.space_invitations'::regclass")).resolves.toMatchObject({ rows: [{ relrowsecurity: true }] });
});
it('binds acceptance to the recipient email, stores only a digest and replays safely', async () => {
  const secret = token(); const request = randomUUID();
  const invite = await create(secret, email, request);
  expect(await create(secret, email, request)).toEqual(invite);
  const stored = await db.pool.query('select token_hash from budget.space_invitations where id=$1', [invite.invitationId]);
  expect(stored.rows[0].token_hash).not.toEqual(secret);
  await expect(callAs(db.pool, space.userId, 'accept_space_invitation', { p_token: secret })).rejects.toMatchObject({ message: 'BUDGET_INVITATION_INVALID' });
  expect(await callAs(db.pool, recipient, 'accept_space_invitation', { p_token: secret })).toEqual({ spaceId: space.spaceId });
  expect(await callAs(db.pool, recipient, 'accept_space_invitation', { p_token: secret })).toEqual({ spaceId: space.spaceId });
  const members = await db.pool.query('select role from budget.space_members where space_id=$1 and user_id=$2', [space.spaceId, recipient]);
  expect(members.rows).toEqual([{ role: 'member' }]);
  await expect(callAs(db.pool, recipient, 'space_invitations', { p_space: space.spaceId })).rejects.toMatchObject({ message: 'BUDGET_OWNER_REQUIRED' });
});
it('rejects expired and revoked invitations without adding membership', async () => {
  const guestEmail = 'another@test.local'; const guest = await createUser(db.pool, guestEmail);
  const revoked = token(); const invite = await create(revoked, guestEmail);
  await callAs(db.pool, space.userId, 'revoke_space_invitation', { p_space: space.spaceId, p_invitation: invite.invitationId });
  await expect(callAs(db.pool, guest, 'accept_space_invitation', { p_token: revoked })).rejects.toMatchObject({ message: 'BUDGET_INVITATION_INVALID' });
  const expired = token(); const old = await create(expired, guestEmail);
  await db.pool.query("update budget.space_invitations set expires_at=now()-interval '1 second' where id=$1", [old.invitationId]);
  await expect(callAs(db.pool, guest, 'accept_space_invitation', { p_token: expired })).rejects.toMatchObject({ message: 'BUDGET_INVITATION_INVALID' });
  expect((await db.pool.query('select 1 from budget.space_members where user_id=$1', [guest])).rows).toEqual([]);
});
it('requires a confirmed email and invalidates a replaced link', async () => {
  const address = 'confirm@test.local'; const guest = await createUser(db.pool, address);
  await db.pool.query('update auth.users set email_confirmed_at=null where id=$1', [guest]);
  const first = token(); await create(first, address);
  await expect(callAs(db.pool, guest, 'accept_space_invitation', { p_token: first })).rejects.toMatchObject({ message: 'BUDGET_INVITATION_INVALID' });
  await db.pool.query('update auth.users set email_confirmed_at=now() where id=$1', [guest]);
  const second = token(); await create(second, address);
  await expect(callAs(db.pool, guest, 'accept_space_invitation', { p_token: first })).rejects.toMatchObject({ message: 'BUDGET_INVITATION_INVALID' });
  expect(await callAs(db.pool, guest, 'accept_space_invitation', { p_token: second })).toEqual({ spaceId: space.spaceId });
});
it('can replace a pending link when the space already has twenty pending invitations', async () => {
  const full = await rawSpace(db.pool);
  for (let i=0; i<20; i++) await callAs(db.pool, full.userId, 'create_space_invitation', { p_space: full.spaceId, p_request: randomUUID(), p_email: `limit${i}@test.local`, p_token: token() });
  await expect(callAs(db.pool, full.userId, 'create_space_invitation', { p_space: full.spaceId, p_request: randomUUID(), p_email: 'limit0@test.local', p_token: token() })).resolves.toHaveProperty('invitationId');
  expect(await callAs<unknown[]>(db.pool, full.userId, 'space_invitations', { p_space: full.spaceId })).toHaveLength(20);
});
