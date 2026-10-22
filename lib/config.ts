// Runtime configuration. With no Supabase keys the app runs in "local mode":
// one user, data in a JSON file under .data/, no sign-in and no invites.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const MODEL_MAIN = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const MODEL_QUICK = process.env.ANTHROPIC_MODEL_QUICK || 'claude-haiku-5-5';

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const LOCAL_USER_NAME = process.env.LOCAL_USER_NAME || '';

export function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function isAdminEmail(email?: string | null) {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export function siteUrl(reqUrl?: string) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (reqUrl) return new URL(reqUrl).origin;
  return 'http://localhost:3000';
}
