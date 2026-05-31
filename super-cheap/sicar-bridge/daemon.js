#!/usr/bin/env node
/*
   SUPER CHEAP - SICAR background sync daemon

   Runs sync.js periodically in the background. It only reads SICAR/MySQL through
   sync.js and writes local logs under C:\super-cheap\logs.
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
const SYNC_JS = path.join(ROOT, 'sync.js');
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_DAYS_BACK = 1;
const DEFAULT_START_DELAY_SECONDS = 20;

function numberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const INTERVAL_MINUTES = numberEnv('SC_SYNC_INTERVAL_MINUTES', DEFAULT_INTERVAL_MINUTES, 1, 1440);
const DAYS_BACK = numberEnv('SC_SYNC_DAYS_BACK', DEFAULT_DAYS_BACK, 0, 14);
const START_DELAY_SECONDS = numberEnv('SC_SYNC_START_DELAY_SECONDS', DEFAULT_START_DELAY_SECONDS, 0, 600);

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function log(message, level = 'INFO') {
  ensureLogDir();
  const line = `[${nowStamp()}] [${level}] ${message}`;
  const file = path.join(LOG_DIR, `daemon-${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(file, line + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localIsoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function pipeName() {
  if (process.platform === 'win32') return '\\\\.\\pipe\\super-cheap-sicar-daemon';
  return path.join(os.tmpdir(), 'super-cheap-sicar-daemon.sock');
}

function startSingleInstanceGuard() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        log('Ya hay un daemon de SUPER CHEAP ejecutandose. Saliendo.');
        resolve(null);
        return;
      }
      reject(err);
    });
    server.once('listening', () => resolve(server));
    server.listen(pipeName());
  });
}

function appendChildOutput(fecha, chunk, streamName) {
  const file = path.join(LOG_DIR, `daemon-child-${new Date().toISOString().slice(0, 10)}.log`);
  const text = String(chunk || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${nowStamp()}] [${streamName}] [${fecha}] ${line}`)
    .join('\n');
  if (text) fs.appendFileSync(file, text + '\n', 'utf8');
}

async function runSyncForDate(fecha) {
  return new Promise((resolve) => {
    log(`Sincronizando fecha ${fecha}.`);
    const child = spawn(process.execPath, [SYNC_JS, fecha], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => appendChildOutput(fecha, chunk, 'OUT'));
    child.stderr.on('data', (chunk) => appendChildOutput(fecha, chunk, 'ERR'));
    child.once('error', (err) => {
      log(`No pude iniciar sync.js para ${fecha}: ${err.message}`, 'ERROR');
      resolve(false);
    });
    child.once('close', (code) => {
      if (code === 0) {
        log(`Sincronizacion ${fecha} terminada OK.`);
        resolve(true);
      } else {
        log(`Sincronizacion ${fecha} termino con codigo ${code}. Reintentara despues.`, 'WARN');
        resolve(false);
      }
    });
  });
}

let running = false;

async function runCycle() {
  if (running) {
    log('Ciclo omitido porque el ciclo anterior sigue en ejecucion.', 'WARN');
    return;
  }
  running = true;
  try {
    for (let daysAgo = DAYS_BACK; daysAgo >= 0; daysAgo -= 1) {
      await runSyncForDate(localIsoDate(daysAgo));
    }
  } catch (err) {
    log(`Error en ciclo daemon: ${err.message || String(err)}`, 'ERROR');
  } finally {
    running = false;
  }
}

async function main() {
  ensureLogDir();
  const guard = await startSingleInstanceGuard();
  if (!guard) return;

  log(`Daemon iniciado. Intervalo=${INTERVAL_MINUTES} min, dias atras=${DAYS_BACK}.`);
  if (START_DELAY_SECONDS > 0) await sleep(START_DELAY_SECONDS * 1000);
  await runCycle();
  setInterval(runCycle, INTERVAL_MINUTES * 60 * 1000);
}

process.on('uncaughtException', (err) => {
  log(`Fallo no controlado: ${err.message || String(err)}`, 'ERROR');
});

process.on('unhandledRejection', (err) => {
  log(`Promesa rechazada: ${err && err.message ? err.message : String(err)}`, 'ERROR');
});

main().catch((err) => {
  log(`No pude iniciar daemon: ${err.message || String(err)}`, 'ERROR');
  process.exit(1);
});
