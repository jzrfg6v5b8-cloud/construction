import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { createSession, type AuthUser } from "@/lib/auth/session";

export type GoogleProviderStatus = {
  available: boolean;
  reason?: string;
};

export function getGoogleProviderStatus(): GoogleProviderStatus {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return { available: false, reason: "GOOGLE_CLIENT_ID/SECRET not configured" };
  }
  return { available: true };
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || "dev-auth-secret";
}

function signState(nonce: string) {
  const sig = createHmac("sha256", authSecret()).update(nonce).digest("base64url");
  return `${nonce}.${sig}`;
}

export function verifyOAuthState(state: string | null): boolean {
  if (!state) return false;
  const [nonce, sig] = state.split(".");
  if (!nonce || !sig) return false;
  const expected = createHmac("sha256", authSecret()).update(nonce).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildGoogleAuthorizationUrl(origin: string): { url: string; state: string } {
  const status = getGoogleProviderStatus();
  if (!status.available) {
    throw new Error(status.reason ?? "Google OAuth unavailable");
  }

  const state = signState(randomBytes(16).toString("hex"));
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    state,
  };
}

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  name?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sqlite() {
  return getDb().sqlite;
}

export async function completeGoogleOAuth(input: {
  code: string;
  origin: string;
}): Promise<{ user: AuthUser; token: string; expiresAt: Date }> {
  const status = getGoogleProviderStatus();
  if (!status.available) {
    throw new Error(status.reason ?? "Google OAuth unavailable");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${input.origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const tokenJson = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description ?? tokenJson.error ?? "Google token exchange failed");
  }

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    cache: "no-store",
  });
  const profile = (await profileRes.json()) as GoogleUserInfo;
  if (!profileRes.ok || !profile.id || !profile.email) {
    throw new Error("Unable to load Google profile");
  }

  const db = sqlite();
  const linked = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.plan
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.provider = 'google' AND a.provider_account_id = ?`,
    )
    .get(profile.id) as AuthUser | undefined;

  let user = linked;
  if (!user) {
    const byEmail = db
      .prepare(`SELECT id, email, name, plan FROM users WHERE email = ?`)
      .get(profile.email.toLowerCase()) as AuthUser | undefined;

    if (byEmail) {
      user = byEmail;
    } else {
      const id = `usr_${randomBytes(12).toString("hex")}`;
      const stamp = nowIso();
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, plan, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'free', ?, ?)`,
      ).run(id, profile.email.toLowerCase(), profile.name ?? null, stamp, stamp);
      user = { id, email: profile.email.toLowerCase(), name: profile.name ?? null, plan: "free" };
    }

    const existingAccount = db
      .prepare(`SELECT id FROM accounts WHERE provider = 'google' AND provider_account_id = ?`)
      .get(profile.id) as { id: string } | undefined;

    if (existingAccount) {
      db.prepare(`UPDATE accounts SET user_id = ?, access_token = ? WHERE id = ?`).run(
        user.id,
        tokenJson.access_token,
        existingAccount.id,
      );
    } else {
      db.prepare(
        `INSERT INTO accounts (id, user_id, provider, provider_account_id, access_token, refresh_token, created_at)
         VALUES (?, ?, 'google', ?, ?, NULL, ?)`,
      ).run(`acc_${randomBytes(12).toString("hex")}`, user.id, profile.id, tokenJson.access_token, nowIso());
    }
  }

  const session = createSession(user.id);
  return { user, token: session.token, expiresAt: session.expiresAt };
}
