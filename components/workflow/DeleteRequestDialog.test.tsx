import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ push: () => undefined }) }));

import { DeleteRequestDialog } from "./DeleteRequestDialog";

describe("DeleteRequestDialog", () => {
  it("санхүүд бүртгэгдсэн: товч байхгүй, шалтгаан харагдана", () => {
    const html = renderToStaticMarkup(<DeleteRequestDialog requestId="r1" requestNumber="UB-1" financeRecorded />);
    expect(html).toContain("Санхүүд бүртгэгдсэн тул устгах боломжгүй, цуцлана уу");
    expect(html).not.toContain("<button");
  });

  it("бусад: «Устгах» товч", () => {
    const html = renderToStaticMarkup(<DeleteRequestDialog requestId="r1" requestNumber="UB-1" financeRecorded={false} />);
    expect(html).toContain("Устгах");
    expect(html).toContain("<button");
    expect(html).not.toContain("Санхүүд бүртгэгдсэн");
  });
});
