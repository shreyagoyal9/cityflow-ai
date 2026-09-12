"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ChoiceGroup, Toggle } from "@/components/ui/choice-group";
import { Notice, TextField } from "@/components/ui/input";

/**
 * Account details, privacy level and notification choices.
 *
 * TWO FORMS, NOT ONE.
 * They save to different tables and fail for different reasons. A rejected
 * phone number must not discard somebody's notification choices, which is
 * exactly what a single save-everything form does.
 */

const PRIVACY_LEVELS = [
  {
    value: "ANONYMOUS" as const,
    label: "Anonymous",
    hint: "Nothing leaves your account — not even aggregated counts",
  },
  {
    value: "PARTIAL" as const,
    label: "Balanced",
    hint: "Counted in city demand totals, never identifiable",
  },
  {
    value: "FULL" as const,
    label: "Open",
    hint: "As balanced, plus your CityFlow ID on road reports",
  },
];

const RETENTION_OPTIONS = [
  { value: "30" as const, label: "30 days" },
  { value: "90" as const, label: "90 days" },
  { value: "180" as const, label: "6 months" },
  { value: "365" as const, label: "1 year" },
];

export interface AccountValues {
  displayName: string;
  phone: string;
  privacyLevel: "ANONYMOUS" | "PARTIAL" | "FULL";
}

export interface NotificationValues {
  allowNotifications: boolean;
  notifyDailyRecommendation: boolean;
  notifyTrafficAlerts: boolean;
  notifyRoadDetections: boolean;
  notifyRewards: boolean;
  locationHistoryRetentionDays: number;
}

export function AccountSettings({
  account,
  notifications,
}: {
  account: AccountValues;
  notifications: NotificationValues;
}) {
  return (
    <div className="space-y-6">
      <AccountForm initial={account} />
      <NotificationForm initial={notifications} />
    </div>
  );
}

function AccountForm({ initial }: { initial: AccountValues }) {
  const router = useRouter();

  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});

    try {
      const response = await fetch("/api/settings?section=account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, profilePictureUrl: "" }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not save your details.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Your details" description="Only your name is ever shown to you on screen." />

      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Your details are saved.</Notice>}

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Name"
            hint="Used only to greet you"
            value={values.displayName}
            onChange={(event) =>
              setValues((current) => ({ ...current, displayName: event.target.value }))
            }
            error={fieldErrors.displayName}
          />
          <TextField
            label="Mobile number"
            hint="Optional. Never shown in any city-level view."
            value={values.phone}
            onChange={(event) =>
              setValues((current) => ({ ...current, phone: event.target.value }))
            }
            error={fieldErrors.phone}
          />
        </div>

        <ChoiceGroup
          legend="How much of your data may be used?"
          description="City-level figures are always counts only — never your name, email or route."
          choices={PRIVACY_LEVELS}
          value={values.privacyLevel}
          onChange={(value) =>
            setValues((current) => ({ ...current, privacyLevel: value }))
          }
          columns={3}
        />

        <Button type="submit" loading={saving}>
          Save my details
        </Button>
      </form>
    </Card>
  );
}

function NotificationForm({ initial }: { initial: NotificationValues }) {
  const router = useRouter();

  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof NotificationValues>(key: K, value: NotificationValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/settings?section=notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not save your choices.");
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="Separate switches, because a daily suggestion and a sensor alert are very different things."
      />

      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Your notification choices are saved.</Notice>}

        <Toggle
          label="Send me notifications at all"
          description="Turning this off silences everything below. One switch you can always find."
          checked={values.allowNotifications}
          onChange={(checked) => set("allowNotifications", checked)}
        />

        {/*
          The specific switches are hidden rather than merely disabled when the
          master is off. A greyed-out list of things that will not happen is
          just clutter, and toggling them changes nothing.
        */}
        {values.allowNotifications && (
          <div className="space-y-3 border-l-2 border-border-base pl-4">
            <Toggle
              label="My daily departure recommendation"
              description="One notification each morning for each journey running that day."
              checked={values.notifyDailyRecommendation}
              onChange={(checked) => set("notifyDailyRecommendation", checked)}
            />
            <Toggle
              label="Traffic alerts"
              description="When a disruption or a city-wide re-optimisation changes your recommended time."
              checked={values.notifyTrafficAlerts}
              onChange={(checked) => set("notifyTrafficAlerts", checked)}
            />
            <Toggle
              label="Road issues my phone detects"
              description="Off by default — a notification for every bump in the road would be intolerable."
              checked={values.notifyRoadDetections}
              onChange={(checked) => set("notifyRoadDetections", checked)}
            />
            <Toggle
              label="Reward points"
              description="When points are credited, and when a voucher is about to expire."
              checked={values.notifyRewards}
              onChange={(checked) => set("notifyRewards", checked)}
            />
          </div>
        )}

        <ChoiceGroup
          legend="How long should your own travel history be kept?"
          description="Your personal history only. Aggregated city counts contain nothing personal and are unaffected."
          choices={RETENTION_OPTIONS}
          value={String(values.locationHistoryRetentionDays) as "30" | "90" | "180" | "365"}
          onChange={(value) => set("locationHistoryRetentionDays", Number(value))}
          columns={2}
        />

        <Button type="submit" loading={saving}>
          Save notification choices
        </Button>
      </form>
    </Card>
  );
}
