import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS, type Settings } from "../src/types";
import type { GoVaultBridgeSnapshot } from "../src/lib/go-vault-client";
import type { GoVaultBrowserSessionStatus } from "../src/lib/go-vault-session-state";

const mocks = vi.hoisted(() => ({
  settings: null as Settings | null,
  update: vi.fn(),
  checkGoVaultBridge: vi.fn(),
  readGoVaultBrowserSessionStatus: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    update: mocks.update,
  }),
}));

vi.mock("../src/lib/go-vault-client", () => ({
  checkGoVaultBridge: mocks.checkGoVaultBridge,
}));

vi.mock("../src/lib/go-vault-session-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/go-vault-session-state")>();
  return {
    ...actual,
    readGoVaultBrowserSessionStatus: mocks.readGoVaultBrowserSessionStatus,
  };
});

vi.mock("../src/lib/open-url", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHECKED_AT = "2026-06-15T10:00:00.000Z";
const BASE_URL = "https://go.lazee.workers.dev";

function makeBridge(
  overrides: Partial<GoVaultBridgeSnapshot> = {},
): GoVaultBridgeSnapshot {
  const publicStatus = {
    object: "go-extension-status" as const,
    ok: true,
    checkedAt: CHECKED_AT,
    version: "2026.4.1",
    jwtUnsafeReason: null,
    jwtSecretMinLength: 32,
    registrationInviteRequired: false,
    bridgeVersion: 1 as const,
    storagePolicy: {
      extensionStoresVaultPasswords: false as const,
      decryptedSecretsStoredByExtension: false as const,
      passiveAutofillEnabled: false as const,
    },
    capabilities: {
      vault: true,
      imports: true,
      backups: true,
      devices: true,
      settings: true,
      extensionReadOnlyStatus: true,
    },
    routes: {
      vault: "/vault",
      importExport: "/backup/import-export",
      backups: "/backup",
      devices: "/security/devices",
      settings: "/settings",
      login: "/login",
    },
    apiRoutes: {
      status: "/api/extension/status",
      session: "/api/extension/session",
      backupStatus: "/api/extension/backup/status",
      importStatus: "/api/extension/import/status",
      deviceStatus: "/api/extension/devices/status",
    },
  };

  return {
    checkedAt: CHECKED_AT,
    status: {
      ok: true,
      url: BASE_URL,
      checkedAt: CHECKED_AT,
      version: "2026.4.1",
      jwtUnsafeReason: null,
      registrationInviteRequired: false,
      error: null,
    },
    publicStatus,
    session: {
      object: "go-extension-session",
      state: "not_linked",
      checkedAt: CHECKED_AT,
      user: null,
      capabilities: {
        canOpenVault: false,
        canImport: false,
        canManageBackups: false,
        canManageDevices: false,
      },
    },
    backup: {
      object: "go-extension-backup-status",
      state: "not_linked",
      checkedAt: CHECKED_AT,
      directBackupFromExtension: false,
      route: "/backup",
      destinations: [],
      summary: {
        destinationCount: 0,
        configuredDestinationCount: 0,
        scheduledDestinationCount: 0,
        healthyDestinationCount: 0,
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastErrorAt: null,
      },
    },
    importExport: {
      object: "go-extension-import-status",
      state: "not_linked",
      checkedAt: CHECKED_AT,
      directImportFromExtension: false,
      route: "/backup/import-export",
      supportedSources: [],
    },
    ...overrides,
  };
}

function makeBrowserSession(
  state: GoVaultBrowserSessionStatus["state"],
  checkedAt = new Date().toISOString(),
): GoVaultBrowserSessionStatus {
  return {
    object: "go-vault-browser-session",
    version: 1,
    origin: BASE_URL,
    state,
    email: state === "signed_out" ? null : "aloe@fly.pm",
    role: state === "signed_out" ? null : "admin",
    route: state === "unlocked" ? "/vault" : "/login",
    checkedAt,
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPasswordVaultSection() {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { PasswordVaultSection } = await import("../src/sections/passwords/PasswordVaultSection");
  const host = document.createElement("div");
  host.style.width = "420px";
  host.style.height = "760px";
  document.body.append(host);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(host);
    root.render(<PasswordVaultSection />);
  });
  await flushReact();

  return {
    host,
    cleanup: () => {
      act(() => root?.unmount());
      host.remove();
    },
  };
}

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) => node.getAttribute("aria-label") === label,
  );
  expect(button, `button ${label}`).toBeTruthy();
  return button!;
}

