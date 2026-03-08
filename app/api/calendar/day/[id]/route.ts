import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const { id } = await params;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("time_bookings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return serverError(error.message);
  return NextResponse.json({ success: true });
}
