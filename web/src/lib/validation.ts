import { z } from "zod";

/**
 * Input validation schemas.
 *
 * Every value that arrives from the browser is validated here BEFORE it reaches
 * the database. The same schemas are reused on the client for instant feedback,
 * so the rules can never drift apart.
 */

/** Email: trimmed and lower-cased so casing can never create duplicate accounts. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .max(254, "That email address is too long")
  .toLowerCase();

/**
 * Password rules, kept deliberately simple and explainable:
 * at least 8 characters, containing at least one letter and one number.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be shorter than 128 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

/** Optional nickname used only to greet the user. */
export const displayNameSchema = z
  .string()
  .trim()
  .max(40, "Name must be shorter than 40 characters")
  .optional()
  .or(z.literal(""));

/** Payload accepted by POST /api/auth/signup */
export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  cityCode: z.string().trim().max(40).optional(),
});

/** Payload accepted by POST /api/auth/login */
export const loginSchema = z.object({
  email: emailSchema,
  // No strength rules on login: an old password must still be able to sign in.
  password: z.string().min(1, "Password is required").max(128),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Turns a Zod error into a simple `{ fieldName: message }` object that the
 * forms can render directly under each input.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }

  return errors;
}

/* ==========================================================================
   PHASE 2 — travel profile (onboarding + profile editing)
   ========================================================================== */

/** 24-hour "HH:MM". */
export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please enter a time as HH:MM, e.g. 09:00");

/** An area name. Deliberately an AREA, never a full street address. */
export const areaSchema = z
  .string()
  .trim()
  .min(2, "Please enter at least 2 characters")
  .max(80, "Please keep this under 80 characters");

const transportModeSchema = z.enum([
  "CAR",
  "BIKE",
  "BUS",
  "METRO",
  "WALK",
  "CYCLE",
  "OTHER",
]);

const destinationTypeSchema = z.enum(["WORK", "COLLEGE", "SCHOOL", "OTHER"]);

const dayCodeSchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

/**
 * The complete travel routine.
 *
 * Used by BOTH the onboarding flow and the profile editor, so the two can never
 * drift apart and accept different things.
 */
export const travelProfileSchema = z
  .object({
    // Step 1 — the journey
    homeArea: areaSchema,
    destinationArea: areaSchema,
    destinationType: destinationTypeSchema,
    primaryMode: transportModeSchema,

    // Step 2 — the schedule
    usualDeparture: timeOfDaySchema,
    requiredArrival: timeOfDaySchema,
    typicalJourneyMinutes: z
      .number()
      .int("Please enter a whole number of minutes")
      .min(1, "Journey time must be at least 1 minute")
      .max(300, "Please enter a journey time under 5 hours"),
    travelDays: z
      .array(dayCodeSchema)
      .min(1, "Please choose at least one travel day"),
    isFlexible: z.boolean(),
    flexibilityMinutes: z.number().int().min(0).max(120),

    // Step 3 — preferences
    preferredModes: z.array(transportModeSchema).max(7),
    maxAcceptableDelayMinutes: z.number().int().min(0).max(120),
    willingToLeaveEarlier: z.boolean(),
    willingToLeaveLater: z.boolean(),
    carpoolInterest: z.boolean(),
    publicTransportInterest: z.boolean(),

    // Step 4 — privacy
    shareAggregatedDemand: z.boolean(),
    allowNotifications: z.boolean(),
  })
  .refine(
    (data) => {
      // The required arrival must leave room for the journey itself. Times that
      // cross midnight are allowed, so only same-day ordering is checked.
      const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const departure = toMin(data.usualDeparture);
      const arrival = toMin(data.requiredArrival);
      if (arrival < departure) return true; // crosses midnight — not our problem here
      return arrival - departure >= data.typicalJourneyMinutes;
    },
    {
      message:
        "Your required arrival is earlier than your departure plus your journey time. Please check these three values.",
      path: ["requiredArrival"],
    }
  )
  .refine((data) => !data.isFlexible || data.willingToLeaveEarlier || data.willingToLeaveLater, {
    message:
      "If your departure is flexible, please allow leaving earlier, later, or both.",
    path: ["willingToLeaveEarlier"],
  });

