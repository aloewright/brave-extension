#!/usr/bin/env node
/**
 * App Store Connect certificate helper.
 *
 * Subcommands:
 *   list                                   List all certificates on the team.
 *   list-type <TYPE>                       List only one certificateType.
 *   create-developer-id [--name <name>]    Generate a CSR locally, create a
 *                                          DEVELOPER_ID_APPLICATION cert via
 *                                          ASC, write the resulting cert +
 *                                          private key to the user's keychain
 *                                          and to ~/.private_keys/ai-dev-sidebar/.
 *
 * Environment (typically injected by `doppler run --`):
 *   ASC_KEY_ID                Key ID of the ASC API key (e.g. N6H2G878Q6).
 *   ASC_ISSUER_ID             Team-level issuer ID (UUID).
 *   ASC_KEY_P8                Full text of the .p8 file (newlines OK).
 *   ASC_KEY_P8_PATH           Or, path to an existing .p8 file. One of
 *                             ASC_KEY_P8 or ASC_KEY_P8_PATH must be set.
 *
 * Notes:
 *  - The ASC API key must belong to a user with at least the Admin or
 *    Account Holder role to create Developer ID certs.
 *  - Apple caps Developer ID Application certs per team at 5; if you're at
 *    the cap, revoke an unused one with `revoke <certId>` first.
 */
import { createSign, createPrivateKey, generateKeyPairSync } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const KEY_ID = process.env.ASC_KEY_ID
const ISSUER_ID = process.env.ASC_ISSUER_ID
let KEY_P8 = process.env.ASC_KEY_P8

if (!KEY_P8 && process.env.ASC_KEY_P8_PATH && existsSync(process.env.ASC_KEY_P8_PATH)) {
  KEY_P8 = readFileSync(process.env.ASC_KEY_P8_PATH, "utf-8")
}
if (!KEY_P8 && KEY_ID) {
  const candidate = join(homedir(), ".private_keys", `AuthKey_${KEY_ID}.p8`)
  if (existsSync(candidate)) KEY_P8 = readFileSync(candidate, "utf-8")
}

if (!KEY_ID || !ISSUER_ID || !KEY_P8) {
  console.error("Missing ASC creds. Need ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_P8 (or ASC_KEY_P8_PATH).")
  process.exit(2)
}

// .p8 strings stored in env vars often have literal "\n" sequences; normalise.
KEY_P8 = KEY_P8.replace(/\\n/g, "\n")

function token() {
  // ASC requires ES256 JWT with header { alg, kid, typ } and claims
  // { iss, exp, aud }. Max lifetime 20 minutes.
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
  ).toString("base64url")
  const claims = Buffer.from(
    JSON.stringify({
      iss: ISSUER_ID,
      exp: Math.floor(Date.now() / 1000) + 19 * 60,
      aud: "appstoreconnect-v1"
    })
  ).toString("base64url")
  const signingInput = `${header}.${claims}`
  const key = createPrivateKey({ key: KEY_P8, format: "pem" })
  const signer = createSign("SHA256")
  signer.update(signingInput)
  signer.end()
  // ASC expects the JOSE-style raw R||S signature, not DER. Node's
  // createSign on EC keys returns DER by default; pass dsaEncoding:'ieee-p1363'
  // so we get the 64-byte concatenated form JWT requires.
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url")
  return `${signingInput}.${sig}`
}

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed }
}

async function cmdList(filterType) {
  const res = await api("GET", "/v1/certificates?limit=200")
  if (res.status !== 200) {
    console.error(`HTTP ${res.status}:`, res.body)
    process.exit(1)
  }
  for (const c of res.body.data || []) {
    const a = c.attributes || {}
    if (filterType && a.certificateType !== filterType) continue
    console.log(`${c.id}  ${a.certificateType.padEnd(28)}  ${a.name}  expires=${a.expirationDate}`)
  }
}

async function cmdRevoke(id) {
  if (!id) {
    console.error("usage: asc-cert revoke <certId>")
    process.exit(2)
  }
  const res = await api("DELETE", `/v1/certificates/${id}`)
  console.log(`HTTP ${res.status}`, res.body || "")
}

