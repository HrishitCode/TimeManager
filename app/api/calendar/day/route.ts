import { endOfDay, parseISO, startOfDay } from "date-fns";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const createBookingSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  startIso: z.string().datetime(),
  endIso: z.string().datetime()
});

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const day = parseISO(`${date}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return badRequest("Invalid date");

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("time_bookings")
    .select("*")
    .eq("user_id", user.id)
    .gte("starts_at", startOfDay(day).toISOString())
    .lte("starts_at", endOfDay(day).toISOString())
    .order("starts_at", { ascending: true });

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Calendar schema missing. Run supabase/migrations/0003_calendar.sql." },
        { status: 503 }
      );
    }
    return serverError(error.message);
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const start = new Date(parsed.data.startIso);
  const end = new Date(parsed.data.endIso);
  if (start >= end) return badRequest("End time must be after start time");

  const supabase = createSupabaseAdminClient();

  const overlap = await supabase
    .from("time_bookings")
    .select("*")
    .eq("user_id", user.id)
    .lt("starts_at", end.toISOString())
    .gt("ends_at", start.toISOString())
    .limit(1)
    .maybeSingle();

  if (overlap.error) {
    if (overlap.error.code === "42P01") {
      return NextResponse.json(
        { error: "Calendar schema missing. Run supabase/migrations/0003_calendar.sql." },
        { status: 503 }
      );
    }
    return serverError(overlap.error.message);
  }
  if (overlap.data) {
    return NextResponse.json(
      {
        error: "Selected slot overlaps with an existing booking.",
        overlap: overlap.data
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("time_bookings")
    .insert({
      user_id: user.id,
      project_id: parsed.data.projectId,
      task_id: parsed.data.taskId ?? null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString()
    })
    .select("*")
    .single();

  if (error) return serverError(error.message);
  return NextResponse.json(data, { status: 201 });
}
