"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice, TextField } from "@/components/ui/input";

/**
 * Request a password reset link.
 *
 * WHY SUCCESS AND "NO SUCH ACCOUNT" LOOK IDENTICAL
 * They are the same response, on purpose. A form that says "no account found"
 * lets anybody paste in a list of addresses and learn which ones are
 * registered. For a product that knows people's daily travel patterns, that is
 * not a minor leak — it tells somebody which of their targets can be looked up
 * here at all.
 *
 * So the message never confirms or denies. That is mildly less helpful to a
 * person who mistyped their address, and it is the right trade.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Please enter a valid email address.");
        return;
      }

      setMessage(data.message);
      setSent(true);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <Notice tone="success">{message}</Notice>

        <p className="text-sm leading-relaxed text-muted">
          The link works once and expires in one hour. If nothing arrives, the address may
          not have an account — we do not say which way, because that would let anyone
          check whether a given person is registered here.
        </p>

        <Button variant="outline" fullWidth onClick={() => setSent(false)}>
          Use a different address
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}

      <TextField
        label="Email address"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />

      <Button type="submit" size="lg" fullWidth loading={saving}>
        Send me a reset link
      </Button>
    </form>
  );
}
