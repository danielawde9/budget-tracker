import type { InvitationLocale } from './contracts.js';

export interface InvitationEmailInput {
  readonly locale: InvitationLocale;
  readonly appOrigin: string;
  readonly invitationToken: string;
  readonly expiresAt: string;
}

export interface InvitationEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

interface LocalizedCopy {
  readonly action: string;
  readonly direction: 'ltr' | 'rtl';
  readonly expiry: (date: string) => string;
  readonly heading: string;
  readonly intro: string;
  readonly language: InvitationLocale;
  readonly recovery: string;
  readonly subject: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function displayExpiry(expiresAt: string, locale: InvitationLocale): string {
  const parsed = new Date(expiresAt);
  if (!Number.isFinite(parsed.getTime())) return expiresAt;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(parsed);
}

function localizedCopy(locale: InvitationLocale): LocalizedCopy {
  if (locale === 'ar') {
    return {
      action: 'الانضمام إلى المساحة المنزلية',
      direction: 'rtl',
      expiry: (value) => `تنتهي صلاحية رابط الدعوة في ${value}، خلال سبعة أيام.`,
      heading: 'دعوة إلى مساحة منزلية',
      intro: 'دعاك أحد مالكي المساحة للانضمام إلى مساحته المنزلية في دفتر الميزانية.',
      language: 'ar',
      recovery: 'إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة والتواصل مع الدعم.',
      subject: 'دعوة للانضمام إلى مساحة منزلية في دفتر الميزانية',
    };
  }
  return {
    action: 'Join the household',
    direction: 'ltr',
    expiry: (value) => `This invitation link expires on ${value}, within seven days.`,
    heading: 'Household invitation',
    intro: 'A space owner invited you to join their household space in Budget Ledger.',
    language: 'en',
    recovery: 'If you were not expecting this invitation, ignore this email and contact support.',
    subject: "You're invited to a household space in Budget Ledger",
  };
}

export function buildInvitationEmail(input: InvitationEmailInput): InvitationEmail {
  const copy = localizedCopy(input.locale);
  const acceptanceUrl = `${input.appOrigin}/#household-invitation=${encodeURIComponent(input.invitationToken)}`;
  const safeUrl = escapeHtml(acceptanceUrl);
  const safeExpiresAt = escapeHtml(input.expiresAt);
  const expiry = copy.expiry(displayExpiry(input.expiresAt, input.locale));

  return {
    subject: copy.subject,
    html: `<!doctype html>
<html lang="${copy.language}" dir="${copy.direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;background:#f4f1e8;color:#17211b;font-family:Arial,sans-serif;">
<div lang="${copy.language}" dir="${copy.direction}" style="max-width:600px;margin:0 auto;padding:32px 20px;text-align:${copy.direction === 'rtl' ? 'right' : 'left'};">
  <h1 style="font-size:24px;line-height:1.3;margin:0 0 20px;">${escapeHtml(copy.heading)}</h1>
  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">${escapeHtml(copy.intro)}</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 24px;"><time datetime="${safeExpiresAt}">${escapeHtml(expiry)}</time></p>
  <p style="margin:0 0 24px;">
    <a href="${safeUrl}" style="display:inline-flex;min-height:44px;align-items:center;padding:0 20px;background:#176b4d;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:6px;">${escapeHtml(copy.action)}</a>
  </p>
  <p style="font-size:16px;line-height:1.6;margin:0;">${escapeHtml(copy.recovery)}</p>
</div>
</body>
</html>`,
    text: `${copy.heading}\n\n${copy.intro}\n\n${expiry}\n\n${copy.action}: ${acceptanceUrl}\n\n${copy.recovery}`,
  };
}
