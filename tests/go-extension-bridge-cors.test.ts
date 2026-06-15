import { describe, expect, it } from "vitest";
import {
  applyCors,
  BRAVE_DEV_EXTENSION_ORIGIN,
  handleCors,
} from "../password-app/src/utils/response";

function requestFor(path: string, origin?: string): Request {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  headers.set("Access-Control-Request-Headers", "authorization, content-type");
  return {
    url: `https://go.lazee.workers.dev${path}`,
    headers,
  } as Request;
}

describe("go extension bridge CORS", () => {
  it("allows the known Brave Dev extension origin on public status without credentials", () => {
    const response = handleCors(
      requestFor("/api/extension/status", BRAVE_DEV_EXTENSION_ORIGIN),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      BRAVE_DEV_EXTENSION_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("does not grant extension bridge CORS to arbitrary extension origins", () => {
    const response = handleCors(
      requestFor(
        "/api/extension/status",
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("keeps same-origin extension bridge requests credential-capable", () => {
    const response = applyCors(
      requestFor("/api/extension/status", "https://go.lazee.workers.dev"),
      new Response("{}", {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://go.lazee.workers.dev",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("leaves existing wildcard public routes available without credentials", () => {
    const response = handleCors(requestFor("/api/version"));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