export type TravelProfileInput = z.infer<typeof travelProfileSchema>;

/** Payload for recording what the user decided about a recommendation. */
export const recommendationDecisionSchema = z.object({
  /**
   * Which routine's recommendation this decision is about.
   *
   * Required since Phase 6: a person may have several recommendations on the
   * same day, and "today's recommendation" stopped being a single thing.
   */
  journeyId: z.string().trim().min(1, "Which journey is this for?").max(40),
  decision: z.enum(["ACCEPTED", "KEPT_USUAL", "CUSTOM"]),
  /** Required only when the decision is CUSTOM. */
  chosenDeparture: timeOfDaySchema.optional(),
});

export type RecommendationDecisionInput = z.infer<typeof recommendationDecisionSchema>;

/* ==========================================================================
   PHASE 3 — assistant messages and confirmed travel intentions
   ========================================================================== */

/** One message typed into the CityFlow AI assistant. */
export const chatMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Please type a message")
    .max(400, "Please keep messages under 400 characters"),
});

/**
 * A change the person has explicitly confirmed.
 *
 * At least one of the three must be present — an empty confirmation would write
 * a row that says nothing.
 */
export const intentConfirmSchema = z
  .object({
    /** The assistant message whose card was pressed, so it can be marked done. */
    messageId: z.string().trim().max(40).optional(),
    /**
     * The routine the card was about.
     *
     * Echoed back by the client rather than re-guessed on the server, so the
     * plan is written against the routine the person actually saw named — not
     * whichever one we would assume by the time they pressed Confirm.
     */
    journeyId: z.string().trim().max(40).optional(),
    updatedDeparture: timeOfDaySchema.optional(),
    transportMode: z
      .enum(["CAR", "BIKE", "BUS", "METRO", "WALK", "CYCLE", "OTHER"])
      .optional(),
    cancel: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.updatedDeparture !== undefined ||
      data.transportMode !== undefined ||
      data.cancel === true,
    { message: "There is nothing to confirm." }
  );

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type IntentConfirmInput = z.infer<typeof intentConfirmSchema>;

/* ==========================================================================
   PHASE 4 — Admin Portal: recording a SUMO simulation result
   ========================================================================== */

/**
 * Metrics from one completed SUMO run.
 *
 * These are TYPED IN by the team after a run finishes — CityFlow AI does not
 * run SUMO and does not generate these numbers. The schema exists to stop a
 * typo becoming a result nobody can explain later.
 */
export const simulationRunSchema = z.object({
  cityCode: z.string().trim().min(2).max(40),
  scenario: z.enum(["BASELINE", "CITYFLOW"]),
  networkSource: z
    .string()
    .trim()
    .min(3, "Say where the road network came from, e.g. an OpenStreetMap extract date")
    .max(160),
  vehiclesDeparted: z.number().int().min(0).max(10_000_000),
  meanTravelTimeSeconds: z.number().int().min(0).max(86_400),
  totalDelaySeconds: z.number().int().min(0).max(1_000_000_000),
  peakSlotVehicles: z.number().int().min(0).max(10_000_000),
  meanWaitingSeconds: z.number().int().min(0).max(86_400),
  notes: z.string().trim().max(600).optional().or(z.literal("")),
});

export type SimulationRunInput = z.infer<typeof simulationRunSchema>;

/* ==========================================================================
   PHASE 5 — road-condition reporting
   ========================================================================== */

const roadIssueTypeSchema = z.enum([
  "POTHOLE",
  "BROKEN_SURFACE",
  "WATERLOGGING",
  "UNMARKED_SPEED_BREAKER",
  "DEBRIS_OR_OBSTRUCTION",
  "OPEN_MANHOLE",
  "POOR_STREET_LIGHTING",
  "OTHER",
]);

const roadIssueSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

/** Latitude/longitude sanity. Precise bounds live in lib/roads/cell.ts. */
const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

/**
 * Photo size ceiling.
 *
 * The browser downscales to at most 1000px and re-encodes as JPEG before
 * upload, which normally lands between 40 and 150 KB. 200 KB of image becomes
 * roughly 270 KB as a base64 data URL, so the string limit is set from that.
 *
 * This is a real constraint, not a guess: photos are stored in a Postgres
 * column on a free plan with a 0.5 GB ceiling, so an unbounded upload would
 * eventually take the whole application down. A production deployment would put
 * images in object storage instead — see the comment on the column itself.
 */
export const MAX_PHOTO_DATA_URL_LENGTH = 280_000;

const photoSchema = z
  .string()
  .max(
    MAX_PHOTO_DATA_URL_LENGTH,
    "That photo is too large even after resizing. Please try a different one."
  )
  .regex(
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,
    "That does not look like an image."
  );

/** Payload accepted by POST /api/roads/report — one deliberate citizen report. */
export const roadReportSchema = z.object({
  areaLabel: areaSchema,
  issueType: roadIssueTypeSchema,
  severity: roadIssueSeveritySchema,
  description: z
    .string()
    .trim()
    .max(500, "Please keep the description under 500 characters")
    .optional()
    .or(z.literal("")),
  photo: photoSchema.optional().or(z.literal("")),
  lat: latitudeSchema.optional().nullable(),
  lng: longitudeSchema.optional().nullable(),
});

export type RoadReportInputSchema = z.infer<typeof roadReportSchema>;

/**
 * Payload accepted by POST /api/roads/detections — a batch of sensor jolts.
 *
 * Batched on purpose. A twenty-minute drive can produce a handful of detections
 * and the phone may pass through a tunnel or lose signal, so the browser
 * collects them and sends them at the end of the trip rather than firing a
 * request per bump.
 *
 * A detection with no coordinates is REJECTED here, unlike a citizen report.
 * The reason: a person typing "Salt Lake Sector 5" is telling us something they
 * know. A phone that felt a bump but has no idea where it was is telling us
 * nothing usable, and storing it would inflate the evidence for an area on the
 * basis of no location at all.
 */
export const roadDetectionBatchSchema = z.object({
  detections: z
    .array(
      z.object({
        lat: latitudeSchema,
        lng: longitudeSchema,
        /** Peak vertical acceleration, m/s². */
        magnitude: z.number().min(0).max(200),
        /** Where the phone thinks it was, reverse-geocoded or the home area. */
        areaLabel: areaSchema,
      })
    )
    .min(1, "There are no detections to send")
    // A single trip producing more than this is a sensor fault, not a road.
    .max(30, "Too many detections in one batch"),
});

export type RoadDetectionBatchInput = z.infer<typeof roadDetectionBatchSchema>;

/* ==========================================================================
   PHASE 6 — journeys, one-off trips, saved locations, rewards, municipal work
   ========================================================================== */

/** A routine's display name. Optional — one is generated when it is blank. */
export const journeyLabelSchema = z
  .string()
  .trim()
  .max(48, "Please keep the name under 48 characters")
  .optional()
  .or(z.literal(""));

const latitude = z.number().min(-90).max(90).nullable().optional();
const longitude = z.number().min(-180).max(180).nullable().optional();

/**
 * One recurring journey.
 *
 * Shares every rule with the old single-routine schema, plus the two refinements
 * that matter: an arrival that cannot be met, and a "flexible" routine that
 * allows movement in neither direction. Both were real bugs people hit — the
 * second produces a routine the engine can never act on while the UI insists it
 * is flexible.
 */
export const journeySchema = z
  .object({
    label: journeyLabelSchema,

    originArea: areaSchema,
    originLat: latitude,
    originLng: longitude,

    destinationArea: areaSchema,
    destinationLat: latitude,
    destinationLng: longitude,
    destinationType: z.enum(["WORK", "COLLEGE", "SCHOOL", "OTHER"]),

    usualDeparture: timeOfDaySchema,
    requiredArrival: timeOfDaySchema,
    typicalJourneyMinutes: z
      .number()
      .int("Please enter a whole number of minutes")
      .min(1, "Journey time must be at least 1 minute")
      .max(300, "Please enter a journey time under 5 hours"),
    travelDays: z
      .array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]))
      .min(1, "Please choose at least one travel day"),

    isFlexible: z.boolean(),
    flexibilityMinutes: z.number().int().min(0).max(120),
    willingToLeaveEarlier: z.boolean(),
    willingToLeaveLater: z.boolean(),

    mode: z.enum(["CAR", "BIKE", "BUS", "METRO", "WALK", "CYCLE", "OTHER"]),
  })
  .refine(
    (data) => {
      const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const departure = toMin(data.usualDeparture);
      const arrival = toMin(data.requiredArrival);
      if (arrival < departure) return true; // crosses midnight
      return arrival - departure >= data.typicalJourneyMinutes;
    },
    {
      message:
        "Your required arrival is earlier than your departure plus your journey time. Please check these three values.",
      path: ["requiredArrival"],
    }
  )
  .refine(
    (data) => !data.isFlexible || data.willingToLeaveEarlier || data.willingToLeaveLater,
    {
      message:
        "If this journey is flexible, please allow leaving earlier, later, or both.",
      path: ["willingToLeaveEarlier"],
    }
  );

