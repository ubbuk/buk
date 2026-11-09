import { expect, test, type Page, type Route } from "@playwright/test";

// Mocks NextAuth so we test only the form's behaviour in WebKit: what it sends
// and how it reports each kind of failure.
async function mockAuth(page: Page, onCallback: (body: URLSearchParams, route: Route) => void) {
  await page.route("**/api/auth/csrf", (r) => r.fulfill({ json: { csrfToken: "test-csrf" } }));
  await page.route("**/api/auth/callback/credentials*", async (route) => {
    onCallback(new URLSearchParams(route.request().postData() ?? ""), route);
  });
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: {} }));
}

test("iPhone Safari: email is trimmed/lowercased, password sent untouched", async ({ page }) => {
  let sent: URLSearchParams | null = null;
  await mockAuth(page, (body, route) => {
    sent = body;
    route.fulfill({ json: { url: "http://localhost:3001/dashboard" } });
  });
  await page.goto("/login");
  const email = page.locator('input[name="email"]');
  await expect(email).toHaveAttribute("autocapitalize", "none");
  await expect(email).toHaveAttribute("autocorrect", "off");
  await email.fill("  User@Example.COM ");
  await page.locator('input[name="password"]').fill("Pa55 word!");
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await expect.poll(() => sent?.get("email")).toBe("user@example.com");
  expect(sent!.get("password")).toBe("Pa55 word!");
});

test("CredentialsSignin shows wrong-credentials message", async ({ page }) => {
  await mockAuth(page, (_b, route) => route.fulfill({ json: { url: "http://localhost:3001/login?error=CredentialsSignin" } }));
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("a@b.co");
  await page.locator('input[name="password"]').fill("x");
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await expect(page.getByRole("alert")).toContainText("буруу");
});

test("server/config error is NOT reported as wrong password", async ({ page }) => {
  await mockAuth(page, (_b, route) => route.fulfill({ json: { url: "http://localhost:3001/login?error=Configuration" } }));
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("a@b.co");
  await page.locator('input[name="password"]').fill("x");
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await expect(page.getByRole("alert")).toContainText("системийн алдаа");
});
