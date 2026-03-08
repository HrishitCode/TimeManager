import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const nullableDate = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) return value;
  return asDate.toISOString();
}, z.string().datetime().nullable());

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  kind: z.enum(["daily", "future"]),
  scheduledFor: nullableDate.optional(),
  priority: z.number().int().min(1).max(5).nullable().optional()
});

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return serverError(error.message);
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const supabase = createSupabaseAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      project_id: parsed.data.projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      kind: parsed.data.kind,
      scheduled_for: parsed.data.scheduledFor ?? null,
      priority: parsed.data.priority ?? null,
      recurrence_date: parsed.data.kind === "daily" ? today : null
    })
    .select("*")
    .single();

  if (error) return serverError(error.message);
  return NextResponse.json(data, { status: 201 });
}
