/**
 * Local-only demo identities for the preview stack (never a real account,
 * never valid anywhere but the Supabase container on this machine).
 */
export interface DemoAccount {
  readonly key: 'story' | 'fresh';
  readonly email: string;
  readonly password: string;
  readonly labelEn: string;
  readonly labelAr: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    key: 'story',
    email: 'story@demo.budget.test',
    password: 'preview-only-story-2026',
    labelEn: 'Existing money (demonstrations 2–10)',
    labelAr: 'مال موجود (العروض ٢–١٠)',
  },
  {
    key: 'fresh',
    email: 'fresh@demo.budget.test',
    password: 'preview-only-fresh-2026',
    labelEn: 'Fresh start from zero (demonstration 1)',
    labelAr: 'بداية من الصفر (العرض ١)',
  },
];
