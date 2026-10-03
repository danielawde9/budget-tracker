export interface PgBase {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgBase: PgBase;
  }
}

export const SUPABASE_POSTGRES_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.166';
export const TEMPLATE_DATABASE = 'budget_template';
