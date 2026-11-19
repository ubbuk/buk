import { describe, expect, it } from "vitest";
import { checkPickedFile, guessMime, UploadError, withRetry } from "./attachment-client";
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
