import type { Metadata } from "next";

import { CitySwitcher } from "@/components/admin/city-switcher";
import { ConfigForm } from "@/components/admin/config-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { getCity } from "@/lib/cities";
import { getCityConfig } from "@/lib/city-config";
import { emailStatus } from "@/lib/email";
import {
  FORECAST_METHOD_LABEL,
  describeFailure,
  fetchHealth,
  isMlConfigured,
} from "@/lib/ml/client";

export const metadata: Metadata = { title: "Configuration" };

/**
 * Admin Portal — city configuration and service status.
 *
 * Two things on one page because they answer the same question from opposite
 * ends: "what is this deployment actually doing?" The sliders are the policy;
 * the status panel is whether the machinery behind it is running.
 */
export default async function AdminConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const params = await searchParams;
  const city = getCity(params.city);

  const [config, mlHealth] = await Promise.all([
    getCityConfig(city.code),
    fetchHealth(),
  ]);

  const email = emailStatus();

  return (
    <section className="py-8">
      <Container width="wide">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Configuration
            </h1>
            <p className="mt-2 text-sm text-muted">
              Thresholds and reward values for {city.name}. Saved changes take effect
              immediately, with no redeploy.
            </p>
          </div>

          <CitySwitcher active={city.code} basePath="/admin/config" />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ConfigForm
              cityCode={city.code}
              cityName={city.name}
              initial={config}
              isConfigured={config.isConfigured}
            />
          </div>

          {/* ------------------------------------------------ service status */}
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Forecasting service"
                description="Prophet, XGBoost and the OR-Tools optimiser."
              />

              {!isMlConfigured() ? (
                <>
                  <Badge tone="moderate">Not configured</Badge>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    No <code className="text-xs">ML_SERVICE_URL</code> is set, so
                    recommendations come from the built-in TypeScript demand model.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-subtle">
                    That is a working configuration, not a fault — the product is designed
                    to degrade to the simpler model rather than break. What it means is
                    that forecasts are a seasonal prior rather than a fitted model.
                  </p>
                </>
              ) : mlHealth.ok ? (
                <>
                  <Badge tone="low">Reachable</Badge>
                  <dl className="mt-3 space-y-2 text-sm">
                    <Row label="Environment" value={mlHealth.data.environment} />
                    <Row label="Forecast cache" value={mlHealth.data.cache} />
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-subtle">
                    Forecasts are labelled with their method on every response:{" "}
                    {Object.values(FORECAST_METHOD_LABEL).join("; ")}.
                  </p>
                </>
              ) : (
                <>
                  <Badge tone="high">Unreachable</Badge>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {describeFailure(mlHealth.reason)}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-subtle">
                    {mlHealth.detail}
                  </p>
                </>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Email"
                description="Password reset and address confirmation."
              />

              <Badge tone={email.configured ? "low" : "moderate"}>
                {email.configured ? "Configured" : "Not configured"}
              </Badge>
              <p className="mt-3 text-sm leading-relaxed text-muted">{email.detail}</p>
            </Card>

            <Card>
              <CardHeader title="What these settings cannot do" />
              <p className="text-sm leading-relaxed text-muted">
                Nothing here can override what a person consented to. Raising the peak
                threshold makes the optimiser keener to move people, but it still cannot
                propose a departure outside somebody&apos;s own stated flexibility window,
                and it cannot make an inflexible journey flexible.
              </p>
            </Card>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-base pb-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}
