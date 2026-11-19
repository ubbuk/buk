export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** fetch wrapper of the foreign trade pages: JSON in / out, errors reduced to the server's Mongolian message. */
export async function ftApi<T = unknown>(url: string, init?: { method?: string; json?: unknown; form?: FormData }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? (init?.json || init?.form ? "POST" : "GET"),
      headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.form ?? (init?.json !== undefined ? JSON.stringify(init.json) : undefined),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: (body && body.error) || `Серверийн алдаа (${res.status})` };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "Сүлжээний алдаа. Дахин оролдоно уу" };
  }
}

export const inputClass = "focus-ring h-10 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text placeholder:text-text-muted";
export const textareaClass = "focus-ring w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted";
