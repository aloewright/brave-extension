# copythe-hub — Plan 1: Scaffold + Deploy Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a TanStack Start app on Cloudflare Workers, themed with Mantine using the "Refined Curation System" tokens, gated by Cloudflare Access, deployed live at `hub.copythe.link` with a themed placeholder home page.

**Architecture:** TanStack Start (file-based routes + server functions) built by Vite with the official `@cloudflare/vite-plugin`, deployed via Wrangler to a Cloudflare Worker. Mantine is the component/theming layer (SSR-safe via `ColorSchemeScript` + `MantineProvider`). Cloudflare Access sits in front; the app verifies the Access JWT with a reused-from-agent-app helper, with a local dev bypass.

**Tech Stack:** TanStack Start (React), Vite, `@cloudflare/vite-plugin`, Wrangler, Mantine v7 (`@mantine/core`, `@mantine/hooks`), Nunito Sans (Fontsource), Vitest, `jose` (Access JWT verify).

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-design.md` (Phase 1 of §14).

**Scope note:** This is Plan 1 of the spec's 6 phases. It produces a deployable, authenticated, themed skeleton — no library data, ingestion, or readers yet (those are Plans 2–6). The riskiest unknowns (TanStack-Start-on-Workers, Mantine SSR, Access) are all proven here.

---

## File Structure

New standalone repo at `~/Development/copythe-hub` (GitHub `aloewright/copythe-hub`):

```
copythe-hub/
  package.json
  vite.config.ts            # tanstackStart + cloudflare + react plugins
  wrangler.jsonc            # worker name, compat date/flags, server-entry, vars
  tsconfig.json
  .gitignore
  .dev.vars                 # local secrets (gitignored)
  src/
    router.tsx              # createRouter wiring
    routes/
      __root.tsx            # html document: ColorSchemeScript + MantineProvider + styles
      index.tsx             # themed placeholder home (library shell preview)
    styles/
      theme.ts              # Mantine theme from design tokens (source of truth)
    server/
      access.ts            # Cloudflare Access JWT verification + dev bypass
    lib/
      env.ts               # typed env accessor (CF bindings/vars)
  tests/
    theme.test.ts
    access.test.ts
```

---

### Task 1: Create the repo and base files

**Files:**
- Create: `~/Development/copythe-hub/.gitignore`
- Create: `~/Development/copythe-hub/README.md`

- [ ] **Step 1: Create dir and init git**

Run:
```bash
mkdir -p ~/Development/copythe-hub && cd ~/Development/copythe-hub && git init -b main
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
.output/
.nitro/
.tanstack/
dist/
.wrangler/
.dev.vars
*.local
.DS_Store
```

- [ ] **Step 3: Write `README.md`**

```markdown
# copythe-hub

Read-it-later / save-anything library for `hub.copythe.link`.
TanStack Start on Cloudflare Workers + Mantine, BFF proxy to sidebar-api.

See spec: brave-extension `docs/superpowers/specs/2026-06-07-copythe-hub-design.md`.
```

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add -A && git commit -m "chore: init copythe-hub repo"
```

---

### Task 2: package.json + install deps

**Files:**
- Create: `~/Development/copythe-hub/package.json`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "copythe-hub",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build && tsc --noEmit",
    "preview": "vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Install runtime + build deps**

Run:
```bash
cd ~/Development/copythe-hub && pnpm add @tanstack/react-start @tanstack/react-router react react-dom @mantine/core @mantine/hooks @fontsource-variable/nunito-sans jose
```
Expected: deps resolve and are added to `package.json`.

> If `pnpm add @tanstack/react-start` reports the package layout changed (this stack moves fast), query context7 `/websites/tanstack_start_framework_react` for the current "getting started / project setup" package set and adjust. The Cloudflare hosting shape (Step in Task 4) is the stable contract to preserve.

- [ ] **Step 3: Install dev deps**

