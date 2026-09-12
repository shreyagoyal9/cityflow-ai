import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import type { WeatherToday } from "@/lib/weather";

/**
 * The top of the dashboard: who you are, where you are, what the day looks like.
 *
 * WHY THE NUMBERS HERE ARE THE ONES THEY ARE
 * A hero card is the most-read area of any product, so it is also the easiest
 * place to mislead. Three rules are followed:
 *  - Points are a real ledger balance, not a decorative figure.
 *  - Weather comes from Open-Meteo or is omitted entirely — never guessed.
 *  - Nothing here claims a traffic measurement. The demand tile lives further
 *    down beside its own explanation.
 */

interface DashboardHeroProps {
  greeting: string;
  name: string;
  dateLabel: string;
  cityName: string;
  cityflowId: string;
  weather: WeatherToday | null;
  weatherNote: string | null;
  pointsToday: number;
  pointsBalance: number;
  journeyCount: number;
}

export function DashboardHero(props: DashboardHeroProps) {
  return (
    <div className="rounded-card border border-border-base bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {props.greeting}, {props.name}
          </h1>

          <p className="mt-2 text-sm text-muted">
            {props.dateLabel}
            <Dot />
            {props.cityName}
            <Dot />
            CityFlow ID{" "}
            <span className="font-mono font-medium text-fg">{props.cityflowId}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href="/journeys" variant="outline" size="sm">
            {props.journeyCount === 0 ? "Add a journey" : "My journeys"}
          </ButtonLink>
          <ButtonLink href="/plan" size="sm">
            Plan a trip
          </ButtonLink>
        </div>
      </div>

      {/* ------------------------------------------------------------ tiles */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Tile
          caption="Points today"
          value={props.pointsToday > 0 ? `+${props.pointsToday}` : "0"}
          detail={`${props.pointsBalance} available to spend`}
          href="/rewards"
        />

        {props.weather ? (
          <Tile
            caption="Weather"
            value={`${props.weather.temperatureC}°C`}
            detail={
              props.weather.precipitationMm > 0
                ? `${props.weather.description} · ${props.weather.precipitationMm} mm`
                : props.weather.description
            }
          />
        ) : (
          /*
            An honest empty state. Showing "0°C" or a sun icon when the weather
            service could not be reached would be inventing data, and weather is
            exactly the sort of thing people check against their own window.
          */
          <Tile caption="Weather" value="—" detail="Forecast unavailable right now" />
        )}

        <Tile
          caption="Journeys today"
          value={String(props.journeyCount)}
          detail={props.journeyCount === 1 ? "routine running today" : "routines running today"}
          href="/journeys"
        />
      </div>

      {props.weatherNote && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-accent-soft px-4 py-3">
          <Badge tone="moderate">Weather</Badge>
          <p className="text-sm leading-relaxed text-fg">{props.weatherNote}</p>
        </div>
      )}
    </div>
  );
}

function Tile({
  caption,
  value,
  detail,
  href,
}: {
  caption: string;
  value: string;
  detail: string;
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-subtle">{caption}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </>
  );

  const className =
    "rounded-lg border border-border-base bg-surface-2 px-4 py-3 transition-colors";

  // A tile that goes somewhere is a link, not a div with a click handler, so it
  // is reachable by keyboard and announced correctly by a screen reader.
  return href ? (
    <Link href={href} className={`${className} hover:bg-surface-3`}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function Dot() {
  return (
    <span className="mx-2 text-border-strong" aria-hidden="true">
      ·
    </span>
  );
}
