import { spawn } from 'node:child_process';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHUNK_BYTES = 1_048_576;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeURL(value, label) {
  let url; try { url = new URL(value); } catch { throw new Error(`Invalid ${label}.`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 16384) throw new Error(`Invalid ${label}.`);
  return url;
}

export function validateKeepoutVideoRequest(request) {
  if (request?.mode !== 'keepout-video') throw new Error('Invalid encrypted video request.');
  const url = safeURL(request.url, 'video address');
  const referer = safeURL(request.referer, 'referring page');
  if (url.protocol === 'https:' && referer.protocol !== 'https:') throw new Error('Invalid referring page.');
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
  return new Promise((resolve,reject) => { const child=spawn('yt-dlp',args,{stdio:['ignore','pipe','pipe']}); let out='',err=''; const timer=setTimeout(()=>{child.kill();reject(new Error('Video download exceeded 30 minutes.'));},30*60_000); child.stdout.on('data',d=>out=(out+d).slice(-4096)); child.stderr.on('data',d=>err=(err+d).slice(-4096)); child.on('error',()=>{clearTimeout(timer);reject(new Error('Install yt-dlp and FFmpeg, then retry.'));}); child.on('close',code=>{clearTimeout(timer); if(code) reject(new Error(scrub(err.split('\n').pop()))); else resolve(out.trim().split('\n').pop());}); });
}

export async function importKeepoutVideo(request) {
  const input = validateKeepoutVideoRequest(request); let root; let upload;
  try {
    root = await mkdtemp(join(tmpdir(), 'keepout-video-'), { encoding: 'utf8' });
    await (await import('node:fs/promises')).chmod(root, 0o700);
    const started = await responseJSON(await api(input.connection, '/v1/page-videos','POST',{id:input.id,captureID:input.captureID,title:input.title,contentType:'video/mp4'}));
    if (started.id !== input.id || started.chunkBytes !== CHUNK_BYTES) throw new Error('Incompatible Keepout video session.');
    if (started.complete === true) return { id: input.id, complete: true };
    if (typeof started.uploadNonce !== 'string' || !UUID.test(started.uploadNonce)) throw new Error('Keepout did not return an upload nonce.');
    upload = { id: input.id, nonce: started.uploadNonce };
    const output = await download(input.url, input.referer, root); const file = String(output || '');
    if (!output || !file.startsWith(root + '/')) throw new Error('Video downloader did not produce a safe file.');
    const handle = await open(file, 'r'); try { const buffer = new Uint8Array(CHUNK_BYTES); let index=0,total=0; while (true) { const {bytesRead}=await handle.read(buffer,0,buffer.length,null); if(!bytesRead) break; total+=bytesRead; if(total>MAX_BYTES) throw new Error('Video exceeds Keepout\'s 4 GiB limit.'); const response=await api(input.connection,`/v1/page-videos/${input.id}/chunks?index=${index++}`,'POST',buffer.subarray(0,bytesRead),upload.nonce); if(!response.ok) throw new Error('Keepout rejected a video chunk.'); } } finally { await handle.close(); }
    await responseJSON(await api(input.connection, `/v1/page-videos/${input.id}/complete`, 'POST', {}, upload.nonce)); return { id: input.id, complete: true };
  } catch (error) { if (upload) { try { await api(input.connection, `/v1/page-videos/${upload.id}`, 'DELETE', undefined, upload.nonce); } catch {} } throw new Error(scrub(error));
  } finally { if (root) await rm(root,{recursive:true,force:true}).catch(()=>{}); }
}
