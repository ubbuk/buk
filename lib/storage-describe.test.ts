import { afterEach, describe, expect, it, vi } from "vitest";
import { describeStorage } from "./storage";

// describeStorage() feeds the Backup Vault's "Storage location" and durability
// badge, so it must report what is really configured and never leak secrets.

afterEach(() => vi.unstubAllEnvs());

describe("describeStorage: local driver", () => {
  it("shows the configured LOCAL_STORAGE_ROOT, not a hardcoded path", () => {
    vi.stubEnv("STORAGE_DRIVER", "");
    vi.stubEnv("LOCAL_STORAGE_ROOT", "/data/attachments");
    const d = describeStorage();
    expect(d.driver).toBe("local");
    expect(d.location).toBe("Local disk (/data/attachments)");
    expect(d.location).not.toContain(".storage");
    expect(d.durable).toBe(true);
  });

  it("falls back to the documented default when LOCAL_STORAGE_ROOT is not set", () => {
    vi.stubEnv("STORAGE_DRIVER", "");
    vi.stubEnv("LOCAL_STORAGE_ROOT", "");
    expect(describeStorage().location).toBe("Local disk (.storage/attachments/ in the project directory)");
  });

  it("is not durable on a serverless host (Vercel)", () => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("VERCEL", "1");
    expect(describeStorage().durable).toBe(false);
  });
});

describe("describeStorage: s3 driver", () => {
  it("reports bucket and prefix only, never credentials or the endpoint", () => {
    vi.stubEnv("STORAGE_DRIVER", "s3");
    vi.stubEnv("S3_BUCKET", "ubbuk-prod");
    vi.stubEnv("S3_PREFIX", "attachments/");
    vi.stubEnv("S3_ACCESS_KEY_ID", "fake-access-key-id");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "super-secret-value");
    vi.stubEnv("S3_ENDPOINT", "https://account.r2.cloudflarestorage.com");
    const d = describeStorage();
    expect(d).toEqual({ driver: "s3", location: 'S3-compatible bucket "ubbuk-prod" (prefix "attachments/")', durable: true });
    const text = JSON.stringify(d);
    expect(text).not.toContain("fake-access");
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("cloudflarestorage");
  });

  it("is durable even on Vercel", () => {
    vi.stubEnv("STORAGE_DRIVER", "s3");
    vi.stubEnv("S3_BUCKET", "b");
    vi.stubEnv("VERCEL", "1");
    expect(describeStorage().durable).toBe(true);
  });
});
