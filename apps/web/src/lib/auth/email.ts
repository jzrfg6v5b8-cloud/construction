import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, type AuthUser } from "@/lib/auth/session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertCredentials(email: string, password: string) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("Invalid email");
  }
  if (!password || password.length < 8) {
    throw new AuthError("Password must be at least 8 characters");
  }
}

function sqlite() {
  return getDb().sqlite;
}

export function registerWithEmail(input: {
  email: string;
  password: string;
  name?: string;
}): { user: AuthUser; token: string; expiresAt: Date } {
  const email = normalizeEmail(input.email);
  assertCredentials(email, input.password);

  const db = sqlite();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) throw new AuthError("Email already registered", 409);

  const id = `usr_${randomBytes(12).toString("hex")}`;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'free', ?, ?)`,
  ).run(id, email, input.name?.trim() || null, hashPassword(input.password), stamp, stamp);

  const session = createSession(id);
  return {
    user: { id, email, name: input.name?.trim() || null, plan: "free" },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export function loginWithEmail(input: {
  email: string;
  password: string;
}): { user: AuthUser; token: string; expiresAt: Date } {
  const email = normalizeEmail(input.email);
  assertCredentials(email, input.password);

  const row = sqlite()
    .prepare(`SELECT id, email, name, plan, password_hash FROM users WHERE email = ?`)
    .get(email) as
    | { id: string; email: string; name: string | null; plan: string; password_hash: string | null }
    | undefined;

  if (!row?.password_hash || !verifyPassword(input.password, row.password_hash)) {
    throw new AuthError("Invalid email or password", 401);
  }

  const session = createSession(row.id);
  return {
    user: { id: row.id, email: row.email, name: row.name, plan: row.plan },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}
