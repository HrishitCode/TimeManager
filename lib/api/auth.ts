import { NextRequest } from "next/server";
import { createSupabaseAnonClient } from "@/lib/supabase/server";

export const getBearerToken = (request: NextRequest): string | null => {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
};

export const getAuthedUser = async (request: NextRequest) => {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const anon = createSupabaseAnonClient();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }
  return data.user;
};
