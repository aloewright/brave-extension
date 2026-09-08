import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = realpathSync(resolve(process.argv[2] || join(root, 'build')));
const extensionId = createHash('sha256').update(build).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const dir = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts');
mkdirSync(dir, { recursive: true });
const wrapper = join(dir, 'media-download.sh');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(wrapper, `#!/bin/sh\nexport PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'\nexec ${quote(process.execPath)} ${quote(join(root, 'native-host/media-download-host.mjs'))}\n`, { mode: 0o700 });
writeFileSync(join(dir, 'com.aidev.media_download.json'), JSON.stringify({
  name: 'com.aidev.media_download', description: 'Download video and audio to Downloads',
  path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`],
}, null, 2) + '\n');
console.log(`Brave media download helper installed for ${extensionId}\nLoad unpacked: ${build}`);
