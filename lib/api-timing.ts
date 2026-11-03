import { NextResponse } from "next/server";

// Structured, one-line-per-request latency logging for the highest-traffic
// routes. Deliberately minimal (stdout JSON, no APM/collector) — enough to
// spot a slow endpoint or a regression in logs/terminal without adding new
// infrastructure. Never logs request/response bodies, so it can't leak a
// password, PIN, or other sensitive field.
export function withTiming<Args extends unknown[]>(
  route: string,
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    const startedAt = Date.now();
    try {
      const res = await handler(...args);
      console.log(JSON.stringify({ route, status: res.status, durationMs: Date.now() - startedAt }));
      return res;
    } catch (err) {
      console.log(JSON.stringify({ route, status: 500, durationMs: Date.now() - startedAt, error: true }));
      throw err;
    }
  };
}
