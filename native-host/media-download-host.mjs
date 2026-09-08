#!/usr/bin/env node
import { downloadMedia } from './media-download.mjs';

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

let buffer = Buffer.alloc(0);
let busy = false;
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > 65536) process.exit(1);
    if (buffer.length < length + 4) return;
    const body = buffer.subarray(4, length + 4);
    buffer = buffer.subarray(length + 4);
    if (busy) { send({ ok: false, error: 'A download is already running.' }); continue; }
    let request;
    try { request = JSON.parse(body.toString()); }
    catch { send({ ok: false, error: 'Invalid download request.' }); continue; }
    busy = true;
    downloadMedia(request).then(
      result => send({ ok: true, ...result }),
      error => send({ ok: false, error: error.message }),
    ).finally(() => { busy = false; });
  }
});
