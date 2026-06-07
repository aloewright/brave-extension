import { describe, expect, it } from "vitest"
import {
  buildMailTwoFactorListUrl,
  buildMailTwoFactorThreadUrl,
  extractMailTwoFactorCodesFromText,
  findBestMailTwoFactorCode
} from "../src/lib/mail-2fa"

describe("mail.fly.pm two-factor code extraction", () => {
  it("builds the signed-in Fly Mail inbox URLs used by the background bridge", () => {
    expect(buildMailTwoFactorListUrl()).toBe(
      "https://mail.fly.pm/api/v1/threads?folder=inbox&limit=10"
    )
    expect(buildMailTwoFactorThreadUrl("thread 1")).toBe(
      "https://mail.fly.pm/api/v1/threads/thread%201"
    )
  })

  it("extracts likely verification codes without treating unrelated numbers as codes", () => {
    expect(
      extractMailTwoFactorCodesFromText(
        "Your verification code is 123-456. This link expires in 10 minutes."
      )
    ).toEqual(["123456"])
    expect(extractMailTwoFactorCodesFromText("Invoice 2026 is due for $1488.")).toEqual([])
  })

  it("prefers recent codes whose email content matches the target website", () => {
    const now = Date.parse("2026-05-28T12:00:00Z")
    const best = findBestMailTwoFactorCode({
      pageUrl: "https://github.com/login/oauth",
      now,
      summaries: [
        {
          id: "old",
          subject: "Unrelated login code",
          lastMessageAt: "2026-05-28T11:59:30Z"
        },
        {
          id: "github",
          subject: "GitHub verification code",
          lastMessageAt: "2026-05-28T11:58:30Z"
        }
      ],
      details: [
        {
          thread: { id: "old", subject: "Unrelated login code" },
          messages: [
            {
              id: "m1",
              textBody: "Your verification code is 111111.",
              sentAt: "2026-05-28T11:59:30Z"
            }
          ]
        },
        {
          thread: { id: "github", subject: "GitHub verification code" },
          messages: [
            {
              id: "m2",
              fromName: "GitHub",
              textBody: "Use 222222 as your GitHub two-factor authentication code.",
              sentAt: "2026-05-28T11:58:30Z"
            }
          ]
        }
      ]
    })

    expect(best?.code).toBe("222222")
  })

  it("does not return a code when multiple recent messages are ambiguous", () => {
    const now = Date.parse("2026-05-28T12:00:00Z")
    const best = findBestMailTwoFactorCode({
      pageUrl: "https://example.com/login",
      now,
      details: [
        {
          thread: { id: "a", subject: "Verification code" },
          messages: [{ textBody: "Your verification code is 111111.", sentAt: now - 1_000 }]
        },
        {
          thread: { id: "b", subject: "Security code" },
          messages: [{ textBody: "Your security code is 222222.", sentAt: now - 2_000 }]
        }
      ]
    })

    expect(best).toBeNull()
  })
})
