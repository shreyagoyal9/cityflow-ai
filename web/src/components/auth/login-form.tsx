"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice, TextField } from "@/components/ui/input";
import { fieldErrorsFrom, loginSchema } from "@/lib/validation";

/**
 * Log-in form.
 *
 * @param nextPath Where to send the user after a successful login. Comes from the
 *                 `?next=` query parameter that the middleware adds when it
 *                 intercepts a protected page.
 */
export function LoginForm({ nextPath = "/dashboard" }: { nextPath?: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });

    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Could not sign you in. Please try again.");
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        return;
      }

      // Only allow internal paths, so a crafted `?next=` link cannot send the
      // user to another website after logging in.
      const safeNext = nextPath.startsWith("/") ? nextPath : "/dashboard";

      router.push(safeNext);
      router.refresh();
    } catch {
      setFormError(
        "Could not reach the server. Please check your internet connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <Notice tone="error">{formError}</Notice>}

      <TextField
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
        placeholder="you@example.com"
      />

      <TextField
        label="Password"
        type={showPassword ? "text" : "password"}
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="mr-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        }
      />

      <Button type="submit" fullWidth size="lg" loading={submitting}>
        Log in
      </Button>

      <p className="text-sm text-muted">
        <Link href="/forgot-password" className="font-medium text-primary underline">
          Forgotten your password?
        </Link>
      </p>
    </form>
  );
}