export type JourneyInputSchema = z.infer<typeof journeySchema>;

/** Payload for POST /api/journeys/reorder */
export const journeyReorderSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1).max(40)).max(16),
});

/** Payload for PATCH /api/journeys/[id] — pause or resume. */
export const journeyActiveSchema = z.object({ isActive: z.boolean() });

/* -------------------------------------------------------------------------- */
/*  Plan a trip                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A one-off trip.
 *
 * The constraint runs the OTHER WAY from a routine: the person gives an arrival
 * deadline and the engine works backwards to a departure. So there is no
 * `usualDeparture` here, and no flexibility window — the window is "any time
 * that gets me there".
 */
export const tripPlanSchema = z.object({
  originArea: areaSchema,
  destinationArea: areaSchema,

  /** YYYY-MM-DD. Validated as a real date, not just a shape. */
  travelDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date")
    .refine((value) => !Number.isNaN(Date.parse(value)), "That date is not valid"),

  requiredArrival: timeOfDaySchema,
  typicalJourneyMinutes: z
    .number()
    .int()
    .min(1, "Journey time must be at least 1 minute")
    .max(300, "Please enter a journey time under 5 hours"),

  mode: z.enum(["CAR", "BIKE", "BUS", "METRO", "WALK", "CYCLE", "OTHER"]),
  tripType: z.enum([
    "MEETING",
    "FLIGHT",
    "TRAIN",
    "MOVIE",
    "APPOINTMENT",
    "EVENT",
    "OTHER",
  ]),
});

