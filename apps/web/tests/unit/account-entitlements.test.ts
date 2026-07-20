import { expect, test } from "vitest";

const modulePath = "../../src/lib/entitlements/index.ts";
const { canAccess, isWithinLimit } = (await import(modulePath)) as typeof import("../../src/lib/entitlements");

test("applies feature gates by membership plan", () => {
  expect(canAccess("free", "team.invite")).toBe(false);
  expect(canAccess("pro", "team.invite")).toBe(true);
  expect(canAccess("pro", "sso.configure")).toBe(false);
  expect(canAccess("business", "sso.configure")).toBe(true);
});

test("applies finite and unlimited plan limits", () => {
  expect(isWithinLimit("free", "projects", 2)).toBe(true);
  expect(isWithinLimit("free", "projects", 3)).toBe(false);
  expect(isWithinLimit("business", "teamMembers", 10_000)).toBe(true);
});
