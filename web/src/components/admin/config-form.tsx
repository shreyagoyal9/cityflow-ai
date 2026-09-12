"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/input";
import type { CityConfigValues } from "@/lib/city-config";
import { CITY_CONFIG_HELP, DEFAULT_CITY_CONFIG } from "@/lib/city-config";

/**
 * City configuration.
 *
 * WHY EVERY CONTROL CARRIES ITS OWN EXPLANATION
 * These numbers change what the product does to real people: how hard it
 * pushes them to move their morning, what counts as an urgent pothole, what a
 * contribution is worth. A slider with no explanation is a slider somebody
 * moves to a round number because it looked untidy. So each one states what it
 * affects, and the default is shown beside the current value so a change is
 * always visible as a change.
 */

interface ConfigFormProps {
  cityCode: string;
  cityName: string;
  initial: CityConfigValues;
  isConfigured: boolean;
}

export function ConfigForm({ cityCode, cityName, initial, isConfigured }: ConfigFormProps) {
  const router = useRouter();

  const [values, setValues] = useState<CityConfigValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof CityConfigValues>(key: K, value: number) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});

    try {
      const response = await fetch(`/api/admin/config?city=${cityCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not save this configuration.");
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

  function resetToDefaults() {
    setValues({ ...DEFAULT_CITY_CONFIG });
    setSaved(false);
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && (
        <Notice tone="success">
          Saved. Every screen in the product reads these values immediately — no redeploy.
        </Notice>
      )}

      {!isConfigured && (
        <Notice tone="info">
          {cityName} has never been configured, so it is running on the documented
          defaults. Saving here creates its own configuration.
        </Notice>
      )}

      {/* --------------------------------------------------- road issues */}
      <Card>
        <CardHeader
          title="Road issues"
          description="What counts as urgent, and how much citizen evidence is enough."
        />

        <div className="space-y-6">
          <Slider
            name="highPriorityThreshold"
            label="High priority at or above"
            min={0}
            max={100}
            step={1}
            unit="/100"
            value={values.highPriorityThreshold}
            onChange={(value) => set("highPriorityThreshold", value)}
            error={fieldErrors.highPriorityThreshold}
          />
          <Slider
            name="confirmationReportCount"
            label="Reports needed to be 'confirmed by reports'"
            min={1}
            max={20}
            step={1}
            unit=" reports"
            value={values.confirmationReportCount}
            onChange={(value) => set("confirmationReportCount", value)}
            error={fieldErrors.confirmationReportCount}
          />
          <Slider
            name="sensorImpactThreshold"
            label="Phone jolt counts as a possible defect above"
            min={5}
            max={40}
            step={0.5}
            unit=" m/s²"
            value={values.sensorImpactThreshold}
            onChange={(value) => set("sensorImpactThreshold", value)}
            error={fieldErrors.sensorImpactThreshold}
          />
        </div>
      </Card>

      {/* ------------------------------------------------------- rewards */}
      <Card>
        <CardHeader
          title="Reward points"
          description="What each kind of contribution is worth. Shown to citizens on the rewards page."
        />

        <div className="space-y-6">
          <Slider
            name="pointsForFollowingRecommendation"
            label="Following a departure recommendation"
            min={0}
            max={500}
            step={5}
            unit=" points"
            value={values.pointsForFollowingRecommendation}
            onChange={(value) => set("pointsForFollowingRecommendation", value)}
            error={fieldErrors.pointsForFollowingRecommendation}
          />
          <Slider
            name="pointsForCarpool"
            label="Sharing a vehicle"
            min={0}
            max={500}
            step={5}
            unit=" points"
            value={values.pointsForCarpool}
            onChange={(value) => set("pointsForCarpool", value)}
            error={fieldErrors.pointsForCarpool}
          />
          <Slider
            name="pointsForModeSwitch"
            label="Switching to transit, cycling or walking"
            min={0}
            max={500}
            step={5}
            unit=" points"
            value={values.pointsForModeSwitch}
            onChange={(value) => set("pointsForModeSwitch", value)}
            error={fieldErrors.pointsForModeSwitch}
          />
          <Slider
            name="pointsForCorroboratedRoadReport"
            label="A road report others corroborate"
            min={0}
            max={500}
            step={5}
            unit=" points"
            value={values.pointsForCorroboratedRoadReport}
            onChange={(value) => set("pointsForCorroboratedRoadReport", value)}
            error={fieldErrors.pointsForCorroboratedRoadReport}
          />
          <Slider
            name="voucherValidityDays"
            label="Redeemed vouchers stay valid for"
            min={7}
            max={730}
            step={1}
            unit=" days"
            value={values.voucherValidityDays}
            onChange={(value) => set("voucherValidityDays", value)}
            error={fieldErrors.voucherValidityDays}
          />
        </div>
      </Card>

      {/* -------------------------------------------------------- demand */}
      <Card>
        <CardHeader
          title="Demand and flexibility"
          description="How hard the optimiser pushes, and what it asks of people by default."
        />

        <div className="space-y-6">
          <Slider
            name="defaultFlexibilityMinutes"
            label="Flexibility window offered during onboarding"
            min={0}
            max={120}
            step={5}
            unit=" min"
            value={values.defaultFlexibilityMinutes}
            onChange={(value) => set("defaultFlexibilityMinutes", value)}
            error={fieldErrors.defaultFlexibilityMinutes}
          />
          <Slider
            name="peakDemandThreshold"
            label="A slot counts as a peak at or above"
            min={20}
            max={100}
            step={1}
            unit="/100"
            value={values.peakDemandThreshold}
            onChange={(value) => set("peakDemandThreshold", value)}
            error={fieldErrors.peakDemandThreshold}
          />
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" loading={saving}>
          Save configuration for {cityName}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={resetToDefaults}>
          Reset to defaults
        </Button>
      </div>
    </form>
  );
}

/**
 * A labelled range control.
 *
 * A native `<input type="range">` paired with a number input: the range is fast
 * to explore and the number is how somebody enters an exact value. Range inputs
 * alone are almost impossible to set precisely, and number inputs alone give no
 * sense of where a value sits in its span.
 */
function Slider({
  name,
  label,
  min,
  max,
  step,
  unit,
  value,
  onChange,
  error,
}: {
  name: keyof CityConfigValues;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  const defaultValue = DEFAULT_CITY_CONFIG[name];
  const changed = value !== defaultValue;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={name} className="text-sm font-medium text-fg">
          {label}
        </label>
        <span className="text-sm text-muted">
          <span className="font-semibold text-fg">
            {value}
            {unit}
          </span>
          {changed && (
            <span className="ml-2 text-xs text-subtle">
              default {defaultValue}
              {unit}
            </span>
          )}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <input
          id={name}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-2 flex-1 cursor-pointer accent-[var(--cf-primary)]"
          aria-describedby={`${name}-help`}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={`${label}, exact value`}
          className="h-10 w-24 rounded-lg border border-border-base bg-surface px-2 text-right text-sm text-fg"
        />
      </div>

      <p id={`${name}-help`} className="mt-1.5 text-xs leading-relaxed text-subtle">
        {CITY_CONFIG_HELP[name]}
      </p>

      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
