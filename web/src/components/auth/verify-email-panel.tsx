"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/input";

/**
 * Confirms an email address from the link in a verification email.
 *
 * WHY THE CONFIRMATION IS A POST FROM THE BROWSER AND NOT THE PAGE LOAD ITSELF
 * Mail clients, security scanners and link previewers routinely fetch every URL
 * in a message before a human sees it. If simply loading this page consumed the
 * token, the link would frequently be spent before the person ever clicked it,
 * and they would arrive to be told it had already been used.
 *
 * Requiring a POST from real page JavaScript means a prefetch cannot burn the
 * token. It runs automatically on mount, so the person still experiences one
 * click.
 */
export function VerifyEmailPanel({ token }: { token: string | null }) {
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");

  // Guards against React's development double-mount consuming the token twice
  // and reporting "already used" on a perfectly good link.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token) {
      setState("failed");
      setMessage(
        "This link is missing its confirmation code. It may have been cut short — check that the whole link came across from your email."
      );
      return;
    }

    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
          setState("failed");
          setMessage(data.error ?? "We could not confirm your email address.");
          return;
        }

        setState("done");
        setMessage(data.message);
      } catch {
        setState("failed");
        setMessage("Could not reach the server. Please try opening the link again.");
      }
    })();
  }, [token]);

  if (state === "working") {
    return (
      <div className="flex items-center gap-3">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-primary"
          aria-hidden="true"
        />
        <p className="text-sm text-muted" role="status">
          Confirming your email address…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Notice tone={state === "done" ? "success" : "error"}>{message}</Notice>

      {state === "failed" && (
        <p className="text-sm leading-relaxed text-muted">
          Confirmation links expire after 24 hours and work only once. You can request a
          new one from your profile — and CityFlow AI works either way; confirming only
          makes sure we can reach you if you ever need to reset your password.
        </p>
      )}

      {/*
        NOTE ON `sm:flex-1` RATHER THAN `flex-1`.

        This container is `flex-col` on a phone and `flex-row` above it. In a
        COLUMN container, `flex-1` expands to `flex: 1 1 0%` — and a flex-basis
        of 0 in the column direction overrides the element's own `h-11`. The
        buttons silently collapsed to 20px tall on mobile: still clickable,
        visibly wrong, and invisible on a desktop screen.

        Scoping it to `sm:` means the height applies in the column layout and
        the two buttons share the width only once they are side by side.
      */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover sm:flex-1"
        >
          Go to my dashboard
        </Link>
        {state === "failed" && (
          <Link
            href="/settings"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-border-strong bg-surface px-5 text-sm font-medium text-fg hover:bg-surface-2 sm:flex-1"
          >
            Request a new link
          </Link>
        )}
      </div>
    </div>
  );
}

/** Resend button, used on the profile page. */
export function ResendVerificationButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function resend() {
    setSending(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/verify-email?resend=1", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "We could not send that link.");
        return;
      }

      setMessage(data.message);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Button variant="outline" onClick={resend} loading={sending}>
        Send a confirmation link
      </Button>
    </div>
  );
}
