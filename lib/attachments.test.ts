import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { addAttachments, getAttachmentFile } from "./attachments";
import { MAX_ATTACHMENTS_PER_REQUEST } from "./attachment-rules";

// Real dev Postgres + the real local-fs storage driver (lib/storage.ts),
// same "no mocking" convention as lib/workflow.test.ts. Test files are
// tiny dummy buffers so repeated runs don't meaningfully grow .storage/
// on disk.

const REQUESTER_ID = "vitest-att-requester";
const OTHER_USER_ID = "vitest-att-other";
const DEPT_ID = "vitest-att-dept";

let requestCounter = 0;

beforeAll(async () => {
  await prisma.department.upsert({
    where: { id: DEPT_ID },
    update: {},
    create: { id: DEPT_ID, name: "Vitest attachments тест цех", type: "FACTORY" },
  });
  await prisma.user.upsert({
    where: { id: REQUESTER_ID },
    update: {},
    create: { id: REQUESTER_ID, email: "vitest-att-requester@test.local", name: "Vitest Attachments Requester", role: "EMPLOYEE", departmentId: DEPT_ID, passwordHash: "unused" },
  });
  await prisma.user.upsert({
    where: { id: OTHER_USER_ID },
    update: {},
    create: { id: OTHER_USER_ID, email: "vitest-att-other@test.local", name: "Vitest Attachments Other", role: "EMPLOYEE", departmentId: DEPT_ID, passwordHash: "unused" },
  });
});

async function createTestRequest() {
  requestCounter += 1;
  return prisma.materialRequest.create({
    data: {
      requestNumber: `VITEST-ATT-${Date.now()}-${requestCounter}`,
      year: 9999,
      sequence: requestCounter,
      departmentId: DEPT_ID,
      requestedById: REQUESTER_ID,
      status: "PENDING_DEPARTMENT_APPROVAL",
      submittedAt: new Date(),
    },
  });
}

function makeFile(name: string, mimeType: string, sizeBytes: number) {
  return { fileName: name, mimeType, sizeBytes, buffer: Buffer.alloc(sizeBytes, "x") };
}

describe("addAttachments", () => {
  it("uploads a valid file and stores it so it can be read back byte-for-byte", async () => {
    const request = await createTestRequest();
    const result = await addAttachments(request.id, REQUESTER_ID, [makeFile("зураг.jpg", "image/jpeg", 2048)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].fileName).toBe("зураг.jpg");
    expect(result.data[0].sizeBytes).toBe(2048);

    const file = await getAttachmentFile(request.id, result.data[0].id);
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    expect(file.data.data.byteLength).toBe(2048);
    expect(file.data.mimeType).toBe("image/jpeg");
  });

  it("creates a request with no attachments successfully (attachments stay optional)", async () => {
    const created = await createTestRequest();
    const request = await prisma.materialRequest.findUnique({ where: { id: created.id }, include: { attachments: true } });
    expect(request?.attachments).toEqual([]);
  });

  it("accepts multiple allowed file types in one request (jpg, pdf, xlsx)", async () => {
    const request = await createTestRequest();
    const result = await addAttachments(request.id, REQUESTER_ID, [
      makeFile("a.jpg", "image/jpeg", 100),
      makeFile("b.pdf", "application/pdf", 100),
      makeFile("c.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 100),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(3);
  });

  it("rejects a disallowed file type", async () => {
    const request = await createTestRequest();
    const result = await addAttachments(request.id, REQUESTER_ID, [makeFile("script.exe", "application/x-msdownload", 100)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);

    const row = await prisma.attachment.findFirst({ where: { requestId: request.id } });
    expect(row).toBeNull();
  });

  it("rejects a file over the 10 MB limit", async () => {
    const request = await createTestRequest();
    const result = await addAttachments(request.id, REQUESTER_ID, [makeFile("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects once the request would exceed the per-request attachment cap", async () => {
    const request = await createTestRequest();
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_REQUEST }, (_, i) => makeFile(`f${i}.pdf`, "application/pdf", 10));
    const first = await addAttachments(request.id, REQUESTER_ID, many);
    expect(first.ok).toBe(true);

    const oneMore = await addAttachments(request.id, REQUESTER_ID, [makeFile("one-too-many.pdf", "application/pdf", 10)]);
    expect(oneMore.ok).toBe(false);
    if (!oneMore.ok) expect(oneMore.status).toBe(400);
  });

  it("rejects a user who isn't the request's own requester", async () => {
    const request = await createTestRequest();
    const result = await addAttachments(request.id, OTHER_USER_ID, [makeFile("a.pdf", "application/pdf", 10)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects an upload with no files", async () => {
    const request = await createTestRequest();
    const result = await addAttachments(request.id, REQUESTER_ID, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("getAttachmentFile", () => {
  it("returns not-found for an attachment id that belongs to a different request", async () => {
    const requestA = await createTestRequest();
    const requestB = await createTestRequest();
    const uploaded = await addAttachments(requestA.id, REQUESTER_ID, [makeFile("a.pdf", "application/pdf", 10)]);
    if (!uploaded.ok) throw new Error("setup failed");

    const result = await getAttachmentFile(requestB.id, uploaded.data[0].id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
