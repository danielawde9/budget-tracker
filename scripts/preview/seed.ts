/**
 * Seeds the LOCAL preview stack: creates the demo users through the local
 * Auth admin API, then signs in as the story user and runs the ten
 * demonstrations through the same public commands the app uses.
 * Refuses to touch anything that is not a loopback Supabase URL.
 */
import { createClient } from '@supabase/supabase-js';
import { DEMO_ACCOUNTS } from './demo-accounts.ts';
import { runExistingMoneyStory, type ScenarioCaller } from './scenario.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const url = required('SUPABASE_URL');
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
  throw new Error(`Refusing to seed a non-local Supabase (${host}).`);
}
const anonKey = required('SUPABASE_ANON_KEY');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

for (const account of DEMO_ACCOUNTS) {
  const { error } = await admin.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true });
  if (error) throw new Error(`Could not create ${account.email}: ${error.message}`);
}

const story = DEMO_ACCOUNTS.find((account) => account.key === 'story');
if (!story) throw new Error('No story account');
const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const signIn = await user.auth.signInWithPassword({ email: story.email, password: story.password });
if (signIn.error) throw new Error(`Could not sign in as ${story.email}: ${signIn.error.message}`);

const caller: ScenarioCaller = {
  async call<T>(rpc: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await user.rpc(rpc, args);
    if (error) throw new Error(`${rpc} failed: ${error.message} ${error.details ?? ''}`);
    return data as T;
  },
};

const refs = await runExistingMoneyStory(caller, 'Household');
process.stdout.write(`Seeded the story space ${refs.spaceId} (setup ${refs.setupMonth}, current ${refs.currentMonth}).\n`);
