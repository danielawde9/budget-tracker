import { describe, expect, it } from 'vitest';

import { findHouseholdDirectWrites, findSensitiveLogging } from './household-source-ratchet.js';

describe('household browser source ratchet', () => {
  it.each([
    `await client.from('space_memberships').update({ role: 'owner' })`,
    `const tableName = 'space_memberships';
     await client.from(tableName).update({ role: 'owner' });`,
    `let tableName = 'space_memberships';
     await client.from(tableName).update({ role: 'owner' });`,
    `const tableName = 'household_invitations'
     await client.from(tableName).delete().eq('id', invitationId)`,
    `const invitations = client
       .from('household_invitations');
     await invitations.delete().eq('id', invitationId);`,
    `const events = client.from('household_membership_events');
     await events.upsert(rows);`,
  ])('detects protected-table writes across direct and aliased chains', (source) => {
    expect(findHouseholdDirectWrites(source)).toHaveLength(1);
  });

  it.each([
    `console.error({ invitation_token: result.invitation_token });`,
    `logger.warn(
       'session refresh failed',
       { access_token: session.access_token }
     );`,
    `const metrics = analytics;
     metrics.track('invite', { refresh_token: session.refresh_token });`,
    `const warn = console.warn;
     warn({ invitation_token });`,
    `const { error } = console;
     error({ invitation_token });`,
    `const { error: report } = console
     report({ invitation_token })`,
    `const report = console.warn
     report({ invitation_token })`,
    `const metrics = analytics
     metrics.identify(userId, { access_token })`,
    `const identify = analytics.identify
     identify(userId, { access_token })`,
    `const payload = { invitation_token };
     logger.warn(payload);`,
    `analytics.identify(userId, { access_token });`,
    `const { refresh_token: secret } = session;
     const payload = { secret };
     telemetry.capture(payload);`,
  ])('detects sensitive data passed to console, logger, analytics, and aliased sinks', (source) => {
    expect(findSensitiveLogging(source)).toHaveLength(1);
  });

  it('allows protected reads, unrelated writes, and non-logging token handling', () => {
    const source = `
      await client.from('space_memberships').select('*');
      await client.from('preferences').update({ locale: 'ar' });
      const invitation_token = await deriveToken();
      return digest(invitation_token);
      console.error('invitation unavailable');
      console.error('invitation_token missing');
      logger.warn({ status: 'invitation_token missing' });
      analytics.identify(userId, { status: 'access_token unavailable' });
      const report = console.warn
      report('invitation_token missing')
    `;
    expect(findHouseholdDirectWrites(source)).toEqual([]);
    expect(findSensitiveLogging(source)).toEqual([]);
  });
});
