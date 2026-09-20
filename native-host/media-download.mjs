import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, isAbsolute } from 'node:path';

/** Native messaging hosts do not inherit an interactive shell's PATH. Keep
 * executable resolution shared by ordinary media downloads and encrypted
 * video imports, rather than relying on `spawn('yt-dlp')`. */
export function resolveYtDlpExecutable() {
  const configured = process.env.YT_DLP_PATH;
  const candidates = [
    configured,
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    join(homedir(), '.local', 'bin', 'yt-dlp'),
  ].filter((value) => typeof value === 'string' && isAbsolute(value));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next known native-host location. */ }
  }
  throw new Error('Install yt-dlp and FFmpeg, then try again.');
}

export function downloadArguments(request, directory) {
  if (!['video', 'audio'].includes(request?.mode)) throw new Error('Choose video or audio.');
  const url = new URL(request.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('This video needs an HTTP or HTTPS page URL.');
  }
  let referer;
  if (request.referer !== undefined) {
    const value = new URL(request.referer);
    if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password
      || (value.protocol === 'https:' && url.protocol !== 'https:')) {
      throw new Error('This video has an invalid referring page.');
    }
    // Vimeo's domain-restricted embeds need the Canvas origin, not the
    // student's course path, cookies, or a full signed referring URL.
    referer = value.origin + '/';
  }
  return ['--ignore-config', '--no-playlist', '--no-overwrites', '--no-progress',
    '--no-cache-dir', '--restrict-filenames', '--socket-timeout', '30',
    '--paths', directory, '--output', '%(title).150B [%(id)s].%(ext)s',
    '--print', 'after_move:filepath',
    ...(referer ? ['--referer', referer] : []),
    ...(request.mode === 'audio'
      ? ['--format', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3']
      : ['--format', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--merge-output-format', 'mp4']),
    '--', url.href];
}

export async function downloadMedia(request, directory = join(homedir(), 'Downloads')) {
  const args = downloadArguments(request, directory);
  await mkdir(directory, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlpExecutable(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Download exceeded 30 minutes.')); }, 30 * 60 * 1000);
    child.stdout.on('data', data => { output = (output + data).slice(-8192); });
    child.stderr.on('data', data => { errors = (errors + data).slice(-4096); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Install yt-dlp and FFmpeg, then try again.')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = errors.trim().split('\n').pop()?.replace(/https?:\/\/\S+/g, '[video URL]');
        reject(new Error(detail || 'This video could not be downloaded.'));
      } else {
        const filename = basename(output.trim().split('\n').pop() || '');
        if (!filename) reject(new Error('No downloaded file was produced.'));
        else resolve({ filename });
      }
    });
  });
}
