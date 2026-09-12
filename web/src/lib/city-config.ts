import type { CityConfig } from "@prisma/client";

import type { CityCode } from "@/lib/cities";
import { prisma } from "@/lib/db";

/**
 * Per-city tunable thresholds.
 *
 * WHY THESE LIVE IN THE DATABASE
 * Every value here is a judgement call that belongs to a city, not to us. What
 * counts as a high-priority pothole in Bhopal is not what counts in Mumbai, and
 * a points value that motivates people in one city may not in another.
 * Hard-coding them would mean a redeploy every time a council changed its mind
 * about its own policy.
 *
 * WHY `getCityConfig` NEVER RETURNS NULL
 * A city that has never been configured must behave exactly as the product did
 * before this table existed. So the defaults here are not "sensible values" —
 * they are literally the constants that were previously in the code, and the
 * function returns them rather than making forty call sites handle a null.
 */

/**
 * The tunable values, as a type.
 *
 * Declared explicitly rather than inferred from the defaults with `as const`:
 * that would give every field a LITERAL type (`highPriorityThreshold: 75`), so
 * a real configured value of 80 would not be assignable to it. An inferred
 * constant type is right for a lookup table and wrong for a set of defaults.
 */
export interface CityConfigValues {
  highPriorityThreshold: number;
  confirmationReportCount: number;
  sensorImpactThreshold: number;

  pointsForFollowingRecommendation: number;
  pointsForCarpool: number;
  pointsForModeSwitch: number;
  pointsForCorroboratedRoadReport: number;
  voucherValidityDays: number;

  defaultFlexibilityMinutes: number;
  peakDemandThreshold: number;
}

/** The defaults. These match the constants that preceded this table. */
export const DEFAULT_CITY_CONFIG: CityConfigValues = {
  highPriorityThreshold: 75,
  confirmationReportCount: 3,
  sensorImpactThreshold: 14.0,

  pointsForFollowingRecommendation: 50,
  pointsForCarpool: 80,
  pointsForModeSwitch: 100,
  pointsForCorroboratedRoadReport: 30,
  voucherValidityDays: 90,

  defaultFlexibilityMinutes: 15,
  peakDemandThreshold: 62,
};

export interface EffectiveCityConfig extends CityConfigValues {
  cityCode: string;
  /** False when no row exists and the defaults above are in force. */
  isConfigured: boolean;
}

/** Reads a city's configuration, falling back to the defaults. */
export async function getCityConfig(cityCode: CityCode): Promise<EffectiveCityConfig> {
  let stored: CityConfig | null = null;

  try {
    stored = await prisma.cityConfig.findUnique({ where: { cityCode } });
  } catch (error) {
    // Configuration is not worth an outage. If the table cannot be read the
    // product runs on its documented defaults and logs the reason.
    console.error("[city-config] could not read configuration, using defaults:", error);
  }

  if (!stored) return { ...DEFAULT_CITY_CONFIG, cityCode, isConfigured: false };

  return {
    cityCode,
    isConfigured: true,
    highPriorityThreshold: stored.highPriorityThreshold,
    confirmationReportCount: stored.confirmationReportCount,
    sensorImpactThreshold: stored.sensorImpactThreshold,
    pointsForFollowingRecommendation: stored.pointsForFollowingRecommendation,
    pointsForCarpool: stored.pointsForCarpool,
    pointsForModeSwitch: stored.pointsForModeSwitch,
    pointsForCorroboratedRoadReport: stored.pointsForCorroboratedRoadReport,
    voucherValidityDays: stored.voucherValidityDays,
    defaultFlexibilityMinutes: stored.defaultFlexibilityMinutes,
    peakDemandThreshold: stored.peakDemandThreshold,
  };
}

/** Creates or replaces a city's configuration. Admin Portal only. */
export async function saveCityConfig(
  cityCode: CityCode,
  values: CityConfigValues
): Promise<CityConfig> {
  return prisma.cityConfig.upsert({
    where: { cityCode },
    create: { cityCode, ...values },
    update: { ...values },
  });
}

/**
 * Human-readable explanation of each setting, shown beside its control in the
 * Admin Portal.
 *
 * These live next to the defaults on purpose: a threshold whose meaning is
 * documented somewhere else is a threshold that gets changed by someone who
 * does not know what it does.
 */
export const CITY_CONFIG_HELP: Record<keyof CityConfigValues, string> = {
  highPriorityThreshold:
    "Priority score at or above which a road issue is flagged as high priority in the Municipal Dashboard. Lower means more issues flagged.",
  confirmationReportCount:
    "How many independent reports are needed before an issue is described as confirmed by reports. This never means 'verified' — only an inspector can verify a defect.",
  sensorImpactThreshold:
    "Peak vertical acceleration, in m/s², above which a phone jolt is treated as a possible road defect. Lower catches more real potholes and more speed breakers.",

  pointsForFollowingRecommendation:
    "Points credited when someone departs at the time CityFlow AI suggested.",
  pointsForCarpool: "Points credited for sharing a vehicle on a trip.",
  pointsForModeSwitch:
    "Points credited for switching from a private vehicle to public transport, cycling or walking.",
  pointsForCorroboratedRoadReport:
    "Points credited when someone's road report is later corroborated by other independent reports.",
  voucherValidityDays: "How long a redeemed voucher stays valid before it expires.",

  defaultFlexibilityMinutes:
    "The flexibility window offered by default during onboarding. People can always change their own.",
  peakDemandThreshold:
    "Demand index at or above which a slot counts as a peak the optimiser should move people away from.",
};
