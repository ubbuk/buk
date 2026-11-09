import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getOwnProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

// The signed-in employee's own profile. Identity comes ONLY from the server session: the route
// takes no id (query, path or header values are never read), so nobody can ask for another
// person's profile, ADMIN included. Read-only on purpose: there is no write handler here.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const profile = await getOwnProfile(session.user.id);
  if (!profile) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  // Personal data: never cached by the browser or a shared cache.
  return NextResponse.json(profile, { headers: { "Cache-Control": "private, no-store" } });
}
