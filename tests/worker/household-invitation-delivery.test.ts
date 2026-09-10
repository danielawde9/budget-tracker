import { describe, expect, it, vi } from 'vitest';

import {
  ProviderError,
  SafeDeliveryError,
  type AuditEvent,
  type InvitationCommand,
  type InvitationEmailProvider,
} from '../../worker/household-invitations/contracts.js';
import { createHouseholdInvitationDelivery } from '../../worker/household-invitations/deliver.js';

const now = new Date('2026-09-10T12:00:00.000Z');
const created = {
  invitationId: '22345678-9abc-4def-8123-456789abcdef',
  invitationToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE',
  expiresAt: '2026-09-17T12:00:00.000Z',
};
const request = {
  spaceId: '01234567-89ab-4def-8123-456789abcdef',
  requestId: '12345678-9abc-4def-8123-456789abcdef',
  inviteeEmail: 'person@example.com',
  locale: 'en' as const,
};
const bearerToken = 'header.payload.signature';

function harness(overrides: {
  command?: InvitationCommand;
  provider?: InvitationEmailProvider;
  currentTime?: Date;
} = {}) {
  const events: AuditEvent[] = [];
  const sleeps: number[] = [];
  const command = overrides.command ?? {
    create: vi.fn().mockResolvedValue(created),
  };
  const provider = overrides.provider ?? {
    send: vi.fn().mockResolvedValue({ providerMessageId: 'provider-id' }),
  };
  const service = createHouseholdInvitationDelivery({
    command,
    provider,
    configuration: {
      appOrigin: 'https://budget.example.com',
      invitationFrom: 'Budget <invitations@updates.example.com>',
      invitationReplyTo: 'support@example.com',
    },
    audit: {
      async record(event) {
        events.push(event);
      },
    },
    clock: { now: () => overrides.currentTime ?? now },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    jitter: () => 50,
  });
  return { service, command, provider, events, sleeps };
}

describe('household invitation delivery service', () => {
  it('creates once and sends one localized email with stable invitation idempotency', async () => {
    const { service, command, provider, events } = harness();

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).resolves.toEqual({
      invitationId: created.invitationId,
      expiresAt: created.expiresAt,
      delivery: 'accepted',
    });

    expect(command.create).toHaveBeenCalledOnce();
    expect(command.create).toHaveBeenCalledWith({
      bearerToken,
      spaceId: request.spaceId,
      requestId: request.requestId,
      inviteeEmail: request.inviteeEmail,
    });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Budget <invitations@updates.example.com>',
        replyTo: 'support@example.com',
        to: request.inviteeEmail,
        locale: 'en',
        idempotencyKey: `household-invitation/${created.invitationId}`,
      }),
    );
    expect(events.map((event) => event.event)).toEqual([
      'invitation_command_accepted',
      'provider_attempt_started',
      'provider_accepted',
    ]);
  });

  it('retries only retryable provider failures with two bounded delays', async () => {
    const provider = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new ProviderError('network', true))
        .mockRejectedValueOnce(new ProviderError('rate_limited', true))
        .mockResolvedValueOnce({ providerMessageId: 'provider-id' }),
    };
    const { service, command, sleeps, events } = harness({ provider });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).resolves.toMatchObject({ delivery: 'accepted' });

    expect(command.create).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([300, 550]);
    expect(events.filter((event) => event.event === 'provider_retry_scheduled')).toHaveLength(2);
  });

  it('does not retry a permanent provider rejection', async () => {
    const provider = {
      send: vi.fn().mockRejectedValue(new ProviderError('forbidden', false)),
    };
    const { service, command, events, sleeps } = harness({ provider });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).rejects.toMatchObject({ code: 'delivery_failed', status: 502 });

    expect(command.create).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledOnce();
    expect(sleeps).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      event: 'provider_failed',
      reason: 'forbidden',
      attempt: 1,
    });
  });

  it('stops after three transient attempts', async () => {
    const provider = {
      send: vi.fn().mockRejectedValue(new ProviderError('server_error', true)),
    };
    const { service, command, events, sleeps } = harness({ provider });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).rejects.toMatchObject({ code: 'delivery_unavailable', status: 503 });

    expect(command.create).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([300, 550]);
    expect(events.at(-1)).toMatchObject({
      event: 'provider_failed',
      reason: 'server_error',
      attempt: 3,
    });
  });

  it('refuses a provider retry when the invitation is 23 hours old', async () => {
    const currentTime = new Date('2026-09-11T11:00:00.000Z');
    const { service, command, provider, events } = harness({ currentTime });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).rejects.toMatchObject({ code: 'delivery_status_ambiguous', status: 409 });

    expect(command.create).toHaveBeenCalledOnce();
    expect(provider.send).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      event: 'provider_failed',
      reason: 'idempotency_window_closed',
    });
  });

  it('preserves a command rejection and never calls the provider', async () => {
    const commandError = new SafeDeliveryError('invitation_command_rejected', 403);
    const command = { create: vi.fn().mockRejectedValue(commandError) };
    const { service, provider, events } = harness({ command });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).rejects.toBe(commandError);

    expect(provider.send).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        event: 'invitation_command_rejected',
        reason: 'invitation_command_rejected',
      }),
    ]);
  });

  it('keeps every audit event and public error free of sensitive request data', async () => {
    const providerMarker = 'provider leaked a raw token';
    const provider = { send: vi.fn().mockRejectedValue(new Error(providerMarker)) };
    const { service, events } = harness({ provider });
    let publicError: unknown;

    try {
      await service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' });
    } catch (error) {
      publicError = error;
    }

    const evidence = JSON.stringify({ events, publicError });
    for (const sensitive of [
      request.inviteeEmail,
      request.spaceId,
      request.requestId,
      created.invitationId,
      created.invitationToken,
      bearerToken,
      providerMarker,
      'https://budget.example.com/#',
    ]) {
      expect(evidence).not.toContain(sensitive);
    }
    expect(evidence).toContain('hashed-correlation');
  });

  it('fails closed once when command acceptance cannot be audited', async () => {
    const command = { create: vi.fn().mockResolvedValue(created) };
    const provider = { send: vi.fn() };
    const record = vi.fn().mockRejectedValue(new Error('audit backend detail'));
    const service = createHouseholdInvitationDelivery({
      command,
      provider,
      configuration: {
        appOrigin: 'https://budget.example.com',
        invitationFrom: 'Budget <invitations@updates.example.com>',
        invitationReplyTo: 'support@example.com',
      },
      audit: { record },
      clock: { now: () => now },
      sleep: vi.fn(),
      jitter: () => 0,
    });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).rejects.toMatchObject({ code: 'audit_unavailable', status: 503 });
    expect(command.create).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('does not reinterpret a post-send audit failure as a provider failure', async () => {
    const command = { create: vi.fn().mockResolvedValue(created) };
    const provider = { send: vi.fn().mockResolvedValue({ providerMessageId: 'provider-id' }) };
    const record = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audit backend detail'));
    const service = createHouseholdInvitationDelivery({
      command,
      provider,
      configuration: {
        appOrigin: 'https://budget.example.com',
        invitationFrom: 'Budget <invitations@updates.example.com>',
        invitationReplyTo: 'support@example.com',
      },
      audit: { record },
      clock: { now: () => now },
      sleep: vi.fn(),
      jitter: () => 0,
    });

    await expect(
      service.deliver({ request, bearerToken, correlationKey: 'hashed-correlation' }),
    ).rejects.toMatchObject({ code: 'audit_unavailable', status: 503 });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledTimes(3);
  });
});
