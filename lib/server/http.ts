import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const unauthorized = () => new HttpError(401, "Not signed in");
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, msg, extra);

export const parseBody = async <T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be JSON");
  }
  return schema.parse(raw);
};

type Ctx = { params: Promise<Record<string, string>> };

/** Wrap a route handler: maps HttpError/ZodError to JSON responses, logs the rest. */
export const route =
  <C extends Ctx = Ctx>(handler: (req: NextRequest, ctx: C) => Promise<unknown>) =>
  async (req: NextRequest, ctx: C) => {
    try {
      const result = await handler(req, ctx);
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
      }
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return NextResponse.json(
          { error: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid input" },
          { status: 400 }
        );
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return NextResponse.json({ error: "Something went wrong on the server" }, { status: 500 });
    }
  };
