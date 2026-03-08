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

const patchTaskSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["todo", "done", "skipped"]).optional(),
  description: z.string().nullable().optional(),
  scheduledFor: nullableDate.optional(),
  priority: z.number().int().min(1).max(5).nullable().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = patchTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const { id } = await params;
  const patch: Record<string, string | number | null> = {};
  if (parsed.data.title) patch.title = parsed.data.title;
  if (parsed.data.status) {
    patch.status = parsed.data.status;
    patch.completed_at = parsed.data.status === "done" ? new Date().toISOString() : null;
  }
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.scheduledFor !== undefined) patch.scheduled_for = parsed.data.scheduledFor;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return serverError(error.message);
  return NextResponse.json(data);
}
