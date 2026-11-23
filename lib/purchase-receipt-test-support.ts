import { prisma } from "./prisma";
import { completeProcurement as completeRaw } from "./procurement";

// Test helper: completing procurement now needs a receipt for every bought row. Tests that are about something else
// (the workflow order, the hand-over, assignment, search...) complete through this wrapper, which first makes sure the request
// has one whole-purchase receipt. The receipt rules themselves are tested in purchase-receipts.test.ts, which uses the real function.
export async function ensureReceipt(requestId: string, uploaderId: string): Promise<void> {
  if ((await prisma.purchaseReceipt.count({ where: { requestId } })) > 0) return;
  await prisma.purchaseReceipt.create({
    data: { requestId, requestItemId: null, kind: "OTHER", fileName: "test-receipt.jpg", storageKey: `${requestId}/receipts/test-${Date.now()}-${Math.random().toString(36).slice(2)}`, mimeType: "image/jpeg", sizeBytes: 10, uploadedById: uploaderId },
  });
}

export async function completeProcurement(requestId: string, actorId: string) {
  await ensureReceipt(requestId, actorId);
  return completeRaw(requestId, actorId);
}
