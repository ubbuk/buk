import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { eventBus, type LiveEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Нэвтрээгүй байна", { status: 401 });

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: LiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed (client disconnected) — ignore.
        }
      };
      const onUser = (event: LiveEvent) => send(event);
      const onBroadcast = (event: LiveEvent) => send(event);

      eventBus.on(`user:${userId}`, onUser);
      eventBus.on("broadcast", onBroadcast);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // ignore
        }
      }, 25000);

      const cleanup = () => {
        clearInterval(heartbeat);
        eventBus.off(`user:${userId}`, onUser);
        eventBus.off("broadcast", onBroadcast);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx-style reverse proxies not to buffer the stream, or events
      // would only arrive in bursts.
      "X-Accel-Buffering": "no",
    },
  });
}
