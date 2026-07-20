import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "sharkflows-auth-"));
process.env.DATABASE_PATH = path.join(dir, "auth.sqlite");

const { closeDb, resetDbForTests } = await import("../../src/lib/db/client");
const { loginWithEmail, registerWithEmail, getUserBySessionToken, destroySession } =
  await import("../../src/lib/auth");

beforeEach(() => {
  closeDb();
  process.env.DATABASE_PATH = path.join(dir, "auth.sqlite");
  resetDbForTests(path.join(dir, "auth.sqlite"));
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("registers and logs in with scrypt password hashing", () => {
  const registered = registerWithEmail({
    email: "dealer@example.com",
    password: "secure-pass-1",
    name: "Dealer",
  });
  expect(registered.user.email).toBe("dealer@example.com");
  expect(registered.user.plan).toBe("free");
  expect(getUserBySessionToken(registered.token)?.id).toBe(registered.user.id);

  destroySession(registered.token);
  expect(getUserBySessionToken(registered.token)).toBeNull();

  const loggedIn = loginWithEmail({
    email: "Dealer@example.com",
    password: "secure-pass-1",
  });
  expect(loggedIn.user.id).toBe(registered.user.id);
  expect(getUserBySessionToken(loggedIn.token)?.email).toBe("dealer@example.com");
});

test("rejects duplicate registration and bad passwords", () => {
  registerWithEmail({ email: "a@example.com", password: "password123" });
  expect(() => registerWithEmail({ email: "a@example.com", password: "password123" })).toThrow(
    /already registered/i,
  );
  expect(() => loginWithEmail({ email: "a@example.com", password: "wrong-password" })).toThrow(
    /invalid email or password/i,
  );
});
