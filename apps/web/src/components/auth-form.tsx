"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/runtime";

export function AuthForm({
  googleConfigured,
  initialError,
}: {
  googleConfigured: boolean;
  initialError?: string | null;
}) {
  const { messages } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(mode: "login" | "register") {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "AUTH_FAILED");
        return;
      }
      setOk(mode === "login" ? "signed-in" : "registered");
      window.location.href = "/projects";
    } catch {
      setError("NETWORK_ERROR");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("login");
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm font-medium">
          {messages.auth.email}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3"
          />
        </label>
        <label className="block text-sm font-medium">
          Name
          <input
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3"
          />
        </label>
        <label className="block text-sm font-medium">
          {messages.auth.password}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {messages.auth.signIn}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("register")}
            className="rounded-lg border border-slate-600 px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {messages.auth.signUp}
          </button>
        </div>
      </form>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      {ok && <p className="mt-3 text-sm text-emerald-300">{ok}</p>}

      <div className="mt-6">
        {googleConfigured ? (
          <a
            href="/api/auth/google"
            className="block w-full rounded-xl border border-slate-700 bg-white px-4 py-3 text-center font-semibold text-slate-950 hover:bg-slate-100"
          >
            {messages.auth.google}
          </a>
        ) : (
          <button
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-slate-700 px-4 py-3 font-semibold opacity-40"
          >
            {messages.auth.google}
          </button>
        )}
      </div>
    </section>
  );
}

// Avoid importing server-only crypto helpers into the client bundle.
export function AuthProvidersStatus({
  emailConfigured,
  googleConfigured,
}: {
  emailConfigured: boolean;
  googleConfigured: boolean;
}) {
  const { messages } = useLocale();
  return (
    <aside className="mt-8 rounded-xl border border-slate-800 p-4 text-sm">
      <h2 className="mb-3 font-semibold">{messages.auth.providerStatus}</h2>
      <dl className="space-y-2 text-slate-400">
        <div className="flex justify-between">
          <dt>{messages.auth.emailProvider}</dt>
          <dd>{emailConfigured ? messages.common.configured : messages.common.unavailable}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{messages.auth.googleProvider}</dt>
          <dd>{googleConfigured ? messages.common.configured : messages.common.unavailable}</dd>
        </div>
      </dl>
      {(!emailConfigured || !googleConfigured) && (
        <p className="mt-3 text-amber-300">{messages.auth.unavailableHint}</p>
      )}
    </aside>
  );
}
