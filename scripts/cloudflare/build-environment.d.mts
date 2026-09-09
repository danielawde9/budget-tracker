export type CloudflareBuildEnvironment = Readonly<{
  supabaseUrl: string;
  anonKey: string;
}>;

export function validateCloudflareBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): CloudflareBuildEnvironment;
