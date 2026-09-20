"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setAuthenticatedIdentity } from "@/shared/lib/session-state";
import "@/shared/lib/identity";

export function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Не удалось создать аккаунт");
      }
      setAuthenticatedIdentity(null);
      router.replace("/workspace");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать аккаунт");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-white">Create account</h1>
        <p className="text-sm text-[#94a6ae]">Fill in the details to get started</p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase text-[#94a6ae]">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="John Doe"
            required
            className="h-10 px-3 rounded-md border border-white/10 bg-white/5 text-white placeholder:text-white/30 outline-none focus:border-[#54d7ff]/60"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase text-[#94a6ae]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            className="h-10 px-3 rounded-md border border-white/10 bg-white/5 text-white placeholder:text-white/30 outline-none focus:border-[#54d7ff]/60"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase text-[#94a6ae]">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            required
            className="h-10 px-3 rounded-md border border-white/10 bg-white/5 text-white placeholder:text-white/30 outline-none focus:border-[#54d7ff]/60"
          />
        </label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="h-10 rounded-md bg-[#54d7ff] text-[#070d11] font-bold hover:bg-[#7ae3ff] transition-colors"
        >
          {submitting ? "Creating..." : "Create account"}
        </button>
      </form>

      <p className="text-sm text-center text-[#94a6ae]">
        Already have an account?{" "}
        <Link href="/login" className="text-[#54d7ff] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
