#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const crypto = webcrypto;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const APP_URL = 'https://go.lazee.workers.dev';
const DAV_URL = 'https://dav.lazee.workers.dev';
const ADMIN_EMAIL = 'aloe@fly.pm';
const DAV_USERNAME = 'go';
const KDF_ITERATIONS = 600000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || APP_DIR,
    input: options.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(stderr || stdout || `${command} ${args.join(' ')} failed`);
  }
  return String(result.stdout || '');
}

function promptHidden(message) {
  const script = [
    'set dialogResult to display dialog ' + JSON.stringify(message) + ' default answer "" with hidden answer buttons {"Cancel", "OK"} default button "OK"',
    'return text returned of dialogResult',
  ];
  try {
    return execFileSync('osascript', script.flatMap((line) => ['-e', line]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail('Canceled.');
  }
}

function confirmDialog(message) {
  const script = [
    'set dialogResult to display dialog ' + JSON.stringify(message) + ' buttons {"Cancel", "Continue"} default button "Continue" with icon caution',
    'return button returned of dialogResult',
  ];
  try {
    const result = execFileSync('osascript', script.flatMap((line) => ['-e', line]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return result === 'Continue';
  } catch {
    return false;
  }
}

async function pbkdf2(passwordOrBytes, saltOrBytes, iterations, keyLen) {
  const passwordBytes = typeof passwordOrBytes === 'string' ? new TextEncoder().encode(passwordOrBytes) : passwordOrBytes;
  const saltBytes = typeof saltOrBytes === 'string' ? new TextEncoder().encode(saltOrBytes) : saltOrBytes;
  const key = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    keyLen * 8
  );
  return new Uint8Array(bits);
}

async function hkdfExpand(prk, info, length) {
  const infoBytes = new TextEncoder().encode(info || '');
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let offset = 0;
  let counter = 1;
  while (offset < length) {
    const input = new Uint8Array(previous.length + infoBytes.length + 1);
    input.set(previous, 0);
    input.set(infoBytes, previous.length);
    input[input.length - 1] = counter & 0xff;
    previous = new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
    const copyLen = Math.min(previous.length, length - offset);
    result.set(previous.slice(0, copyLen), offset);
    offset += copyLen;
    counter += 1;
  }
  return result;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

async function encryptBw(data, encKey, macKey) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encKey, { name: 'AES-CBC' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data));
  const mac = await hmacSha256(macKey, concatBytes(iv, cipher));
  return `2.${bytesToBase64(iv)}|${bytesToBase64(cipher)}|${bytesToBase64(mac)}`;
}

async function buildAdminResetPayload(masterPassword) {
  const email = ADMIN_EMAIL.toLowerCase();
  const masterKey = await pbkdf2(masterPassword, email, KDF_ITERATIONS, 32);
  const masterHash = await pbkdf2(masterKey, masterPassword, 1, 32);
  const encKey = await hkdfExpand(masterKey, 'enc', 32);
  const macKey = await hkdfExpand(masterKey, 'mac', 32);
  const sym = crypto.getRandomValues(new Uint8Array(64));
  const encryptedVaultKey = await encryptBw(sym, encKey, macKey);
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    true,
    ['encrypt', 'decrypt']
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));

  return {
    email,
    name: email,
    masterPasswordHash: bytesToBase64(masterHash),
    key: encryptedVaultKey,
    kdf: 0,
    kdfIterations: KDF_ITERATIONS,
    masterPasswordHint: null,
    allowVaultKeyReset: true,
    keys: {
      publicKey: bytesToBase64(publicKey),
      encryptedPrivateKey: await encryptBw(privateKey, sym.slice(0, 32), sym.slice(32, 64)),
    },
  };
}

async function postJson(url, token, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function verifyLogin(masterPassword) {
  const email = ADMIN_EMAIL.toLowerCase();
  const masterKey = await pbkdf2(masterPassword, email, KDF_ITERATIONS, 32);
  const masterHash = await pbkdf2(masterKey, masterPassword, 1, 32);
  const body = new URLSearchParams();
  body.set('grant_type', 'password');
  body.set('username', email);
  body.set('password', bytesToBase64(masterHash));
  body.set('scope', 'api offline_access');
  body.set('deviceIdentifier', `maintenance-${randomBytes(8).toString('hex')}`);
  body.set('deviceName', 'Maintenance reset');
  body.set('deviceType', '14');
  const response = await fetch(`${APP_URL}/identity/connect/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-NodeWarden-Web-Session': '1',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login verification failed: ${response.status} ${text}`);
  }
}

