import { spawn } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expoCli = path.join(projectRoot, 'node_modules', 'expo', 'bin', 'cli');
const electronBinary = require('electron');
const electronMain = path.join(projectRoot, 'desktop', 'dist', 'main.js');
const rendererHost = 'localhost';
const firstRendererPort = 8081;
const lastRendererPort = 8090;
const children = new Set();

let shuttingDown = false;
let exitCode = 0;
let resolveStopped;
const stopped = new Promise((resolve) => {
  resolveStopped = resolve;
});

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function canConnect(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: rendererHost, port });
    const finish = (connected) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function findAvailableRendererPort() {
  for (let port = firstRendererPort; port <= lastRendererPort; port += 1) {
    if (!(await canConnect(port))) return port;
  }
  throw new Error(
    `No free Electron renderer port found between ${firstRendererPort} and ${lastRendererPort}`,
  );
}

async function waitForMetro(metro, rendererPort, rendererUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (metro.exitCode !== null || metro.signalCode !== null) {
      throw new Error('Expo Metro exited before its development server was ready');
    }
    if (await canConnect(rendererPort)) return;
    await wait(250);
  }
  throw new Error(`Timed out waiting for Expo Metro at ${rendererUrl}`);
}

function stopChildren(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  if (children.size === 0) resolveStopped();

  const forceTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 3_000);
  forceTimer.unref();
}

function track(name, child) {
  const startedAt = Date.now();
  children.add(child);
  child.once('error', (error) => {
    console.error(`Unable to start ${name}:`, error);
    exitCode = 1;
    stopChildren();
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      const exitedImmediately = name === 'Electron' && Date.now() - startedAt < 2_000;
      if (exitedImmediately) {
        console.error(
          `Electron exited immediately; another PsstPsst instance may already be running (${code})`,
        );
        exitCode = 1;
      } else if (code !== 0 || signal) {
        console.error(`${name} exited unexpectedly${signal ? ` (${signal})` : ` (${code})`}`);
        exitCode = code && code > 0 ? code : 1;
      }
      stopChildren();
    }
    if (shuttingDown && children.size === 0) resolveStopped();
  });
  return child;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stopChildren(signal));
}

const rendererPort = await findAvailableRendererPort();
const rendererUrl = `http://${rendererHost}:${rendererPort}`;

const metro = track(
  'Expo Metro',
  spawn(
    process.execPath,
    [expoCli, 'start', '--web', '--localhost', '--port', String(rendererPort)],
    {
      cwd: projectRoot,
      env: { ...process.env, BROWSER: 'none' },
      stdio: 'inherit',
    },
  ),
);

try {
  await waitForMetro(metro, rendererPort, rendererUrl);
  console.log(`Starting Electron with Fast Refresh from ${rendererUrl}`);
  track(
    'Electron',
    spawn(electronBinary, [electronMain], {
      cwd: projectRoot,
      env: { ...process.env, PSSTPSST_RENDERER_URL: rendererUrl },
      stdio: 'inherit',
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
  stopChildren();
}

await stopped;
process.exitCode = exitCode;
