import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const patchProjectSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(4).max(20).optional(),
  archivedAt: z.string().datetime().nullable().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = patchProjectSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const { id } = await params;
  const patch: Record<string, string | null> = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.color) patch.color = parsed.data.color;
  if (parsed.data.archivedAt !== undefined) patch.archived_at = parsed.data.archivedAt;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return serverError(error.message);
  return NextResponse.json(data);
}
