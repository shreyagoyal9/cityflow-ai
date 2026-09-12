"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice, TextField } from "@/components/ui/input";

/**
 * Set a new password from a reset link.
 *
 * The token's validity is checked BY THE SERVER BEFORE this form renders, so
 * somebody arriving with a stale link is told immediately rather than after
 * typing a new password twice. This component therefore only handles the
 * submission itself.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "We could not reset your password.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }

      setDone(true);
      // The server cleared any session cookie, so the header needs to catch up.
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Notice tone="success">
          Your password has been changed. Every other reset link for this account has been
          cancelled, and you have been signed out everywhere.
        </Notice>

        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-6 text-base font-medium text-on-primary hover:bg-primary-hover"
        >
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}

      <TextField
        label="New password"
        type={showPassword ? "text" : "password"}
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        required
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            className="text-xs font-medium text-primary"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        }
      />

      <TextField
        label="Confirm new password"
        type={showPassword ? "text" : "password"}
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={fieldErrors.confirmPassword}
        required
      />

      <Button type="submit" size="lg" fullWidth loading={saving}>
        Change my password
      </Button>
    </form>
  );
}
