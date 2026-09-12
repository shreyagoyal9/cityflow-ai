import { APP_URL, IS_DEV } from "@/lib/env";

/**
 * Sending email.
 *
 * ======================= AN HONEST LIMITATION ===============================
 * CityFlow AI has NO EMAIL PROVIDER CONFIGURED BY DEFAULT. This is an academic
 * project on free tiers, and every transactional email service requires a
 * verified sending domain.
 *
 * So this module has two modes, and it always says which one it is in:
 *
 *  1. CONFIGURED — RESEND_API_KEY is set. Mail is sent over Resend's HTTP API.
 *     No SDK, no dependency: it is one `fetch` call.
 *
 *  2. NOT CONFIGURED — the message is written to the SERVER LOG instead, with
 *     the link in full. In development that is genuinely useful: you click the
 *     link from your terminal and the flow works end to end.
 *
 * WHAT IS NOT DONE, DELIBERATELY
 * The link is never returned in the HTTP response, not even in development.
 * That would be a complete account-takeover vulnerability — anybody could post
 * a stranger's email address to the reset endpoint and read the reset link out
 * of the response. It is a tempting shortcut for a demo and it is refused here.
 *
 * In production with no provider configured, the API still behaves correctly
 * and tells the person to contact support rather than pretending mail was sent.
 * ============================================================================
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Who the mail comes from. Must be a domain verified with the provider. */
const FROM = process.env.EMAIL_FROM ?? "CityFlow AI <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Deliberately not HTML — see the note in `sendEmail`. */
  text: string;
}

export type SendResult =
  | { ok: true; delivered: true }
  | { ok: true; delivered: false; reason: "not_configured" }
  | { ok: false; error: string };

/**
 * Sends one message.
 *
 * PLAIN TEXT ONLY, ON PURPOSE. A verification link is the single most phished
 * thing in any product. An HTML email with a styled button teaches people that
 * official mail looks like a styled button, which is exactly the habit that
 * makes phishing work. Plain text with a visible URL lets somebody read where
 * the link actually goes before clicking it.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Written to the server log, never to the HTTP response.
    console.info(
      [
        "",
        "──────────────────────────────────────────────────────────────",
        " EMAIL NOT SENT — no RESEND_API_KEY configured.",
        " The message is printed here so the flow can be completed in",
        " development. Set RESEND_API_KEY in .env to send for real.",
        "──────────────────────────────────────────────────────────────",
        ` To:      ${message.to}`,
        ` Subject: ${message.subject}`,
        "",
        message.text,
        "──────────────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );

    return { ok: true, delivered: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[email] provider rejected the message:", response.status, detail);
      return { ok: false, error: `The email provider returned HTTP ${response.status}.` };
    }

    return { ok: true, delivered: true };
  } catch (error) {
    console.error("[email] send failed:", error);
    return { ok: false, error: "Could not reach the email provider." };
  }
}

/* -------------------------------------------------------------------------- */
/*  Message templates                                                          */
/* -------------------------------------------------------------------------- */

export function verificationEmail(to: string, token: string): EmailMessage {
  const link = `${APP_URL}/verify-email?token=${token}`;

  return {
    to,
    subject: "Confirm your email address — CityFlow AI",
    text: [
      "Welcome to CityFlow AI.",
      "",
      "Confirm your email address by opening this link:",
      link,
      "",
      "The link works once and expires in 24 hours.",
      "",
      "You can use CityFlow AI without confirming — this only makes sure we can",
      "reach you if you ever need to reset your password.",
      "",
      "If you did not create an account, you can ignore this message. Nothing",
      "will happen until somebody opens the link above.",
      "",
      "— CityFlow AI (an academic project, not an official government service)",
    ].join("\n"),
  };
}

export function passwordResetEmail(to: string, token: string): EmailMessage {
  const link = `${APP_URL}/reset-password?token=${token}`;

  return {
    to,
    subject: "Reset your password — CityFlow AI",
    text: [
      "Somebody asked to reset the password for this CityFlow AI account.",
      "",
      "If it was you, open this link:",
      link,
      "",
      "The link works once and expires in one hour.",
      "",
      "If it was not you, you can ignore this message. Your password has not",
      "been changed, and nobody can change it without opening the link above.",
      "",
      "— CityFlow AI (an academic project, not an official government service)",
    ].join("\n"),
  };
}

/** Shown to an administrator on the system-status page. */
export function emailStatus(): { configured: boolean; detail: string } {
  if (isEmailConfigured()) {
    return {
      configured: true,
      detail: `Sending through Resend as ${FROM}.`,
    };
  }

  return {
    configured: false,
    detail: IS_DEV
      ? "No provider configured. Verification and reset links are printed to the server terminal, which is fine for development."
      : "No provider configured. Password reset and email verification cannot reach users. Set RESEND_API_KEY to enable them.",
  };
}
