import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';

afterAll(async () => {
  await closeDatabase();
});

describe('financial journal foundation', () => {
  it('creates an owner-managed private space', async () => {
    const owner = asUser(ownerId);

    await expect(owner.createSpace('Daniel private', 'personal')).resolves.toMatchObject({
      id: expect.any(String),
    });
  });
});