export type TripPlanInput = z.infer<typeof tripPlanSchema>;

/* -------------------------------------------------------------------------- */
/*  Saved locations                                                            */
/* -------------------------------------------------------------------------- */

export const savedLocationSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Please give this place a name")
    .max(40, "Please keep the name under 40 characters"),
  kind: z.enum(["HOME", "WORK", "EDUCATION", "GYM", "FAMILY", "OTHER"]),
  area: areaSchema,
  lat: latitude,
  lng: longitude,
});

export type SavedLocationInput = z.infer<typeof savedLocationSchema>;

/* -------------------------------------------------------------------------- */
/*  Profile and settings                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Profile picture ceiling.
 *
 * The browser crops to a square and downscales to 256px before upload, which
 * lands around 15-25 KB as JPEG. 60 KB of image is roughly 80 KB as a base64
 * data URL, which is the limit here. Same honest constraint as road photos: a
 * database column is not an image store.
 */
export const MAX_AVATAR_DATA_URL_LENGTH = 90_000;

export const accountSettingsSchema = z.object({
  displayName: displayNameSchema,

  /** Indian mobile numbers, with or without the +91 country code. */
  phone: z
    .string()
    .trim()
    .regex(/^(\+?91[\s-]?)?[6-9]\d{9}$/, "Please enter a valid 10-digit mobile number")
    .optional()
    .or(z.literal("")),

  profilePictureUrl: z
    .string()
    .max(MAX_AVATAR_DATA_URL_LENGTH, "That picture is too large even after resizing.")
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "That does not look like an image.")
    .optional()
    .or(z.literal("")),

  privacyLevel: z.enum(["ANONYMOUS", "PARTIAL", "FULL"]),
});

