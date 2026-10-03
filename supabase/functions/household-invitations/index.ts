import { createInvitationFunction } from './handler.ts';

const handler = createInvitationFunction({
  fetch: globalThis.fetch.bind(globalThis),
  audit: { async record(event) { console.log(JSON.stringify(event)); } },
  clock: { now: () => new Date() },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  jitter: () => crypto.getRandomValues(new Uint8Array(1))[0]! % 101,
});

Deno.serve((request) => handler(request, {
  APP_ORIGIN: Deno.env.get('APP_ORIGIN') ?? '',
  APP_ALLOWED_ORIGINS: Deno.env.get('APP_ALLOWED_ORIGINS') ?? '',
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
  HOUSEHOLD_INVITATION_FROM: Deno.env.get('HOUSEHOLD_INVITATION_FROM') ?? '',
  HOUSEHOLD_INVITATION_REPLY_TO: Deno.env.get('HOUSEHOLD_INVITATION_REPLY_TO') ?? '',
}));
