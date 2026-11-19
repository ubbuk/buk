// Test helper: bytes that carry the right magic number for a MIME type, so fixtures pass the server's signature check.
const SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
  "application/vnd.ms-excel": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [0x50, 0x4b, 0x03, 0x04],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4b, 0x03, 0x04],
};

export function signedBuffer(mimeType: string, size?: number): Buffer {
  const sig = Buffer.from(SIGNATURES[mimeType] ?? []);
  const out = Buffer.alloc(Math.max(size ?? sig.length, sig.length), "x");
  sig.copy(out);
  return size !== undefined && size < sig.length ? out.subarray(0, size) : out;
}
