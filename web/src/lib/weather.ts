/**
 * Weather, from Open-Meteo.
 *
 * WHY WEATHER IS IN A TRAFFIC PRODUCT
 * Rain is the single most reliable non-calendar predictor of a bad commute. It
 * shifts trips towards private vehicles, slows every mode, and thickens the
 * peak — so a departure recommendation that ignores it is worse on exactly the
 * mornings when people most want advice.
 *
 * WHY OPEN-METEO
 * It is free, needs no API key and no account, and its non-commercial terms suit
 * an academic project. Nothing here is behind a paywall that a marker cannot
 * reach.
 *
 * FAILURE IS EXPECTED AND HARMLESS
 * Every function returns null rather than throwing. Weather makes a
 * recommendation better; its absence must never make one impossible.
 */

import type { City } from "@/lib/cities";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Give up quickly — a recommendation must not wait on a nice-to-have. */
const TIMEOUT_MS = 3000;

export interface WeatherToday {
  temperatureC: number;
  /** Total forecast precipitation for the day, in millimetres. */
  precipitationMm: number;
  /** WMO weather code. See `describeWeather`. */
  weatherCode: number;
  description: string;
  /** True when rain is likely enough to affect the commute. */
  affectsTravel: boolean;
}

/**
 * WMO weather interpretation codes, grouped into what a commuter needs.
 * The full table is 28 entries; these are the groups that change a journey.
 */
function describeWeather(code: number): { description: string; affectsTravel: boolean } {
  if (code === 0) return { description: "Clear", affectsTravel: false };
  if (code <= 3) return { description: "Partly cloudy", affectsTravel: false };
  if (code <= 48) return { description: "Fog", affectsTravel: true };
  if (code <= 57) return { description: "Drizzle", affectsTravel: true };
  if (code <= 67) return { description: "Rain", affectsTravel: true };
  if (code <= 77) return { description: "Snow", affectsTravel: true };
  if (code <= 82) return { description: "Rain showers", affectsTravel: true };
  if (code <= 86) return { description: "Snow showers", affectsTravel: true };
  return { description: "Thunderstorm", affectsTravel: true };
}

/**
 * Today's weather for a city.
 *
 * Cached by Next.js for an hour: a forecast that changes every few minutes is
 * not more accurate, and one request per city per hour keeps a free service
 * free for everyone.
 */
export async function fetchWeather(city: City): Promise<WeatherToday | null> {
  const url =
    `${ENDPOINT}?latitude=${city.center.lat}&longitude=${city.center.lng}` +
    `&current=temperature_2m,weather_code` +
    `&daily=precipitation_sum&timezone=auto&forecast_days=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
      daily?: { precipitation_sum?: number[] };
    };

    const temperature = data.current?.temperature_2m;
    const code = data.current?.weather_code;

    // A response missing the fields we need is a failure, not a zero. Defaulting
    // temperature to 0 °C would put "0°" on an Indian city's dashboard in June.
    if (typeof temperature !== "number" || typeof code !== "number") return null;

    const precipitation = data.daily?.precipitation_sum?.[0] ?? 0;
    const { description, affectsTravel } = describeWeather(code);

    return {
      temperatureC: Math.round(temperature),
      precipitationMm: Math.round(precipitation * 10) / 10,
      weatherCode: code,
      description,
      affectsTravel: affectsTravel || precipitation >= 2.5,
    };
  } catch {
    // Timeout, network failure, or malformed JSON — all the same to the caller.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One sentence for the dashboard, or null when there is nothing worth saying. */
export function weatherTravelNote(weather: WeatherToday | null): string | null {
  if (!weather || !weather.affectsTravel) return null;

  if (weather.precipitationMm >= 7.6) {
    return `Heavy rain is forecast (${weather.precipitationMm} mm). Journeys usually take noticeably longer, and leaving a little earlier is worth considering.`;
  }
  if (weather.precipitationMm >= 2.5) {
    return `Rain is forecast (${weather.precipitationMm} mm). Expect slower traffic than the prediction below assumes.`;
  }
  if (weather.weatherCode >= 45 && weather.weatherCode <= 48) {
    return "Fog is forecast. Visibility may slow traffic, particularly early in the morning.";
  }
  return `${weather.description} is forecast. Traffic may be slower than usual.`;
}