Run:
```bash
cd ~/Development/copythe-hub && pnpm add -D vite @vitejs/plugin-react @cloudflare/vite-plugin wrangler typescript vitest @types/react @types/react-dom
```
Expected: dev deps added.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add package.json pnpm-lock.yaml && git commit -m "chore: project deps (tanstack start, mantine, cloudflare, vitest)"
```

---

### Task 3: TypeScript + Vitest config

**Files:**
- Create: `~/Development/copythe-hub/tsconfig.json`
- Create: `~/Development/copythe-hub/vitest.config.ts`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["vite/client"],
    "paths": { "~/*": ["./src/*"] }
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 2: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "~": new URL("./src", import.meta.url).pathname } },
})
```

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add tsconfig.json vitest.config.ts && git commit -m "chore: typescript + vitest config"
```

---

### Task 4: Vite + Wrangler config for Cloudflare

**Files:**
- Create: `~/Development/copythe-hub/vite.config.ts`
- Create: `~/Development/copythe-hub/wrangler.jsonc`

- [ ] **Step 1: Write `vite.config.ts`** (per current TanStack Start Cloudflare hosting docs)

```typescript
import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import viteReact from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
  ],
})
```

- [ ] **Step 2: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "copythe-hub",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "vars": {
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": "",
    "SIDEBAR_API_URL": "https://txt.fly.pm"
  }
}
```
Notes: `SIDEBAR_TOKEN` and any real secret are set via `wrangler secret put` (Task 9), not in `vars`. `ACCESS_*` are filled in Task 9 from the Cloudflare Access app.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add vite.config.ts wrangler.jsonc && git commit -m "chore: vite + wrangler cloudflare config"
```

---

### Task 5: Mantine theme from design tokens (TDD)

**Files:**
- Create: `~/Development/copythe-hub/src/styles/theme.ts`
- Test: `~/Development/copythe-hub/tests/theme.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/theme.test.ts
import { describe, it, expect } from "vitest"
import { theme, BRAND } from "~/styles/theme"

