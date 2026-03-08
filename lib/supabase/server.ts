import { createClient } from "@supabase/supabase-js";
import { assertServerEnv, env } from "@/lib/env";

export const createSupabaseAdminClient = () => {
  assertServerEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

export const createSupabaseAnonClient = () => {
  assertServerEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};
