import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchConfig, dispatchSync, DispatchError, heavyRefreshMode } from "./github-dispatch";

const TOKEN = "github_pat_secret_value_123";
const ENV = { VERCEL: "1", GITHUB_DISPATCH_TOKEN: TOKEN, GITHUB_REPOSITORY: "acme/erp", GITHUB_DISPATCH_REF: "main" };

afterEach(() => vi.unstubAllGlobals());

describe("heavyRefreshMode: хүнд татаалт Vercel дээр route-д биш", () => {
  it("Vercel биш бол route дотор (inline): dev, staging, тест", () => {
    expect(heavyRefreshMode({})).toBe("inline");
    expect(heavyRefreshMode({ GITHUB_DISPATCH_TOKEN: TOKEN, GITHUB_REPOSITORY: "acme/erp" })).toBe("inline");
  });
  it("Vercel дээр токен, репо тохируулсан бол GitHub Actions руу, үгүй бол боломжгүй", () => {
    expect(heavyRefreshMode(ENV)).toBe("dispatch");
    expect(heavyRefreshMode({ VERCEL: "1" })).toBe("unavailable");
    expect(heavyRefreshMode({ ...ENV, GITHUB_DISPATCH_TOKEN: "" })).toBe("unavailable");
    expect(heavyRefreshMode({ ...ENV, GITHUB_REPOSITORY: "not a repo" })).toBe("unavailable");
  });
  it("тохиргоо: ref анхдагч main, буруу ref татгалзана", () => {
    expect(dispatchConfig({ ...ENV, GITHUB_DISPATCH_REF: undefined })?.ref).toBe("main");
    expect(dispatchConfig({ ...ENV, GITHUB_DISPATCH_REF: "refs/heads/x; rm" })).toBeNull();
  });
});

describe("dispatchSync", () => {
  it("workflow_dispatch-ыг нэг POST-оор (зөвхөн GitHub руу, mode ба month-той) дуудна", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await dispatchSync({ mode: "month", month: "2026-10" }, ENV);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/erp/actions/workflows/sync-1c.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { mode: "month", month: "2026-10" } });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("алдаа гарвал (4xx, 5xx, сүлжээ) токенгүй ерөнхий мессеж", async () => {
    for (const impl of [async () => new Response("bad credentials " + TOKEN, { status: 401 }), async () => new Response("x", { status: 500 }), async () => Promise.reject(new Error("ECONNRESET " + TOKEN))]) {
      vi.stubGlobal("fetch", vi.fn(impl));
      const err = await dispatchSync({ mode: "receivables", month: "2026-10" }, ENV).catch((e) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect(String(err.message)).not.toContain(TOKEN);
    }
  });

  it("тохиргоогүй бол GitHub руу хандахгүй", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(dispatchSync({ mode: "month", month: "2026-10" }, { VERCEL: "1" })).rejects.toBeInstanceOf(DispatchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
