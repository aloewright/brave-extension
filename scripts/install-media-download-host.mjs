import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, realpathSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = realpathSync(resolve(process.argv[2] || join(root, 'build')));
const extensionId = createHash('sha256').update(build).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
// Brave on macOS overrides its native-host lookup to Chrome's directory.
// This is shared by standard Brave and Brave Origin, not their profile roots.
const dir = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
mkdirSync(dir, { recursive: true });
// Installed helpers must not depend on access to a protected Documents checkout.
const helperDir = join(homedir(), 'Library/Application Support/Brave Dev Extension/Media Download');
mkdirSync(helperDir, { recursive: true });
for (const name of ['media-download-host.mjs', 'media-download.mjs']) {
  copyFileSync(join(root, 'native-host', name), join(helperDir, name));
}
const wrapper = join(dir, 'media-download.sh');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(wrapper, `#!/bin/sh\nexport PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'\nexec ${quote(process.execPath)} ${quote(join(helperDir, 'media-download-host.mjs'))}\n`, { mode: 0o700 });
writeFileSync(join(dir, 'com.aidev.media_download.json'), JSON.stringify({
  name: 'com.aidev.media_download', description: 'Download video and audio to Downloads',
  path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`],
}, null, 2) + '\n');
console.log(`Brave media download helper installed for ${extensionId}\nLoad unpacked: ${build}`);
