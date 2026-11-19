// What went wrong with the object store, in a form that is safe to log (a code, never a value) and a sentence the user
// can act on. The SDK's own messages can contain the region, endpoint or key, so they are never logged or shown.
export type StorageFailureCode = "STORAGE_CONFIG" | "STORAGE_AUTH" | "STORAGE_BUCKET" | "STORAGE_UNREACHABLE" | "STORAGE_UNKNOWN";

export interface StorageFailure {
  code: StorageFailureCode;
  message: string;
  /** 503 only when trying again can help (the store could not be reached); a wrong setting or key is a 500 the client must not retry. */
  status: 503 | 500;
}

const CONFIG = "Файл хадгалах сангийн тохиргоо буруу байна. Системийн админд мэдэгдэнэ үү";
const MESSAGES: Record<StorageFailureCode, string> = {
  STORAGE_CONFIG: CONFIG,
  STORAGE_AUTH: "Файл хадгалах сангийн эрх буруу байна. Системийн админд мэдэгдэнэ үү",
  STORAGE_BUCKET: "Файл хадгалах сан (bucket) олдсонгүй. Системийн админд мэдэгдэнэ үү",
  STORAGE_UNREACHABLE: "Файл хадгалах сантай холбогдож чадсангүй. Дахин оролдоно уу",
  STORAGE_UNKNOWN: "Файл хадгалах сан түр алдаа өглөө. Дахин оролдоно уу",
};

export function classifyStorageError(err: unknown): StorageFailure & { name: string } {
  const e = err as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } } | null;
  const name = typeof e?.name === "string" ? e.name : "unknown";
  const awsCode = e?.Code ?? name;
  const status = e?.$metadata?.httpStatusCode;
  const message = typeof e?.message === "string" ? e.message : "";
  let code: StorageFailureCode = "STORAGE_UNKNOWN";
  if (/^StorageConfigError$/.test(name) || /Region not accepted|not a valid hostname|Invalid URL|needs S3_|Invalid (region|endpoint)/i.test(message)) code = "STORAGE_CONFIG";
  else if (["InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied", "ExpiredToken", "InvalidToken"].includes(awsCode) || status === 401 || status === 403) code = "STORAGE_AUTH";
  else if (awsCode === "NoSuchBucket") code = "STORAGE_BUCKET";
  else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|TimeoutError/i.test(`${e?.code ?? ""} ${name} ${message}`)) code = "STORAGE_UNREACHABLE";
  return { code, message: MESSAGES[code], status: code === "STORAGE_UNREACHABLE" ? 503 : 500, name };
}

/** Thrown by the upload helpers; the routes turn it into a 503 with `message`. */
export class UploadStorageError extends Error {
  constructor(readonly failure: StorageFailure) {
    super(failure.message);
  }
}

/** Logs the code and the error class (nothing else) and returns the failure to show. `phase` is "presign" | "finalize". */
export function reportStorageFailure(phase: string, err: unknown): StorageFailure {
  const { code, message, status, name } = classifyStorageError(err);
  console.error(JSON.stringify({ route: "attachments", phase, storageFailure: code, errorName: name }));
  return { code, message, status };
}
