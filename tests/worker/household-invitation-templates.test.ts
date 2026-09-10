import { describe, expect, it } from 'vitest';

import { buildInvitationEmail } from '../../worker/household-invitations/templates.js';

const invitationToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE';
const expiresAt = '2026-09-17T12:00:00.000Z';

function tokenOccurrences(value: string): number[] {
  const indexes: number[] = [];
  let cursor = 0;
  for (let count = 0; count < 10; count += 1) {
    const index = value.indexOf(invitationToken, cursor);
    if (index < 0) break;
    indexes.push(index);
    cursor = index + invitationToken.length;
  }
  return indexes;
}

describe.each([
  ['en', 'ltr'],
  ['ar', 'rtl'],
] as const)('%s household invitation email', (locale, direction) => {
  it('has accessible language, direction, title, heading, and action markup', () => {
    const email = buildInvitationEmail({
      locale,
      appOrigin: 'https://budget.example.com',
      invitationToken,
      expiresAt,
    });

    expect(email.html).toContain(`<html lang="${locale}" dir="${direction}">`);
    expect(email.html).toMatch(
      new RegExp(`<body[^>]*>\\s*<div lang="${locale}" dir="${direction}"`),
    );
    expect(email.html.match(/<title>/g)).toHaveLength(1);
    expect(email.html.match(/<h1/g)).toHaveLength(1);
    expect(email.html).toContain('min-height:44px');
    expect(email.html).not.toContain('<img');
    expect(email.subject).not.toContain(invitationToken);
  });

  it('states the purpose, seven-day expiry, action, and recovery in HTML and text', () => {
    const email = buildInvitationEmail({
      locale,
      appOrigin: 'https://budget.example.com',
      invitationToken,
      expiresAt,
    });

    if (locale === 'en') {
      expect(`${email.subject} ${email.html} ${email.text}`).toContain('household');
      expect(email.html).toContain('seven days');
      expect(email.text).toContain('seven days');
      expect(email.html).toContain('Join the household');
      expect(email.text).toContain('If you were not expecting this invitation');
    } else {
      expect(`${email.subject} ${email.html} ${email.text}`).toContain('المنزلية');
      expect(email.html).toContain('سبعة أيام');
      expect(email.text).toContain('سبعة أيام');
      expect(email.html).toContain('الانضمام إلى المساحة المنزلية');
      expect(email.text).toContain('إذا لم تكن تتوقع هذه الدعوة');
    }
    expect(email.html).toContain(`<time datetime="${expiresAt}">`);
  });

  it('places every raw token occurrence after the URL fragment delimiter', () => {
    const email = buildInvitationEmail({
      locale,
      appOrigin: 'https://budget.example.com',
      invitationToken,
      expiresAt,
    });

    for (const content of [email.html, email.text]) {
      const occurrences = tokenOccurrences(content);
      expect(occurrences.length).toBeGreaterThan(0);
      for (const index of occurrences) {
        expect(content.slice(0, index).lastIndexOf('#')).toBeGreaterThan(
          content.slice(0, index).lastIndexOf('https://'),
        );
      }
    }
  });
});

describe('household invitation template escaping', () => {
  it('escapes dynamic URL and time attributes', () => {
    const email = buildInvitationEmail({
      locale: 'en',
      appOrigin: 'https://budget.example.com',
      invitationToken: 'safe-token&unexpected',
      expiresAt: '2026-09-17T12:00:00.000Z" onmouseover="unsafe',
    });

    expect(email.html).not.toContain('onmouseover="unsafe"');
    expect(email.html).toContain('safe-token%26unexpected');
    expect(email.text).toContain('safe-token%26unexpected');
  });
});
