import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

function authSecret() {
  return process.env.AUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || "dev-auth-secret";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sqlite() {
  return getDb().sqlite;
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function googleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

type SessionPayload = AuthUser & { exp: number };

function encodeSession(user: AuthUser, expiresAt: Date) {
  const body: SessionPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    exp: expiresAt.getTime(),
  };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const sig = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function decodeSession(token: string): AuthUser | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed?.id || !parsed?.email || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= Date.now()) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name ?? null,
      plan: parsed.plan || "free",
    };
  } catch {
    return null;
  }
}

function persistSessionBestEffort(userId: string, token: string, expiresAt: Date) {
  if (isServerlessRuntime()) return;
  try {
    const id = `ses_${randomBytes(12).toString("hex")}`;
    sqlite()
      .prepare(
        `INSERT INTO sessions (id, user_id, session_token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, userId, hashToken(token), expiresAt.toISOString(), nowIso());
  } catch {
    // Ephemeral FS may reject writes; signed cookie still authenticates.
  }
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  return getUserBySessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** Create a signed session cookie value. Prefer passing the full user (works without durable DB). */
export function createSession(userOrId: AuthUser | string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  let user: AuthUser | null = null;

  if (typeof userOrId === "string") {
    try {
      user = sqlite()
        .prepare(`SELECT id, email, name, plan FROM users WHERE id = ?`)
        .get(userOrId) as AuthUser | undefined ?? null;
    } catch {
      user = null;
    }
    if (!user) {
      // Fallback stub — callers should pass AuthUser on serverless.
      user = { id: userOrId, email: "", name: null, plan: "free" };
    }
  } else {
    user = userOrId;
  }

  const token = encodeSession(user, expiresAt);
  persistSessionBestEffort(user.id, token, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token: string | undefined | null) {
  if (!token) return;
  try {
    sqlite().prepare(`DELETE FROM sessions WHERE session_token = ?`).run(hashToken(token));
  } catch {
    // ignore
  }
}

export function getUserBySessionToken(token: string | undefined | null): AuthUser | null {
  if (!token) return null;

  const signed = decodeSession(token);
  if (signed) {
    // Local/durable installs persist every signed token, so logout can revoke it.
    // Stateless serverless deployments rely on clearing the signed cookie because
    // their bundled SQLite filesystem is read-only and cannot store revocations.
    if (isServerlessRuntime()) return signed;
    try {
      const active = sqlite()
        .prepare(`SELECT 1 FROM sessions WHERE session_token = ? AND expires_at > ?`)
        .get(hashToken(token), nowIso());
      return active ? signed : null;
    } catch {
      return null;
    }
  }

  // Legacy DB-backed tokens (local SQLite installs before signed cookies).
  try {
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
  } catch {
    return null;
  }
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