describe("mantine theme (Refined Curation System tokens)", () => {
  it("uses Nunito Sans for body and headings", () => {
    expect(theme.fontFamily).toContain("Nunito Sans")
    expect(theme.headings?.fontFamily).toContain("Nunito Sans")
  })

  it("primaryColor is the indigo brand ramp with 10 shades", () => {
    expect(theme.primaryColor).toBe("brand")
    expect(BRAND).toHaveLength(10)
    // shade 6 is the spec primary #2c50cd
    expect(BRAND[6].toLowerCase()).toBe("#2c50cd")
  })

  it("radius scale matches the design system (default 8px)", () => {
    expect(theme.radius?.default ?? theme.defaultRadius).toBeDefined()
    expect(theme.radius?.md).toBe("0.75rem")
    expect(theme.radius?.lg).toBe("1rem")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/theme.test.ts`
Expected: FAIL — `Cannot find module '~/styles/theme'`.

- [ ] **Step 3: Write `src/styles/theme.ts`**

```typescript
import { createTheme, type MantineColorsTuple } from "@mantine/core"

// Indigo brand ramp seeded from spec primary #2c50cd / soft #5C7CFA.
// Index 6 is the primary; lighter→darker around it.
export const BRAND: MantineColorsTuple = [
  "#eef1fe", "#dde1ff", "#b8c4ff", "#90a4fb", "#6e88f6",
  "#5C7CFA", "#2c50cd", "#2545b4", "#1d3a99", "#142c78",
]

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 6,
  colors: { brand: BRAND },
  fontFamily:
    "'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  headings: {
    fontFamily: "'Nunito Sans', sans-serif",
    fontWeight: "800",
  },
  defaultRadius: "default",
  radius: { sm: "0.25rem", default: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.5rem" },
  shadows: {
    sm: "0 1px 3px rgba(20,24,40,.04)",
    md: "0 4px 20px rgba(20,24,40,.05)",
    lg: "0 12px 34px rgba(20,24,40,.10)",
  },
  other: {
    surface: "#f9f9fd",
    onSurface: "#1a1c1f",
    onSurfaceVariant: "#444654",
    outline: "#c4c5d6",
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/theme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/styles/theme.ts tests/theme.test.ts && git commit -m "feat(theme): Mantine theme from Refined Curation System tokens"
```

---

### Task 6: Cloudflare Access JWT verification (TDD)

**Files:**
- Create: `~/Development/copythe-hub/src/server/access.ts`
- Create: `~/Development/copythe-hub/src/lib/env.ts`
- Test: `~/Development/copythe-hub/tests/access.test.ts`

Reference the agent-app pattern (`feat(agent-app): Cloudflare Access JWT verification helper`) in the brave-extension repo for the verified-working shape; this is a slimmed single-user version.

- [ ] **Step 1: Write `src/lib/env.ts`**

```typescript
export interface HubEnv {
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  SIDEBAR_API_URL: string
  SIDEBAR_TOKEN?: string
  HUB_DEV_BYPASS?: string // "1" in .dev.vars to skip Access locally
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/access.test.ts
import { describe, it, expect } from "vitest"
import { getAccessIdentity } from "~/server/access"

const baseEnv = {
  ACCESS_TEAM_DOMAIN: "aloe.cloudflareaccess.com",
  ACCESS_AUD: "test-aud",
  SIDEBAR_API_URL: "https://txt.fly.pm",
}

describe("getAccessIdentity", () => {
  it("returns a dev identity when HUB_DEV_BYPASS=1 and no token", async () => {
    const id = await getAccessIdentity(new Request("https://hub.copythe.link/"), {
      ...baseEnv,
      HUB_DEV_BYPASS: "1",
    })
    expect(id).toEqual({ email: "dev@local", sub: "dev" })
  })

  it("throws Unauthorized when no Access JWT and no bypass", async () => {
    await expect(
      getAccessIdentity(new Request("https://hub.copythe.link/"), baseEnv),
    ).rejects.toThrow(/unauthorized/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/access.test.ts`
Expected: FAIL — `Cannot find module '~/server/access'`.

- [ ] **Step 4: Write `src/server/access.ts`**

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose"
import type { HubEnv } from "~/lib/env"

export interface Identity {
  email: string
  sub: string
}

export class Unauthorized extends Error {
  constructor(msg = "Unauthorized") {
    super(msg)
    this.name = "Unauthorized"
  }
}

const ACCESS_HEADER = "cf-access-jwt-assertion"
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwks(teamDomain: string) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`
  let set = jwksCache.get(url)
  if (!set) {
    set = createRemoteJWKSet(new URL(url))
    jwksCache.set(url, set)
  }
  return set
}

export async function getAccessIdentity(req: Request, env: HubEnv): Promise<Identity> {
  const token =
    req.headers.get(ACCESS_HEADER) ??
    cookie(req, "CF_Authorization") ??
    ""

  if (!token) {
    if (env.HUB_DEV_BYPASS === "1") return { email: "dev@local", sub: "dev" }
    throw new Unauthorized("No Cloudflare Access token")
  }

  const { payload } = await jwtVerify(token, jwks(env.ACCESS_TEAM_DOMAIN), {
    issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
    audience: env.ACCESS_AUD,
  })
  return {
    email: String(payload.email ?? ""),
    sub: String(payload.sub ?? ""),
  }
}

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie")
  if (!raw) return null
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return v.join("=")
  }
  return null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/access.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/access.ts src/lib/env.ts tests/access.test.ts && git commit -m "feat(auth): Cloudflare Access JWT verification + dev bypass"
```

---

### Task 7: Root document with Mantine SSR + router

**Files:**
- Create: `~/Development/copythe-hub/src/routes/__root.tsx`
- Create: `~/Development/copythe-hub/src/router.tsx`

> Mantine SSR essentials: import `@mantine/core/styles.css`, put `<ColorSchemeScript />` in `<head>`, wrap the app in `<MantineProvider theme={theme}>`, and add Mantine's HTML attributes. If the TanStack Start root API differs from below (it occasionally shifts), query context7 `/websites/tanstack_start_framework_react` for "root route document head scripts" and adapt — keep the three Mantine essentials.

- [ ] **Step 1: Write `src/routes/__root.tsx`**

```tsx
import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router"
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from "@mantine/core"
import "@fontsource-variable/nunito-sans"
import "@mantine/core/styles.css"
import { theme } from "~/styles/theme"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "copythe.link · hub" },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <html {...mantineHtmlProps}>
      <head>
        <HeadContent />
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Outlet />
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Write `src/router.tsx`**

```tsx
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export function createRouter() {
  return createTanStackRouter({ routeTree, scrollRestoration: true })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
```
Note: `routeTree.gen.ts` is auto-generated by the TanStack Start vite plugin on first `dev`/`build`; do not hand-write it.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/__root.tsx src/router.tsx && git commit -m "feat: root document with Mantine SSR provider + router wiring"
```

---

### Task 8: Themed placeholder home route

**Files:**
- Create: `~/Development/copythe-hub/src/routes/index.tsx`

- [ ] **Step 1: Write `src/routes/index.tsx`** (themed shell proving tokens render)

```tsx
import { createFileRoute } from "@tanstack/react-router"
import {
  AppShell, Group, Text, Title, Button, TextInput, Pill, Card, SimpleGrid, Stack,
} from "@mantine/core"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <AppShell header={{ height: 0 }} navbar={{ width: 280, breakpoint: "sm" }} padding="xl">
      <AppShell.Navbar p="md">
        <Group gap="xs" mb="lg">
          <div style={{
            width: 34, height: 34, borderRadius: 10, color: "#fff", fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg,#2c50cd,#5C7CFA)",
          }}>c</div>
          <div>
            <Text fw={800} size="lg">copythe.link</Text>
            <Text size="xs" c="dimmed">your reading hub</Text>
          </div>
        </Group>
        <Button fullWidth>Add New</Button>
        <Stack gap={4} mt="lg">
          {["Home", "Favorites", "Collections", "Archive"].map((n) => (
            <Text key={n} c="dimmed" fw={600} size="sm" px="sm" py={6}>{n}</Text>
          ))}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <TextInput radius="xl" size="md" placeholder="Search your library…" mb="lg" maw={560} />
        <Title order={2} mb={4}>Your Library</Title>
        <Text c="dimmed" mb="md">Skeleton deployed — data wiring lands in Plan 2.</Text>
        <Group gap="xs" mb="lg">
          {["All", "Articles", "Images", "Videos", "PDFs", "Highlights"].map((p, i) => (
            <Pill key={p} size="lg" style={i === 0 ? { background: "#2c50cd", color: "#fff" } : undefined}>{p}</Pill>
          ))}
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {[1, 2, 3].map((i) => (
            <Card key={i} shadow="md" radius="lg" withBorder>
              <Text fw={700} c="brand">Placeholder card {i}</Text>
              <Text size="sm" c="dimmed" mt="xs">Library items render here once the BFF is wired.</Text>
            </Card>
          ))}
        </SimpleGrid>
      </AppShell.Main>
    </AppShell>
  )
}
```

- [ ] **Step 2: Run dev server and verify it renders**

Run: `cd ~/Development/copythe-hub && pnpm dev`
Expected: Vite serves (default `http://localhost:3000`); opening it shows the themed sidebar + "Your Library" shell in Nunito Sans with indigo accents. Stop with Ctrl-C. (This also generates `routeTree.gen.ts`.)

- [ ] **Step 3: Verify production build succeeds**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: `vite build` completes and `tsc --noEmit` reports no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/index.tsx src/routeTree.gen.ts && git commit -m "feat: themed placeholder home (library shell preview)"
```

---

### Task 9: Deploy to Cloudflare + Access + custom domain

These steps touch your Cloudflare account (the dev sandbox can't reach it). Run them on your machine; each must succeed before the next. Where a value comes from the dashboard, the step says so.

**Files:**
- Create: `~/Development/copythe-hub/.dev.vars`
- Modify: `~/Development/copythe-hub/wrangler.jsonc` (fill `ACCESS_*`)

- [ ] **Step 1: Write `.dev.vars` (local only, gitignored)**

```
HUB_DEV_BYPASS=1
SIDEBAR_TOKEN=PUT_THE_SIDEBAR_API_TOKEN_HERE
```
The token mirrors sidebar-api's `SIDEBAR_TOKEN` (the value already configured on the txt.fly.pm worker).

- [ ] **Step 2: Authenticate Wrangler**

Run: `cd ~/Development/copythe-hub && pnpm exec wrangler login` then `pnpm exec wrangler whoami`
Expected: prints your Cloudflare account/email.

- [ ] **Step 3: First deploy (creates the worker on workers.dev)**

Run: `cd ~/Development/copythe-hub && pnpm run deploy`
Expected: build runs, `wrangler deploy` uploads, prints a `copythe-hub.<subdomain>.workers.dev` URL and a Version ID.

- [ ] **Step 4: Set the SIDEBAR_TOKEN secret on the worker**

Run: `cd ~/Development/copythe-hub && pnpm exec wrangler secret put SIDEBAR_TOKEN`
Paste the same token as `.dev.vars`. Expected: `Success! Uploaded secret SIDEBAR_TOKEN`.

- [ ] **Step 5: Add the custom domain `hub.copythe.link`**

In the Cloudflare dashboard → Workers & Pages → `copythe-hub` → Settings → Domains & Routes → Add custom domain → `hub.copythe.link`. (copythe.link is already on this account, so DNS is auto-created.)
Verify: `curl -s -o /dev/null -w "%{http_code}" https://hub.copythe.link` returns `530`/`403`/`200` (resolves; may 403 until Access policy in Step 6/7).

- [ ] **Step 6: Create a Cloudflare Access application over the domain**

Dashboard → Zero Trust → Access → Applications → Add → Self-hosted → name "copythe hub", domain `hub.copythe.link`. Add a policy: Allow, Emails → your email. Save.
From the application's **Overview**, copy the **Application Audience (AUD) tag** and your **team domain** (`<team>.cloudflareaccess.com`).

- [ ] **Step 7: Fill `ACCESS_*` vars and redeploy**

Edit `wrangler.jsonc` `vars`: set `ACCESS_TEAM_DOMAIN` to `<team>.cloudflareaccess.com` and `ACCESS_AUD` to the AUD tag from Step 6. Then:
Run: `cd ~/Development/copythe-hub && pnpm run deploy`
Verify: open `https://hub.copythe.link` in a browser → Cloudflare Access login → after auth, the themed home renders. An unauthenticated `curl https://hub.copythe.link` should be bounced by Access (302 to login).

- [ ] **Step 8: Commit the filled config**

```bash
cd ~/Development/copythe-hub && git add wrangler.jsonc && git commit -m "chore: cloudflare access vars + custom domain config"
```

---

### Task 10: Push repo to GitHub

- [ ] **Step 1: Create the remote and push**

Run:
```bash
cd ~/Development/copythe-hub && gh repo create aloewright/copythe-hub --private --source=. --remote=origin --push
```
Expected: repo created and `main` pushed.

- [ ] **Step 2: Verify CI-free push**

Run: `cd ~/Development/copythe-hub && git status -sb`
Expected: `## main...origin/main` (clean, up to date).

---

## Self-Review

**Spec coverage (Phase 1 of §14):** scaffold TanStack Start on CF ✓ (Tasks 2,4,8,9), Mantine wired with tokens + SSR color-scheme + Nunito Sans ✓ (Tasks 5,7), Access in front ✓ (Tasks 6,9), `hub.copythe.link` live with themed page ✓ (Tasks 8,9). Out of Phase 1 scope (deferred to later plans): BFF/data, ingestion, readers, highlights — correctly absent.

**Placeholder scan:** No "TBD/TODO" left as work items. The two `.dev.vars`/secret values are deliberately user-supplied (real secret, can't be in the plan); marked explicitly. The two "if the API shifted, check context7" notes are guardrails for a fast-moving alpha framework, not missing content — the concrete code is present for the current API.

**Type consistency:** `HubEnv` (env.ts) is consumed by `getAccessIdentity` (access.ts) and matches `wrangler.jsonc` vars + secrets. `theme`/`BRAND` exports match the theme test and `__root.tsx` import. `Identity` shape matches the access test assertions. `createRouter` matches the `Register` module augmentation.

**Risks proven by this plan:** TanStack-Start-build-on-Workers (Task 8 build + Task 9 deploy), Mantine SSR (Task 7 + render check), Access JWT (Task 6 test + Task 9 live). All the unknowns that could invalidate the architecture are exercised here before any feature work.