export const notificationSettingsSchema = z.object({
  allowNotifications: z.boolean(),
  notifyDailyRecommendation: z.boolean(),
  notifyTrafficAlerts: z.boolean(),
  notifyRoadDetections: z.boolean(),
  notifyRewards: z.boolean(),
  /** 30, 90, 180 or 365 days. */
  locationHistoryRetentionDays: z.number().int().min(30).max(365),
});

export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

/* -------------------------------------------------------------------------- */
/*  Rewards                                                                    */
/* -------------------------------------------------------------------------- */

export const redeemSchema = z.object({
  itemId: z.string().trim().min(1).max(40),
});

/* -------------------------------------------------------------------------- */
/*  Authentication: verification and password reset                            */
/* -------------------------------------------------------------------------- */

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20, "That reset link is not valid").max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "The two passwords do not match",
    path: ["confirmPassword"],
  });

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/* -------------------------------------------------------------------------- */
/*  Municipal Dashboard                                                        */
/* -------------------------------------------------------------------------- */

export const employeeSchema = z.object({
  staffCode: z
    .string()
    .trim()
    .min(2, "Please enter a staff number")
    .max(24, "Please keep the staff number under 24 characters")
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only"),
  name: z
    .string()
    .trim()
    .min(2, "Please enter the employee's name")
    .max(60, "Please keep the name under 60 characters"),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?91[\s-]?)?[6-9]\d{9}$/, "Please enter a valid 10-digit mobile number")
    .optional()
    .or(z.literal("")),
  email: emailSchema.optional().or(z.literal("")),
  assignedArea: z
    .string()
    .trim()
    .max(80, "Please keep the area under 80 characters")
    .optional()
    .or(z.literal("")),
  role: z.enum(["FIELD_WORKER", "INSPECTOR", "SUPERVISOR"]),
  isActive: z.boolean(),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

/**
 * A change to a road issue's municipal status.
 *
 * `note` is required for REJECTED, because "this is not a real defect" is a
 * judgement that someone should have to justify in writing. Everything else is
 * optional.
 */
export const roadIssueStatusSchema = z
  .object({
    status: z.enum([
      "NEW",
      "VERIFIED",
      "ASSIGNED",
      "ACKNOWLEDGED",
      "IN_PROGRESS",
      "COMPLETED",
      "CLOSED",
      "REJECTED",
    ]),
    employeeId: z.string().trim().max(40).optional().or(z.literal("")),
    dueAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date")
      .optional()
      .or(z.literal("")),
    note: z.string().trim().max(600).optional().or(z.literal("")),
  })
  .refine((data) => data.status !== "ASSIGNED" || Boolean(data.employeeId), {
    message: "Choose the employee this work is assigned to.",
    path: ["employeeId"],
  })
  .refine((data) => data.status !== "REJECTED" || Boolean(data.note && data.note.length >= 5), {
    message: "Please say why this is not a real defect. It is kept as a record.",
    path: ["note"],
  });

export type RoadIssueStatusInput = z.infer<typeof roadIssueStatusSchema>;

/* -------------------------------------------------------------------------- */
/*  City configuration                                                         */
/* -------------------------------------------------------------------------- */

export const cityConfigSchema = z.object({
  highPriorityThreshold: z.number().int().min(0).max(100),
  confirmationReportCount: z.number().int().min(1).max(20),
  sensorImpactThreshold: z.number().min(5).max(40),

  pointsForFollowingRecommendation: z.number().int().min(0).max(1000),
  pointsForCarpool: z.number().int().min(0).max(1000),
  pointsForModeSwitch: z.number().int().min(0).max(1000),
  pointsForCorroboratedRoadReport: z.number().int().min(0).max(1000),
  voucherValidityDays: z.number().int().min(7).max(730),

  defaultFlexibilityMinutes: z.number().int().min(0).max(120),
  peakDemandThreshold: z.number().int().min(20).max(100),
});

export type CityConfigInput = z.infer<typeof cityConfigSchema>;
