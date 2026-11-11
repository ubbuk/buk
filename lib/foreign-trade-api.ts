import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { authOptions } from "./auth";
import { loadActor, type FtResult, type IncomingFile } from "./foreign-trade";
import type { FtActor } from "./foreign-trade-rules";

// Shared plumbing of the /api/foreign-trade routes. Authentication and the request shape are handled here; every
// authorization decision is made again, per order, in lib/foreign-trade.ts.

/** Roles that take part in the module at all. Others are refused up front; the per-order rules still decide the rest. */
const MODULE_ROLES = new Set(["BOSS", "MANAGER", "DIRECTOR", "ENGINEERING", "CHIEF_ACCOUNTANT", "ADMIN"]);

export async function ftContext(): Promise<{ actor: FtActor } | { response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) return { response: NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 }) };
  if (!MODULE_ROLES.has(session.user.role)) return { response: NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 }) };
  return { actor: await loadActor(session.user) };
}

export async function ftBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { response: NextResponse.json({ error: first?.message && first.message !== "Required" ? first.message : "Хүчингүй өгөгдөл" }, { status: 400 }) };
  }
  return { data: parsed.data };
}

export function ftRespond<T>(result: FtResult<T>, okStatus = 200): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: okStatus });
}

export async function readFiles(entries: FormDataEntryValue[]): Promise<IncomingFile[]> {
  const files: IncomingFile[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") continue;
    const buffer = Buffer.from(await entry.arrayBuffer());
    files.push({ fileName: entry.name || "file", mimeType: entry.type || "application/octet-stream", sizeBytes: buffer.byteLength, buffer });
  }
  return files;
}

export type IdParams = { params: Promise<{ id: string }> };
