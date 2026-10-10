import * as React from "react";
import { createAuthEmailHandler } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";

// Configuration
const SITE_NAME = "Flas CRM";
const SENDER_DOMAIN = "notify.flas.mobidigisol.com";
const ROOT_DOMAIN = "flas.mobidigisol.com";
const FROM_DOMAIN = "flas.mobidigisol.com";
const SITE_URL = `https://${ROOT_DOMAIN}`;

/**
 * Turns any send outcome into a short, human-readable reason string — or
 * `undefined` when there is nothing to report. Never returns empty strings,
 * "undefined", or an unbounded provider body, so the audit payload stays valid.
 */
async function normalizeProviderError(response: Response): Promise<string | undefined> {
  if (response.ok) return undefined
  let detail = ""
  try {
    const body = await response.clone().text()
    detail = body
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300)
  } catch {
    detail = ""
  }
  const status = Number.isFinite(response.status) ? response.status : 0
  const base = status ? `Email service returned ${status}` : "Email service did not respond"
  return detail ? `${base}: ${detail}` : base
}

// The SDK handler owns verification, dispatch, and retry semantics; this file
// owns only the email decisions: subjects, templates, and per-type props.
export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auditRequest = request.clone()
        const handler = createAuthEmailHandler({
          apiKey: process.env["LOVABLE_API_KEY"]!,
          from: `${SITE_NAME} <flas@mobidigisol.com>`,
          senderDomain: SENDER_DOMAIN,
          sendUrl: process.env["LOVABLE_SEND_URL"],
          emails: {
            signup: {
              subject: "Confirm your email",
              render: (data) =>
                React.createElement(SignupEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  recipient: data.email,
                  confirmationUrl: data.url,
                }),
            },
            invite: {
              subject: "You've been invited",
              render: (data) =>
                React.createElement(InviteEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  confirmationUrl: data.url,
                }),
            },
            magiclink: {
              subject: "Your login link",
              render: (data) =>
                React.createElement(MagicLinkEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl: data.url,
                }),
            },
            recovery: {
              subject: "Reset your password",
              render: (data) =>
                React.createElement(RecoveryEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl: data.url,
                }),
            },
            email_change: {
              subject: "Confirm your new email",
              render: (data) =>
                React.createElement(EmailChangeEmail, {
                  siteName: SITE_NAME,
                  oldEmail: data.old_email ?? "",
                  email: data.email,
                  newEmail: data.new_email ?? "",
                  confirmationUrl: data.url,
                }),
            },
            reauthentication: {
              subject: "Your verification code",
              render: (data) =>
                React.createElement(ReauthenticationEmail, { token: data.token ?? "" }),
            },
          },
        })
        const response = await handler(request)

        try {
          const payload = (await auditRequest.json()) as {
            data?: { action_type?: string; email?: string }
          }
          const actionType = payload.data?.action_type
          const recipientEmail = payload.data?.email
          if ((actionType === "signup" || actionType === "recovery") && recipientEmail) {
            const { recordAuthEmailOutcome } = await import("@/lib/auth-email-audit.server")
            const providerError = await normalizeProviderError(response)
            await recordAuthEmailOutcome({
              recipientEmail,
              actionType,
              accepted: response.ok,
              // Only present when we actually have a reason — an absent key is
              // never written as the string "undefined".
              ...(providerError ? { providerError } : {}),
            })
          }
        } catch (error) {
          console.error("[Auth email audit] Could not inspect verified email event", {
            message: error instanceof Error ? error.message : "Unknown error",
          })
        }

        return response
      },
    },
  },
});
