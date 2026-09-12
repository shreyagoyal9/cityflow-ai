import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Notice } from "@/components/ui/input";
import { checkToken, explainTokenFailure } from "@/lib/auth/tokens";

export const metadata: Metadata = {
  title: "Set a new password",
};

/**
 * Set a new password from a reset link.
 *
 * The token is validated HERE, on the server, before the form renders. A person
 * arriving with an expired or already-used link is told straight away rather
 * than after carefully typing a new password twice and pressing save.
 *
 * `checkToken` deliberately does NOT consume the token — only the POST does, so
 * loading this page twice does not invalidate a perfectly good link.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";

  const check = token
    ? await checkToken(token, "PASSWORD_RESET")
    : ({ ok: false, reason: "invalid" } as const);

  if (!check.ok) {
    return (
      <AuthShell
      intent="recovery"
        title="This link cannot be used"
        subtitle="Password reset links are deliberately short-lived and work only once."
        footer={
          <Link href="/login" className="font-medium text-primary underline">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-4">
          <Notice tone="error">
            {explainTokenFailure(check.reason, "PASSWORD_RESET")}
          </Notice>

          <Link
            href="/forgot-password"
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-6 text-base font-medium text-on-primary hover:bg-primary-hover"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose something you have not used on another site. Changing it signs you out everywhere and cancels every other reset link for this account."
      footer={
        <Link href="/login" className="font-medium text-primary underline">
          Back to sign in
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
