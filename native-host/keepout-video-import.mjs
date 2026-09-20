import { spawn } from 'node:child_process';
import { mkdtemp, open, rm, realpath, lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { resolveYtDlpExecutable } from './media-download.mjs';

const CHUNK_BYTES = 1_048_576;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMP_PREFIX = 'keepout-video-';
const OWNER_FILE = '.keepout-video-owner.json';
const STALE_AFTER_MS = 35 * 60_000;

function safeURL(value, label) {
  let url; try { url = new URL(value); } catch { throw new Error(`Invalid ${label}.`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 16384) throw new Error(`Invalid ${label}.`);
  return url;
}

export function validateKeepoutVideoRequest(request) {
  if (request?.mode !== 'keepout-video') throw new Error('Invalid encrypted video request.');
  const url = safeURL(request.url, 'video address');
  const referer = safeURL(request.referer, 'referring page');
  if (referer.protocol === 'https:' && url.protocol !== 'https:') throw new Error('Invalid referring page.');
  if (!UUID.test(request.id || '') || !UUID.test(request.captureID || '')) throw new Error('Invalid Keepout video identifier.');
  const connection = request.connection;
  if (!connection || !Number.isInteger(connection.port) || connection.port < 1024 || connection.port > 65535 || typeof connection.token !== 'string' || !connection.token || /[\x00-\x20\x7f]/.test(connection.token)) throw new Error('Invalid Keepout connection.');
  if (typeof request.videoTitle !== 'string' || !request.videoTitle.trim() || request.videoTitle.length > 500) throw new Error('Invalid video title.');
  return { url, referer, id: request.id, captureID: request.captureID, title: request.videoTitle.trim(), connection };
}

function scrub(error) { return String(error?.message || error || 'Video import failed.').replace(/https?:\/\/\S+/g, '[video address]').slice(0, 500); }
function api(connection, path, method, body, nonce) {
  return fetch(`http://127.0.0.1:${connection.port}${path}`, { method, headers: { Authorization: `Bearer ${connection.token}`, ...(body ? { 'Content-Type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json' } : {}), ...(nonce ? { 'X-Keepout-Upload': nonce } : {}) }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000) });
}
async function responseJSON(response) { if (!response.ok) throw new Error(response.status === 423 ? 'Keepout is locked.' : 'Keepout rejected the video import.'); const value = await response.json(); if (!value || typeof value !== 'object') throw new Error('Invalid Keepout response.'); return value; }
async function download(url, referer, directory) {
  const args = ['--ignore-config','--no-playlist','--no-overwrites','--no-progress','--no-cache-dir','--restrict-filenames','--socket-timeout','30','--referer',`${referer.origin}/`,'--paths',directory,'--output','video.%(ext)s','--print','after_move:filepath','--format','bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best','--merge-output-format','mp4','--',url.href];
  return new Promise((resolve,reject) => {
    const child = spawn(resolveYtDlpExecutable(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // yt-dlp can launch ffmpeg. A dedicated POSIX process group lets the
      // timeout stop every downloader child before the plaintext root is rm'd.
      detached: process.platform !== 'win32',
    });
    let out = '', err = '', timedOut = false;
    const terminate = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The close event is authoritative. */ }
    };
    const timer = setTimeout(() => { timedOut = true; terminate('SIGTERM'); }, 30 * 60_000);
    const forceTimer = setTimeout(() => { if (timedOut) terminate('SIGKILL'); }, 30 * 60_000 + 5_000);
    child.stdout.on('data', d => out = (out + d).slice(-4096));
    child.stderr.on('data', d => err = (err + d).slice(-4096));
    child.on('error', () => {
      clearTimeout(timer); clearTimeout(forceTimer);
      reject(new Error('Install yt-dlp and FFmpeg, then retry.'));
    });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(forceTimer);
      if (timedOut) reject(new Error('Video download exceeded 30 minutes.'));
      else if (code) reject(new Error(scrub(err.split('\n').pop())));
      else resolve(out.trim().split('\n').pop());
    });
  });
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path && !path.startsWith('..') && !isAbsolute(path);
}

/// Accept only the regular file yt-dlp printed after its move. This rejects
/// a hostile stdout path, symlinks, and every path that escapes our 0700 root.
export async function verifiedDownloadedFile(root, output) {
  try {
    if (typeof output !== 'string' || !isAbsolute(output)) throw new Error();
    const rootReal = await realpath(root);
    const printed = resolve(output);
    const printedStat = await lstat(printed);
    if (!printedStat.isFile() || printedStat.isSymbolicLink()) throw new Error();
    const fileReal = await realpath(printed);
    const realStat = await lstat(fileReal);
    if (!realStat.isFile() || realStat.isSymbolicLink() || !isInside(rootReal, fileReal)) throw new Error();
    return fileReal;
  } catch {
    throw new Error('Video downloader did not produce a safe file.');
  }
}

