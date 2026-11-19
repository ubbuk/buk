import { describe, expect, it } from "vitest";
import { resolveStorageDriver, StorageConfigError } from "./storage";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("resolveStorageDriver", () => {
  it("never falls back to the local disk by itself in production", () => {
    expect(() => resolveStorageDriver(env({ NODE_ENV: "production" }))).toThrow(StorageConfigError);
    expect(() => resolveStorageDriver(env({ NODE_ENV: "production", STORAGE_DRIVER: "" }))).toThrow(StorageConfigError);
    expect(() => resolveStorageDriver(env({ VERCEL: "1" }))).toThrow(StorageConfigError);
  });

  it("keeps the local disk as the default for dev and tests", () => {
    expect(resolveStorageDriver(env({ NODE_ENV: "development" }))).toBe("local");
    expect(resolveStorageDriver(env({ NODE_ENV: "test" }))).toBe("local");
    expect(resolveStorageDriver(env({}))).toBe("local");
  });

  it("allows an explicit local driver on a self-hosted production server, but never on Vercel", () => {
    expect(resolveStorageDriver(env({ NODE_ENV: "production", STORAGE_DRIVER: "local" }))).toBe("local");
    expect(() => resolveStorageDriver(env({ NODE_ENV: "production", VERCEL: "1", STORAGE_DRIVER: "local" }))).toThrow(StorageConfigError);
  });

  it("selects s3 and refuses an unknown driver", () => {
    expect(resolveStorageDriver(env({ NODE_ENV: "production", VERCEL: "1", STORAGE_DRIVER: "s3" }))).toBe("s3");
    expect(() => resolveStorageDriver(env({ STORAGE_DRIVER: "gcs" }))).toThrow(StorageConfigError);
  });
});
