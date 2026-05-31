#!/usr/bin/env node
/*
   SUPER CHEAP - SICAR historical backfill

   Runs sync.js one date at a time and persists progress in backfill-state.json.
   It is safe to restart: the current pending date will be retried until Netlify
   accepts it, then the process advances to the next day.
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
const STATE_FILE = path.join(ROOT, 'backfill-state.json');
const SYNC_JS = path.join(ROOT, 'sync.js');

const DEFAULT_START_DATE = '2024-05-01';
const DEFAULT_END_DATE = '2026-05-30';
const DEFAULT_RETRY_SECONDS = 60;
const DEFAULT_PAUSE_SECONDS = 2;
const DEFAULT_CHILD_TIMEOUT_MINUTES = 10;

function numberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const RETRY_SECONDS = numberEnv('SC_BACKFILL_RETRY_SECONDS', DEFAULT_RETRY_SECONDS, 15, 3600);
const PAUSE_SECONDS = numberEnv('SC_BACKFILL_PAUSE_SECONDS', DEFAULT_PAUSE_SECONDS, 0, 300);
const CHILD_TIMEOUT_MINUTES = numberEnv('SC_BACKFILL_CHILD_TIMEOUT_MINUTES', DEFAULT_CHILD_TIMEOUT_MINUTES, 1, 120);
const CHILD_TIMEOUT_MS = CHILD_TIMEOUT_MINUTES * 60 * 1000;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function nowStamp() {
  return nowIso().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function log(message, level = 'INFO') {
  ensureLogDir();
  const line = `[${nowStamp()}] [${level}] ${message}`;
  const file = path.join(LOG_DIR, `backfill-${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(file, line + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function parseIsoDate(value) {
  if (!isIsoDate(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

function addDays(value, days) {
  const d = parseIsoDate(value);
  if (!d) throw new Error(`Fecha invalida: ${value}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateCount(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function safeError(value) {
  return String(value || '')
    .replace(/password\s*[:=]\s*[^,\s}]+/gi, 'password=[oculto]')
    .replace(/token\s*[:=]\s*[^,\s}]+/gi, 'token=[oculto]')
    .slice(0, 500);
}

function pipeName() {
  if (process.platform === 'win32') return '\\\\.\\pipe\\super-cheap-sicar-backfill';
  return path.join(os.tmpdir(), 'super-cheap-sicar-backfill.sock');
}

function startSingleInstanceGuard() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        log('Ya hay un backfill de SUPER CHEAP ejecutandose. Saliendo.');
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
  const file = path.join(LOG_DIR, `backfill-child-${new Date().toISOString().slice(0, 10)}.log`);
  const text = String(chunk || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${nowStamp()}] [${streamName}] [${fecha}] ${line}`)
    .join('\n');
  if (text) fs.appendFileSync(file, text + '\n', 'utf8');
}

function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  const data = {
    ...state,
    updatedAt: nowIso(),
  };
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log(`No pude guardar backfill-state.json: ${err.message}`, 'WARN');
  }
  return data;
}

function freshState(startDate, endDate) {
  return {
    status: 'running',
    startDate,
    endDate,
    nextDate: startDate,
    completed: 0,
    failures: 0,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    totalDays: dateCount(startDate, endDate),
    lastOkDate: null,
    lastAttemptDate: null,
    lastError: '',
  };
}

function loadState(startDate, endDate) {
  try {
    if (!fs.existsSync(STATE_FILE)) return freshState(startDate, endDate);
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw.startDate !== startDate || raw.endDate !== endDate) {
      log(`Rango nuevo ${startDate}..${endDate}; se inicia estado nuevo.`);
      return freshState(startDate, endDate);
    }
    if (!parseIsoDate(raw.nextDate) && raw.status !== 'complete') return freshState(startDate, endDate);
    return {
      ...freshState(startDate, endDate),
      ...raw,
      status: raw.status === 'complete' ? 'complete' : 'running',
      totalDays: dateCount(startDate, endDate),
    };
  } catch (err) {
    log(`No pude leer backfill-state.json; iniciare desde ${startDate}: ${err.message}`, 'WARN');
    return freshState(startDate, endDate);
  }
}

async function runSyncForDate(fecha) {
  return new Promise((resolve) => {
    log(`Sincronizando fecha historica ${fecha}.`);
    let settled = false;
    let lastChildError = '';
    const child = spawn(process.execPath, [SYNC_JS, fecha], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (ok, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok, message: safeError(message || lastChildError) });
    };

    const timeout = setTimeout(() => {
      const message = `Sincronizacion ${fecha} excedio ${CHILD_TIMEOUT_MINUTES} min. Se cerrara y quedara pendiente.`;
      log(message, 'WARN');
      lastChildError = message;
      child.kill();
    }, CHILD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => appendChildOutput(fecha, chunk, 'OUT'));
    child.stderr.on('data', (chunk) => {
      lastChildError = String(chunk || '').trim().slice(-500) || lastChildError;
      appendChildOutput(fecha, chunk, 'ERR');
    });
    child.once('error', (err) => {
      finish(false, `No pude iniciar sync.js para ${fecha}: ${err.message}`);
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish(true, '');
      } else {
        const salida = signal ? `senal ${signal}` : `codigo ${code}`;
        finish(false, `sync.js para ${fecha} termino con ${salida}. ${lastChildError}`.trim());
      }
    });
  });
}

function readArgs(argv) {
  const args = (argv || []).map(String);
  const reset = args.includes('--reset');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const startDate = positional[0] || DEFAULT_START_DATE;
  const endDate = positional[1] || DEFAULT_END_DATE;
  if (!parseIsoDate(startDate)) throw new Error(`Fecha inicial invalida "${startDate}". Usa YYYY-MM-DD.`);
  if (!parseIsoDate(endDate)) throw new Error(`Fecha final invalida "${endDate}". Usa YYYY-MM-DD.`);
  if (startDate.localeCompare(endDate) > 0) throw new Error('La fecha inicial no puede ser mayor que la final.');
  return { startDate, endDate, reset };
}

async function main() {
  ensureLogDir();
  const guard = await startSingleInstanceGuard();
  if (!guard) return;

  const { startDate, endDate, reset } = readArgs(process.argv.slice(2));
  let state = reset ? freshState(startDate, endDate) : loadState(startDate, endDate);
  state.status = state.status === 'complete' ? 'complete' : 'running';
  state = saveState(state);

  log(`Backfill iniciado. Rango=${startDate}..${endDate}, siguiente=${state.nextDate}, total=${state.totalDays}, reintento=${RETRY_SECONDS}s, timeout=${CHILD_TIMEOUT_MINUTES} min, reset=${reset ? 'si' : 'no'}.`);

  while (state.nextDate && state.nextDate.localeCompare(endDate) <= 0) {
    const fecha = state.nextDate;
    state.lastAttemptDate = fecha;
    state = saveState(state);

    const result = await runSyncForDate(fecha);
    if (result.ok) {
      state.completed = Number(state.completed || 0) + 1;
      state.lastOkDate = fecha;
      state.lastError = '';
      state.nextDate = addDays(fecha, 1);
      state = saveState(state);
      log(`Fecha ${fecha} OK. Progreso ${state.completed}/${state.totalDays}. Siguiente=${state.nextDate}.`);
      if (PAUSE_SECONDS > 0) await sleep(PAUSE_SECONDS * 1000);
      continue;
    }

    state.failures = Number(state.failures || 0) + 1;
    state.lastError = result.message || `fallo en ${fecha}`;
    state = saveState(state);
    log(`Fecha ${fecha} fallo y queda pendiente: ${state.lastError}. Reintento en ${RETRY_SECONDS}s.`, 'WARN');
    await sleep(RETRY_SECONDS * 1000);
  }

  state.status = 'complete';
  state.finishedAt = nowIso();
  state.nextDate = addDays(endDate, 1);
  state = saveState(state);
  log(`Backfill completo. Rango=${startDate}..${endDate}. Fechas OK=${state.completed}, fallos reintentados=${state.failures}.`);
}

process.on('uncaughtException', (err) => {
  log(`Fallo no controlado: ${err.message || String(err)}`, 'ERROR');
});

process.on('unhandledRejection', (err) => {
  log(`Promesa rechazada: ${err && err.message ? err.message : String(err)}`, 'ERROR');
});

main().catch((err) => {
  log(`No pude iniciar backfill: ${err.message || String(err)}`, 'ERROR');
  process.exit(1);
});