function setWorkerSecret(name, value, args = []) {
  run('npx', ['wrangler', 'secret', 'put', name, ...args], {
    input: `${value}\n`,
  });
}

function deleteWorkerSecret(name) {
  run('npx', ['wrangler', 'secret', 'delete', name], {
    input: 'y\n',
  });
}

async function main() {
  const appPassword = promptHidden(`Enter the new master password for ${ADMIN_EMAIL}`);
  if (appPassword.length < 12) fail('App master password must be at least 12 characters.');
  const appPassword2 = promptHidden('Confirm the new app master password');
  if (appPassword !== appPassword2) fail('App master passwords did not match.');

  const webDavPassword = promptHidden(`Enter the new WebDAV password for ${DAV_USERNAME}`);
  if (!webDavPassword) fail('WebDAV password cannot be empty.');
  const webDavPassword2 = promptHidden('Confirm the new WebDAV password');
  if (webDavPassword !== webDavPassword2) fail('WebDAV passwords did not match.');

  if (!confirmDialog('This will reset the admin master password by creating fresh vault key material. Existing vault items encrypted to the previous key may no longer decrypt. Continue?')) {
    fail('Canceled.');
  }

  const token = `maintenance-${randomBytes(32).toString('hex')}`;
  let adminSecretSet = false;
  let backupSecretSet = false;
  try {
    console.log('Setting temporary maintenance secrets...');
    setWorkerSecret('ADMIN_RESET_BOOTSTRAP_TOKEN', token);
    adminSecretSet = true;
    setWorkerSecret('BACKUP_BOOTSTRAP_TOKEN', token);
    backupSecretSet = true;

    console.log('Rotating WebDAV Worker credentials...');
    setWorkerSecret('USERNAME', DAV_USERNAME, ['--name', 'dav']);
    setWorkerSecret('PASSWORD', webDavPassword, ['--name', 'dav']);

    console.log('Resetting admin credentials...');
    const adminPayload = await buildAdminResetPayload(appPassword);
    const reset = await postJson(`${APP_URL}/api/admin/bootstrap/reset-admin`, token, adminPayload);
    console.log(`Admin reset complete for ${reset.email}.`);

    console.log('Saving encrypted WebDAV backup settings and running verification backup...');
    const backupPayload = {
      runNow: true,
      destinationId: 'go-webdav',
      destinations: [
        {
          id: 'go-webdav',
          name: 'Go WebDAV',
          type: 'webdav',
          includeAttachments: true,
          destination: {
            baseUrl: DAV_URL,
            username: DAV_USERNAME,
            password: webDavPassword,
            remotePath: 'go',
          },
          schedule: {
            enabled: true,
            intervalHours: 24,
            startTime: '03:00',
            timezone: 'UTC',
            retentionCount: 30,
          },
          runtime: {},
        },
      ],
    };
    const backup = await postJson(`${APP_URL}/api/admin/backup/bootstrap`, token, backupPayload);
    const uploaded = backup?.result?.remotePath || backup?.result?.fileName || 'backup archive';
    console.log(`Backup settings saved and verified: ${uploaded}`);

    console.log('Verifying login with the new app master password...');
    await verifyLogin(appPassword);
    console.log('Login verification passed.');
  } finally {
    console.log('Removing temporary maintenance secrets...');
    if (adminSecretSet) {
      try {
        deleteWorkerSecret('ADMIN_RESET_BOOTSTRAP_TOKEN');
      } catch (error) {
        console.error(`Failed to delete ADMIN_RESET_BOOTSTRAP_TOKEN: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (backupSecretSet) {
      try {
        deleteWorkerSecret('BACKUP_BOOTSTRAP_TOKEN');
      } catch (error) {
        console.error(`Failed to delete BACKUP_BOOTSTRAP_TOKEN: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