function isLivePID(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Removes only old, marker-owned Keepout plaintext directories. Active
 * imports are protected by their live owner PID; unknown legacy directories
 * are deliberately left alone rather than risking a concurrent import. */
export async function cleanupStaleKeepoutVideoDirectories({ directory = tmpdir(), now = Date.now() } = {}) {
  try {
    const parent = await realpath(directory);
    const entries = await readdir(parent, { withFileTypes: true });
    const cutoff = now - STALE_AFTER_MS;
    for (const entry of entries) {
      if (!entry.name.startsWith(TEMP_PREFIX) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = join(parent, entry.name);
      let directory;
      try {
        directory = await realpath(candidate);
        if (!isInside(parent, directory)) continue;
        const marker = join(directory, OWNER_FILE);
        let markerStat;
        try {
          markerStat = await lstat(marker);
        } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        // Marker-less roots predate this ownership protocol, and malformed
        // markers are not proof that this running helper owns the directory.
        // Preserve both rather than risk deleting a concurrent legacy import.
        if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.mtimeMs >= cutoff) continue;
        let owner;
        try { owner = JSON.parse(await readFile(marker, 'utf8')); } catch { continue; }
        if (!Number.isInteger(owner?.pid) || owner.pid <= 0) continue;
        if (isLivePID(owner?.pid)) continue;
        await rm(directory, { recursive: true, force: false, maxRetries: 1 });
      } catch (error) {
        // A second native helper may have removed the same already-stale
        // directory between our lstat and rm. That is safe and not a setup
        // failure for the active import.
        if (error?.code === 'ENOENT') continue;
        throw new Error('Could not prepare secure temporary video storage.');
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Could not prepare secure temporary video storage.') throw error;
    throw new Error('Could not prepare secure temporary video storage.');
  }
}

export function videoTypeFromPrefix(prefix) {
  if (prefix.byteLength < 64) throw new Error('Video downloader produced an incomplete video file.');
  const ascii = (from, count) => String.fromCharCode(...prefix.slice(from, from + count));
  if (ascii(4, 4) === 'ftyp' && /isom|iso[2-9]|mp4[12]|avc1|M4V |qt  |dash/.test(ascii(8, 56))) return 'video/mp4';
  if (prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) return 'video/webm';
  if (ascii(0, 4) === 'OggS') return 'video/ogg';
  throw new Error('Video downloader did not produce a recognizable video file.');
}

async function verifiedVideoType(file) {
  const handle = await open(file, 'r');
  try {
    const prefix = new Uint8Array(64);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    return videoTypeFromPrefix(prefix.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

export async function importKeepoutVideo(request) {
  const input = validateKeepoutVideoRequest(request); let root; let upload;
  try {
    await cleanupStaleKeepoutVideoDirectories();
    root = await mkdtemp(join(tmpdir(), TEMP_PREFIX), { encoding: 'utf8' });
    await (await import('node:fs/promises')).chmod(root, 0o700);
    await writeFile(join(root, OWNER_FILE), JSON.stringify({ pid: process.pid, createdAt: Date.now() }), { mode: 0o600 });
    const output = await download(input.url, input.referer, root); const file = await verifiedDownloadedFile(root, output);
    const contentType = await verifiedVideoType(file);
    let started = await responseJSON(await api(input.connection, '/v1/page-videos','POST',{id:input.id,captureID:input.captureID,title:input.title,contentType}));
    if (started.id !== input.id || started.chunkBytes !== CHUNK_BYTES) throw new Error('Incompatible Keepout video session.');
    if (started.complete === true) return { id: input.id, complete: true };
    if (typeof started.uploadNonce !== 'string' || !UUID.test(started.uploadNonce) || !Number.isSafeInteger(started.index) || started.index < 0) throw new Error('Keepout did not return a valid upload session.');
    // The native helper can only replay the temporary file from byte zero.
    // Reset a partial strict-index session rather than corrupting or guessing.
    if (started.index > 0) {
      await responseJSON(await api(input.connection, `/v1/page-videos/${input.id}`, 'DELETE', undefined, started.uploadNonce));
      started = await responseJSON(await api(input.connection, '/v1/page-videos','POST',{id:input.id,captureID:input.captureID,title:input.title,contentType}));
      if (started.id !== input.id || started.chunkBytes !== CHUNK_BYTES || started.complete === true || typeof started.uploadNonce !== 'string' || !UUID.test(started.uploadNonce) || started.index !== 0) throw new Error('Keepout could not reset the interrupted video upload.');
    }
    upload = { id: input.id, nonce: started.uploadNonce };
    const handle = await open(file, 'r'); try { const buffer = new Uint8Array(CHUNK_BYTES); let index=0,total=0; while (true) { const {bytesRead}=await handle.read(buffer,0,buffer.length,null); if(!bytesRead) break; total+=bytesRead; if(total>MAX_BYTES) throw new Error('Video exceeds Keepout\'s 4 GiB limit.'); const response=await api(input.connection,`/v1/page-videos/${input.id}/chunks?index=${index++}`,'POST',buffer.subarray(0,bytesRead),upload.nonce); if(!response.ok) throw new Error('Keepout rejected a video chunk.'); } } finally { await handle.close(); }
    await responseJSON(await api(input.connection, `/v1/page-videos/${input.id}/complete`, 'POST', {}, upload.nonce)); return { id: input.id, complete: true };
  } catch (error) { if (upload) { try { await api(input.connection, `/v1/page-videos/${upload.id}`, 'DELETE', undefined, upload.nonce); } catch {} } throw new Error(scrub(error));
  } finally {
    if (root) {
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 1 });
      } catch {
        throw new Error('Could not remove secure temporary video storage.');
      }
    }
  }
}
