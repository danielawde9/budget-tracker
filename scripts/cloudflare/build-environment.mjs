const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const ALLOWED_VITE_VARIABLES = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value || /^replace-/i.test(value)) {
    throw new Error(`${name} is required for the Cloudflare production build`);
  }
  return value;
}

export function validateCloudflareBuildEnvironment(environment) {
  for (const name of Object.keys(environment)) {
    if (name.startsWith('VITE_') && !ALLOWED_VITE_VARIABLES.has(name)) {
      throw new Error(`${name} is not allowed in the Cloudflare production build`);
    }
  }

  const supabaseUrl = required(environment, 'VITE_SUPABASE_URL');
  const anonKey = required(environment, 'VITE_SUPABASE_ANON_KEY');

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('VITE_SUPABASE_URL must be a credential-free HTTPS URL');
  }
  if (!PUBLISHABLE_KEY.test(anonKey)) {
    throw new Error('VITE_SUPABASE_ANON_KEY must contain the browser publishable key');
  }

  return { supabaseUrl, anonKey };
}
