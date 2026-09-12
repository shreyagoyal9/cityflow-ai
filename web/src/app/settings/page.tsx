import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ResendVerificationButton } from "@/components/auth/verify-email-panel";
import { AccountSettings } from "@/components/settings/account-settings";
import { SavedPlaces } from "@/components/settings/saved-places";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Notice } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings — the account, not the routine.
 *
 * Deliberately separate from `/profile`, which owns the travel preferences, and
 * from `/journeys`, which owns the routines themselves. Three pages rather than
 * one long form, because "change my notification settings" and "change when I
 * leave for work" are errands of completely different sizes.
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  const [full, profile, places] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        displayName: true,
        email: true,
        phone: true,
        privacyLevel: true,
        emailVerifiedAt: true,
      },
    }),
    prisma.travelProfile.findUnique({ where: { userId: user.id } }),
    prisma.savedLocation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, kind: true, area: true },
    }),
  ]);

  if (!full) redirect("/login");

  return (
    <section className="py-8 sm:py-12">
      <Container>
        <SectionHeading
          eyebrow="Your account"
          title="Settings"
          description="Your details, what you hear about, and the places you travel between."
        />

        {/* --------------------------------------------- email confirmation */}
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Email address"
              description={full.email}
              action={
                full.emailVerifiedAt ? (
                  <Badge tone="low">Confirmed</Badge>
                ) : (
                  <Badge tone="moderate">Not confirmed</Badge>
                )
              }
            />

            {full.emailVerifiedAt ? (
              <p className="text-sm leading-relaxed text-muted">
                Confirmed on{" "}
                {full.emailVerifiedAt.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                . This is what makes password reset trustworthy — we know the address
                reaches you.
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-muted">
                  CityFlow AI works either way — confirming is not a gate on anything.
                  What it does is make password reset trustworthy: without it, we cannot be
                  sure a reset link would reach you rather than somebody else.
                </p>
                <ResendVerificationButton />
              </div>
            )}
          </Card>
        </div>

        {/* ----------------------------------------- details + notifications */}
        {profile ? (
          <div className="mt-6">
            <AccountSettings
              account={{
                displayName: full.displayName ?? "",
                phone: full.phone ?? "",
                privacyLevel: full.privacyLevel,
              }}
              notifications={{
                allowNotifications: profile.allowNotifications,
                notifyDailyRecommendation: profile.notifyDailyRecommendation,
                notifyTrafficAlerts: profile.notifyTrafficAlerts,
                notifyRoadDetections: profile.notifyRoadDetections,
                notifyRewards: profile.notifyRewards,
                locationHistoryRetentionDays: profile.locationHistoryRetentionDays,
              }}
            />
          </div>
        ) : (
          <div className="mt-6">
            <Notice tone="info">
              Finish setting up your travel routine and your notification settings will
              appear here.{" "}
              <Link href="/onboarding" className="font-medium underline">
                Set up my routine
              </Link>
            </Notice>
          </div>
        )}

        {/* ---------------------------------------------------- saved places */}
        <div className="mt-6">
          <SavedPlaces places={places} />
        </div>

        {/* ---------------------------------------------------- honest note */}
        <div className="mt-8 rounded-card border border-border-base bg-surface-2 p-5">
          <Badge tone="neutral">About notifications</Badge>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            These preferences are stored and respected by the code that decides what to
            send. CityFlow AI does not currently have push notifications or a scheduled
            email digest, so in practice the only thing that reaches you today is what you
            see on screen when you open the app. The settings are real; the delivery
            channels are the part still to be built, and saying so is better than a switch
            that quietly does nothing.
          </p>
        </div>
      </Container>
    </section>
  );
}
