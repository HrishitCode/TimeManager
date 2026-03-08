import { NextResponse } from "next/server";

export const badRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

export const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export const conflict = (message: string) =>
  NextResponse.json({ error: message }, { status: 409 });

export const serverError = (message = "Unexpected server error") =>
  NextResponse.json({ error: message }, { status: 500 });
