#!/usr/bin/env node

import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });

function respond(id, value) {
  process.stdout.write(`${JSON.stringify({ type: 'response', id, ok: true, value })}\n`);
}

input.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.command === 'handshake') {
    respond(request.id, {
      protocolVersion: 1,
      implementationVersion: 'fake-1',
      platform: process.platform,
      capabilities: { central: true, peripheral: true, concurrentRoles: true },
    });
    return;
  }
  if (request.command === 'requestPermissions') {
    respond(request.id, true);
    return;
  }
  if (request.command === 'send' && request.args?.endpointId === 'c:crash') {
    process.exit(2);
  }
  respond(request.id);
});
