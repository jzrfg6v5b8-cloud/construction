import { expect, test } from "vitest";

const modulePath = "../../src/lib/i18n/index.ts";
const { getMessages, resolveLocale } = (await import(modulePath)) as typeof import("../../src/lib/i18n");

test("resolves supported locale variants safely", () => {
  expect(resolveLocale("zh-Hant")).toBe("zh-TW");
  expect(resolveLocale("en-US")).toBe("en");
  expect(resolveLocale("fr")).toBe("zh-CN");
});

test("uses idiomatic locale-specific account copy", () => {
  expect(getMessages("zh-CN").auth.email).toBe("邮箱");
  expect(getMessages("zh-TW").auth.email).toBe("電子郵件");
  expect(getMessages("en").auth.signUp).toBe("Create account");
});
