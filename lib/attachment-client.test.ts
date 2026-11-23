import { describe, expect, it, vi } from "vitest";
import { checkPickedFile, finalizeUploads, guessMime, isTransientStatus, UploadError, withRetry } from "./attachment-client";
import { fitWithin, jpegName } from "./image-compress";

const file = (name: string, type: string, size = 100) => ({ name, type, size }) as File;

describe("fitWithin", () => {
  it("scales the long edge down to the limit, keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });
  it("never scales up", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});

describe("jpegName", () => {
  it("swaps the extension", () => {
    expect(jpegName("IMG_1234.HEIC")).toBe("IMG_1234.jpg");
    expect(jpegName("my.photo.png")).toBe("my.photo.jpg");
    expect(jpegName("noext")).toBe("noext.jpg");
  });
});

describe("picked files", () => {
  it("recovers the type of documents an Android picker hands over without one", () => {
    expect(guessMime(file("a.pdf", ""))).toBe("application/pdf");
    expect(guessMime(file("a.XLSX", ""))).toContain("spreadsheetml");
  });
  it("accepts HEIC (converted later), refuses unknown types, empty files and absurd originals", () => {
    expect(checkPickedFile(file("IMG.HEIC", ""))).toBeNull();
    expect(checkPickedFile(file("x.exe", "application/x-msdownload"))).toContain("дэмжинэ");
    expect(checkPickedFile(file("a.pdf", "application/pdf", 0))).toContain("хоосон");
    expect(checkPickedFile(file("a.pdf", "application/pdf", 21 * 1024 * 1024))).toContain("20 MB");
    expect(checkPickedFile(file("a.pdf", "application/pdf", 19 * 1024 * 1024))).toBeNull();
    expect(checkPickedFile(file("big.jpg", "image/jpeg", 61 * 1024 * 1024))).toContain("60 MB");
    expect(checkPickedFile(file("photo.jpg", "image/jpeg", 12 * 1024 * 1024))).toBeNull(); // compressed before the limit applies
  });
});

describe("withRetry", () => {
  it("retries a network failure up to three times, then gives up with the last error", async () => {
    let calls = 0;
    const seen: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new UploadError("Сүлжээ тасарлаа", 0, true);
        },
        (attempt) => seen.push(attempt),
        [0, 0, 0]
      )
    ).rejects.toThrow("Сүлжээ тасарлаа");
    expect(calls).toBe(4); // first try + 3 automatic retries
    expect(seen).toEqual([1, 2, 3]);
  });

  it("succeeds as soon as an attempt does", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 3) throw new UploadError("x", 503, true);
        return "ok";
      },
      () => undefined,
      [0, 0, 0]
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry an answer that will not change (wrong type, no permission)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new UploadError("Зөвшөөрөлгүй", 403, false);
        },
        () => undefined,
        [0, 0, 0]
      )
    ).rejects.toThrow("Зөвшөөрөлгүй");
    expect(calls).toBe(1);
  });
});

describe("which failures are retried", () => {
  it("only timeouts, throttling and a briefly unavailable service; a plain 500 is shown at once", () => {
    for (const s of [408, 429, 502, 503, 504]) expect(isTransientStatus(s), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 413, 500]) expect(isTransientStatus(s), String(s)).toBe(false);
  });

  it("a storage setting/key fault (500 with its message) is not retried and keeps its sentence; an unreachable store (503) and a dropped network are", async () => {
    const answer = (status: number, error: string) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error }), { status }));
    answer(500, "Файл хадгалах сангийн тохиргоо буруу байна. Системийн админд мэдэгдэнэ үү");
    const config = await finalizeUploads<never>("/x", []).catch((e: UploadError) => e);
    expect(config).toBeInstanceOf(UploadError);
    expect(config.message).toBe("Файл хадгалах сангийн тохиргоо буруу байна. Системийн админд мэдэгдэнэ үү");
    expect(config.retryable).toBe(false);

    answer(503, "Файл хадгалах сантай холбогдож чадсангүй. Дахин оролдоно уу");
    expect((await finalizeUploads<never>("/x", []).catch((e: UploadError) => e)).retryable).toBe(true);

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await finalizeUploads<never>("/x", []).catch((e: UploadError) => e)).retryable).toBe(true);

    // and through withRetry: the config fault is attempted exactly once
    answer(500, "x");
    let calls = 0;
    await withRetry(async () => { calls++; return finalizeUploads("/x", []); }, () => undefined, [0, 0, 0]).catch(() => undefined);
    expect(calls).toBe(1);
    vi.unstubAllGlobals();
  });
});
