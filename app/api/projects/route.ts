import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const createProjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(4).max(20)
});

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) return serverError(error.message);
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      color: parsed.data.color
    })
    .select("*")
    .single();

  if (error) return serverError(error.message);
  return NextResponse.json(data, { status: 201 });
}