describe("PasswordVaultSection readiness UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      passwordManagerProvider: "nodewarden-self-hosted",
      passwordAppUrl: BASE_URL,
    };
    mocks.update.mockResolvedValue(undefined);
    mocks.openExternalUrl.mockResolvedValue(undefined);
    mocks.readGoVaultBrowserSessionStatus.mockResolvedValue(null);
    mocks.checkGoVaultBridge.mockResolvedValue(makeBridge());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading readiness while go is being checked", async () => {
    mocks.checkGoVaultBridge.mockReturnValue(new Promise(() => {}));

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(host.textContent).toContain("Checking go");
      expect(host.textContent).toContain("Checking");
    } finally {
      cleanup();
    }
  });

  it("labels offline readiness without exposing secret actions", async () => {
    mocks.checkGoVaultBridge.mockResolvedValue(makeBridge({
      publicStatus: null,
      status: {
        ok: false,
        url: BASE_URL,
        checkedAt: CHECKED_AT,
        version: null,
        jwtUnsafeReason: null,
        registrationInviteRequired: false,
        error: "Network error",
      },
    }));

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(host.textContent).toContain("Offline");
      expect(host.textContent).toContain("Open go after service recovers");
      expect(host.textContent).not.toContain("Copy password");
      expect(host.textContent).not.toContain("Run backup");
    } finally {
      cleanup();
    }
  });

  it("routes signed-out users back to go for authentication", async () => {
    mocks.readGoVaultBrowserSessionStatus.mockResolvedValue(makeBrowserSession("signed_out"));

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(host.textContent).toContain("Signed out");
      expect(host.textContent).toContain("Sign in to go");
      expect(host.textContent).toContain("Authentication stays in go");
    } finally {
      cleanup();
    }
  });

  it("routes locked users to go login rather than unlocking in the extension", async () => {
    mocks.readGoVaultBrowserSessionStatus.mockResolvedValue(makeBrowserSession("locked"));

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(host.textContent).toContain("Locked in go");
      expect(host.textContent).toContain("Unlock in go");

      await act(async () => {
        buttonByLabel(host, "Next step").click();
      });
      expect(mocks.openExternalUrl).toHaveBeenCalledWith(`${BASE_URL}/login`);
    } finally {
      cleanup();
    }
  });

  it("opens the vault when a fresh go tab reports unlocked", async () => {
    mocks.readGoVaultBrowserSessionStatus.mockResolvedValue(makeBrowserSession("unlocked"));

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(host.textContent).toContain("Open vault");
      expect(host.textContent).toContain("Live admin go tab");

      await act(async () => {
        buttonByLabel(host, "Next step").click();
      });
      expect(mocks.openExternalUrl).toHaveBeenCalledWith(`${BASE_URL}/vault`);
    } finally {
      cleanup();
    }
  });

  it("keeps expired browser-session pulses visible as stale", async () => {
    const staleCheckedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    mocks.readGoVaultBrowserSessionStatus.mockResolvedValue(
      makeBrowserSession("unlocked", staleCheckedAt),
    );

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(host.textContent).toContain("Stale go tab");
      expect(host.textContent).toContain("Go tab status expired");
      expect(host.textContent).toContain("Open go to refresh status");
    } finally {
      cleanup();
    }
  });

  it("uses a custom passwordAppUrl for checks and route-openers", async () => {
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      passwordManagerProvider: "nodewarden-self-hosted",
      passwordAppUrl: "https://vault.example",
    };

    const { host, cleanup } = await renderPasswordVaultSection();
    try {
      expect(mocks.checkGoVaultBridge).toHaveBeenCalledWith("https://vault.example", null);

      await act(async () => {
        buttonByLabel(host, "Vault").click();
      });
      expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://vault.example/vault");
    } finally {
      cleanup();
    }
  });
});
