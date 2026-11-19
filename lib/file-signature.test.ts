import { describe, expect, it } from "vitest";
import { signatureMatches } from "./file-signature";
import { signedBuffer } from "./attachment-fixtures";

const MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

describe("signatureMatches", () => {
  it("accepts bytes that carry the declared type's magic number", () => {
    for (const m of MIMES) expect(signatureMatches(m, signedBuffer(m, 64)), m).toBe(true);
  });

  it("rejects HTML, scripts and empty content under every declared type", () => {
    for (const m of MIMES) {
      expect(signatureMatches(m, Buffer.from("<html><script>alert(1)</script>")), m).toBe(false);
      expect(signatureMatches(m, Buffer.alloc(0)), m).toBe(false);
    }
  });

  it("does not let one type pass for another", () => {
    expect(signatureMatches("image/png", signedBuffer("image/jpeg", 64))).toBe(false);
    expect(signatureMatches("application/pdf", signedBuffer("image/png", 64))).toBe(false);
    expect(signatureMatches("image/webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]))).toBe(false); // RIFF but not WebP
  });

  it("allows a short junk prefix before the PDF header, and an .xlsx saved as .xls", () => {
    expect(signatureMatches("application/pdf", Buffer.concat([Buffer.from("\n\n  "), Buffer.from("%PDF-1.7")]))).toBe(true);
    expect(signatureMatches("application/vnd.ms-excel", signedBuffer("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 16))).toBe(true);
  });

  it("refuses an unknown MIME type outright", () => {
    expect(signatureMatches("image/heic", signedBuffer("image/jpeg", 64))).toBe(false);
    expect(signatureMatches("image/svg+xml", Buffer.from("<svg/>"))).toBe(false);
  });
});
