/** Public Supabase project settings. Never put a service_role / secret key in this PWA. */
export const SUPABASE_STORAGE_CONFIG = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'PASTE_SUPABASE_PUBLISHABLE_KEY',
  bucket: 'kora-cards',
} as const;
