// Magic-byte check: the browser's `File.type` is only the OS's guess from the extension, so the server confirms the
// bytes really are what the declared MIME type says. Dependency-free (used by the server routes and the tests).

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** How many leading bytes `signatureMatches` needs. */
export const SIGNATURE_BYTES = 1024;

export function signatureMatches(mime: string, head: Uint8Array): boolean {
  switch (mime) {
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf": {
      // Readers tolerate a little junk before the header; the spec allows it within the first 1024 bytes.
      const text = Buffer.from(head.subarray(0, SIGNATURE_BYTES)).toString("latin1");
      return text.includes("%PDF-");
    }
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(head, ZIP);
    case "application/vnd.ms-excel":
      // A real .xls is an OLE container; some tools save an .xlsx with the .xls extension.
      return startsWith(head, OLE) || startsWith(head, ZIP);
    default:
      return false;
  }
}
