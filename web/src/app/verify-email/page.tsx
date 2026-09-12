import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

export const metadata: Metadata = {
  title: "Confirm your email",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      intent="recovery"
      title="Confirm your email address"
      subtitle="This makes sure we can reach you if you ever need to reset your password. CityFlow AI works either way."
      /*
        The panel itself already offers "Go to my dashboard", so the footer
        points somewhere else rather than repeating it. Two identical links a
        few pixels apart is the kind of thing that makes a page feel unfinished.
      */
      footer={
        <>
          Having trouble?{" "}
          <Link href="/settings" className="font-medium text-primary underline">
            Request a new link from your settings
          </Link>
        </>
      }
    >
      <VerifyEmailPanel token={params.token ?? null} />
    </AuthShell>
  );
}
