import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_alloctplhead');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()), ($2, 'outsider@budget.invalid', now())`,
    [actor, outsider],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      'select id from public.create_space($1, $2) limit 2', [name, kind],
    );
    return space.rows[0]!.id;
  });
}

function templateGroup(id: string, purpose: 'spending' | 'future', order: number, basisPoints: number, nameEn: string | null = 'Group', nameAr: string | null = null) {
  return { id, purpose, nameEn, nameAr, order, basisPoints };
}

async function saveTemplate(input: {
  spaceId: string; requestId?: string; currency?: 'USD' | 'LBP'; expectedRevisionId?: number | null;
  groups: unknown[]; rootMappings: unknown[]; asActor?: string;
}) {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ save_allocation_template: { templateRevisionId: string } }>(
      'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [input.spaceId, input.requestId ?? randomUUID(), input.currency ?? 'USD', input.expectedRevisionId ?? null,
        JSON.stringify(input.groups), JSON.stringify(input.rootMappings)],
    );
    return result.rows[0]!.save_allocation_template;
  });
}

async function head(spaceId: string, user: string = actor): Promise<string | null> {
  return withAuthenticatedTransaction(db().client, user, async () => {
    const result = await db().client.query<{ head: { templateRevisionId: string | null } }>(
      "select public.allocation_template_head($1, 'USD') as head", [spaceId]);
    return result.rows[0]!.head.templateRevisionId;
  });
}

describe('allocation_template_head', () => {
  it('is null before any template and the latest revision after saves', async () => {
    const spaceId = await freshSpace('Template head');
    expect(await head(spaceId)).toBeNull();
    const groupId = randomUUID();
    const first = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    expect(await head(spaceId)).toBe(first.templateRevisionId);
    const second = await saveTemplate({
      spaceId, expectedRevisionId: Number(first.templateRevisionId),
      groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [],
    });
    expect(await head(spaceId)).toBe(second.templateRevisionId);
  });

  it('lets a second month save against the head even though that month has no snapshot', async () => {
    const spaceId = await freshSpace('Template head second month');
    const groupId = randomUUID();
    await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    const current = await head(spaceId);
    await expect(saveTemplate({
      spaceId, expectedRevisionId: Number(current), groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [],
    })).resolves.toMatchObject({ templateRevisionId: expect.stringMatching(/^\d+$/) });
  });

  it('allows an active household member and refuses an outsider', async () => {
    const spaceId = await freshSpace('Template head access', 'household');
    const member = randomUUID();
    await db().client.query(`insert into auth.users(id, email, email_confirmed_at) values ($1,'th-member@budget.invalid', now())`, [member]);
    await db().client.query(`insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`, [spaceId, member]);
    await expect(head(spaceId, member)).resolves.toBeNull();
    await expect(head(spaceId, outsider)).rejects.toMatchObject({ code: '42501' });
  });
});
