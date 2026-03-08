import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export const hasBrowserSupabaseEnv = () =>
  Boolean(env.supabaseUrl && env.supabaseAnonKey);

export const createSupabaseBrowserClient = () => {
  if (!hasBrowserSupabaseEnv()) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
    );
  }
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
};