function generateKeyAndCSR(commonName) {
  // Generate an EC P-256 key + a PKCS#10 CSR using `openssl` since Node
  // doesn't have a CSR builder in stdlib. The CSR is what Apple signs.
  const dir = join(tmpdir(), `asc-cert-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const keyPath = join(dir, "key.pem")
  const csrPath = join(dir, "csr.pem")
  // Apple accepts both RSA-2048 and EC P-256 CSRs. We use RSA-2048 because
  // older keychain versions handle it more reliably for codesigning.
  const gen = spawnSync(
    "openssl",
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      csrPath,
      "-subj",
      `/CN=${commonName}/O=${commonName}/C=US`
    ],
    { stdio: "inherit" }
  )
  if (gen.status !== 0) throw new Error(`openssl req failed (status ${gen.status})`)
  chmodSync(keyPath, 0o600)
  return { dir, keyPath, csrPath }
}

async function cmdCreateDeveloperId(name) {
  const cn = name || `ai-dev-sidebar (${new Date().toISOString().slice(0, 10)})`
  console.log(`Generating CSR for "${cn}"…`)
  const { dir, keyPath, csrPath } = generateKeyAndCSR(cn)

  const csrPem = readFileSync(csrPath, "utf-8")
  const csrContent = csrPem
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/g, "")
    .replace(/-----END CERTIFICATE REQUEST-----/g, "")
    .replace(/\s+/g, "")

  console.log("POST /v1/certificates (DEVELOPER_ID_APPLICATION)…")
  const res = await api("POST", "/v1/certificates", {
    data: {
      type: "certificates",
      attributes: {
        certificateType: "DEVELOPER_ID_APPLICATION",
        csrContent
      }
    }
  })
  if (res.status !== 201) {
    console.error(`ASC create failed (HTTP ${res.status}):`)
    console.error(JSON.stringify(res.body, null, 2))
    process.exit(1)
  }

  const cert = res.body.data
  const certPem = `-----BEGIN CERTIFICATE-----\n${cert.attributes.certificateContent.replace(/(.{64})/g, "$1\n").trim()}\n-----END CERTIFICATE-----\n`
  const certPath = join(dir, "cert.pem")
  writeFileSync(certPath, certPem)
  console.log(`✓ Created cert ${cert.id}: ${cert.attributes.name}`)

  // Build a .p12 with cert + key for keychain import.
  const p12Path = join(dir, "developer-id.p12")
  const p12Password = "ai-dev-sidebar"
  const p12 = spawnSync(
    "openssl",
    [
      "pkcs12",
      "-export",
      "-legacy",
      "-inkey",
      keyPath,
      "-in",
      certPath,
      "-out",
      p12Path,
      "-passout",
      `pass:${p12Password}`,
      "-name",
      cn
    ],
    { stdio: "inherit" }
  )
  if (p12.status !== 0) throw new Error(`openssl pkcs12 export failed (status ${p12.status})`)

  console.log("Importing into login keychain…")
  const importRes = spawnSync(
    "security",
    [
      "import",
      p12Path,
      "-k",
      `${homedir()}/Library/Keychains/login.keychain-db`,
      "-P",
      p12Password,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
      "-T",
      "/usr/bin/productbuild"
    ],
    { stdio: "inherit" }
  )
  if (importRes.status !== 0) {
    console.error("⚠  security import failed; the .p12 is at:", p12Path)
    console.error("   Password:", p12Password)
    process.exit(1)
  }

  // Persist a copy outside /tmp so the next run still has them.
  const persistDir = join(homedir(), ".private_keys", "ai-dev-sidebar")
  mkdirSync(persistDir, { recursive: true })
  const persistedKey = join(persistDir, "developer-id-key.pem")
  const persistedCert = join(persistDir, "developer-id.pem")
  const persistedP12 = join(persistDir, "developer-id.p12")
  writeFileSync(persistedKey, readFileSync(keyPath, "utf-8"))
  chmodSync(persistedKey, 0o600)
  writeFileSync(persistedCert, certPem)
  writeFileSync(persistedP12, readFileSync(p12Path))
  chmodSync(persistedP12, 0o600)

  console.log("✓ Developer ID Application certificate installed.")
  console.log(`  Cert ID:   ${cert.id}`)
  console.log(`  Common name: ${cn}`)
  console.log(`  Backup:    ${persistDir}/`)
  console.log("\nNext step: codesign --sign \"Developer ID Application\" --options runtime --timestamp <binary>")
}

// Path B: web-portal flow.
// Apple gates DEVELOPER_ID_APPLICATION creation through ASC API behind the
// Account Holder role, which API keys can't have. The portal at
// developer.apple.com/account/resources/certificates/list works for Admin
// users (and via Xcode "Manage Certificates"), so we split the work:
//   1. `prepare-csr` mints the private key + CSR locally and prints upload
//      instructions.
//   2. The user uploads the CSR through the web portal (or Xcode) and
//      downloads the resulting `.cer`.
//   3. `import-cert <path-to-cer>` glues the .cer back to the matching
//      private key, builds a .p12, and imports it into the login keychain.
function cmdPrepareCsr(name) {
  const cn = name || `ai-dev-sidebar (${new Date().toISOString().slice(0, 10)})`
  const persistDir = join(homedir(), ".private_keys", "ai-dev-sidebar")
  mkdirSync(persistDir, { recursive: true })
  const keyPath = join(persistDir, "developer-id-key.pem")
  const csrPath = join(persistDir, "developer-id.csr")
  if (existsSync(keyPath)) {
    console.error(`⚠  ${keyPath} already exists. Refusing to overwrite.`)
    console.error("   If you really want a fresh CSR, move the file aside first.")
    process.exit(1)
  }
  const gen = spawnSync(
    "openssl",
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      csrPath,
      "-subj",
      `/CN=${cn}/O=${cn}/C=US`
    ],
    { stdio: "inherit" }
  )
  if (gen.status !== 0) throw new Error(`openssl req failed (status ${gen.status})`)
  chmodSync(keyPath, 0o600)
  console.log(`\n✓ Wrote private key:  ${keyPath}`)
  console.log(`✓ Wrote CSR:          ${csrPath}\n`)
  console.log("Next steps (Account Holder must perform):")
  console.log("  1. Open https://developer.apple.com/account/resources/certificates/add")
  console.log("  2. Choose 'Developer ID Application'.")
  console.log(`  3. Upload  ${csrPath}`)
  console.log("  4. Download the resulting .cer (it'll save to ~/Downloads).")
  console.log("  5. Run:  node scripts/asc-cert.mjs import-cert ~/Downloads/<file>.cer")
  console.log("\n(Alternative: Xcode → Settings → Accounts → Manage Certificates → +")
  console.log(" → Developer ID Application also works for Admin users.)")
}

function cmdImportCert(certPath) {
  if (!certPath || !existsSync(certPath)) {
    console.error("usage: asc-cert.mjs import-cert <path-to-developer-id.cer>")
    process.exit(2)
  }
  const persistDir = join(homedir(), ".private_keys", "ai-dev-sidebar")
  const keyPath = join(persistDir, "developer-id-key.pem")
  if (!existsSync(keyPath)) {
    console.error(`✗ No private key at ${keyPath}.`)
    console.error("   Run `prepare-csr` first; the key must match the CSR you uploaded.")
    process.exit(1)
  }
  // Apple ships .cer in DER form; convert to PEM for openssl pkcs12 -export.
  const certPem = join(persistDir, "developer-id.pem")
  const conv = spawnSync(
    "openssl",
    ["x509", "-inform", "der", "-in", certPath, "-out", certPem],
    { stdio: "inherit" }
  )
  if (conv.status !== 0) {
    // Already PEM? try copy
    writeFileSync(certPem, readFileSync(certPath))
  }
  const p12Path = join(persistDir, "developer-id.p12")
  const p12Password = "ai-dev-sidebar"
  const cn = `ai-dev-sidebar (${new Date().toISOString().slice(0, 10)})`
  const p12 = spawnSync(
    "openssl",
    [
      "pkcs12",
      "-export",
      "-legacy",
      "-inkey",
      keyPath,
      "-in",
      certPem,
      "-out",
      p12Path,
      "-passout",
      `pass:${p12Password}`,
      "-name",
      cn
    ],
    { stdio: "inherit" }
  )
  if (p12.status !== 0) throw new Error(`openssl pkcs12 export failed (status ${p12.status})`)
  chmodSync(p12Path, 0o600)
  const importRes = spawnSync(
    "security",
    [
      "import",
      p12Path,
      "-k",
      `${homedir()}/Library/Keychains/login.keychain-db`,
      "-P",
      p12Password,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
      "-T",
      "/usr/bin/productbuild"
    ],
    { stdio: "inherit" }
  )
  if (importRes.status !== 0) {
    console.error("⚠  security import returned non-zero. Check Keychain Access.")
    process.exit(1)
  }
  console.log(`\n✓ Developer ID Application imported into login keychain.`)
  console.log(`  Backup .p12: ${p12Path} (password: ${p12Password})`)
  console.log("\nVerify:  security find-identity -v -p codesigning | grep 'Developer ID'")
}

async function main() {
  const cmd = process.argv[2] || "list"
  if (cmd === "list") return cmdList(process.argv[3])
  if (cmd === "list-type") return cmdList(process.argv[3])
  if (cmd === "revoke") return cmdRevoke(process.argv[3])
  if (cmd === "create-developer-id") {
    const nameIdx = process.argv.indexOf("--name")
    const name = nameIdx >= 0 ? process.argv[nameIdx + 1] : undefined
    return cmdCreateDeveloperId(name)
  }
  if (cmd === "prepare-csr") {
    const nameIdx = process.argv.indexOf("--name")
    const name = nameIdx >= 0 ? process.argv[nameIdx + 1] : undefined
    return cmdPrepareCsr(name)
  }
  if (cmd === "import-cert") return cmdImportCert(process.argv[3])
  console.error(
    "usage: asc-cert.mjs <list|list-type TYPE|revoke ID|create-developer-id [--name N]|prepare-csr [--name N]|import-cert PATH>"
  )
  process.exit(2)
}

main().catch((err) => {
  console.error(err.stack || err.message || err)
  process.exit(1)
})
