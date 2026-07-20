import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";

export const SESSION_COOKIE = "sf_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
};

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sqlite() {
  return getDb().sqlite;
}

export function googleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  return getUserBySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const id = `ses_${randomBytes(12).toString("hex")}`;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  sqlite()
    .prepare(
      `INSERT INTO sessions (id, user_id, session_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, hashToken(token), expiresAt.toISOString(), nowIso());
  return { token, expiresAt };
}

export function destroySession(token: string | undefined | null) {
  if (!token) return;
  sqlite().prepare(`DELETE FROM sessions WHERE session_token = ?`).run(hashToken(token));
}

export function getUserBySessionToken(token: string | undefined | null): AuthUser | null {
  if (!token) return null;
  const row = sqlite()
    .prepare(
      `SELECT u.id, u.email, u.name, u.plan, s.expires_at AS expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token = ?`,
    )
    .get(hashToken(token)) as
    | { id: string; email: string; name: string | null; plan: string; expires_at: string }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, plan: row.plan };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}
