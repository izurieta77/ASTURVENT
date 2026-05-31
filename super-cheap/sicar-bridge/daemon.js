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
const STATE_FILE = path.join(ROOT, 'sync-state.json');
const SYNC_JS = path.join(ROOT, 'sync.js');
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_RETRY_SECONDS = 60;
const DEFAULT_DAYS_BACK = 7;
const DEFAULT_START_DELAY_SECONDS = 20;
const DEFAULT_CHILD_TIMEOUT_MINUTES = 10;
const DEFAULT_IDLE_SECONDS = 30;

function numberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const INTERVAL_MINUTES = numberEnv('SC_SYNC_INTERVAL_MINUTES', DEFAULT_INTERVAL_MINUTES, 1, 1440);
const DAYS_BACK = numberEnv('SC_SYNC_DAYS_BACK', DEFAULT_DAYS_BACK, 0, 14);
const RETRY_SECONDS = numberEnv('SC_SYNC_RETRY_SECONDS', DEFAULT_RETRY_SECONDS, 15, 3600);
const START_DELAY_SECONDS = numberEnv('SC_SYNC_START_DELAY_SECONDS', DEFAULT_START_DELAY_SECONDS, 0, 600);
const CHILD_TIMEOUT_MINUTES = numberEnv('SC_SYNC_CHILD_TIMEOUT_MINUTES', DEFAULT_CHILD_TIMEOUT_MINUTES, 1, 120);
const IDLE_SECONDS = numberEnv('SC_SYNC_IDLE_SECONDS', DEFAULT_IDLE_SECONDS, 5, 300);
const CHILD_TIMEOUT_MS = CHILD_TIMEOUT_MINUTES * 60 * 1000;

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

function nowIso() {
  return new Date().toISOString();
}

function localIsoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function safeError(value) {
  return String(value || '')
    .replace(/password\s*[:=]\s*[^,\s}]+/gi, 'password=[oculto]')
    .replace(/token\s*[:=]\s*[^,\s}]+/gi, 'token=[oculto]')
    .slice(0, 500);
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
    let settled = false;
    const child = spawn(process.execPath, [SYNC_JS, fecha], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };

    const timeout = setTimeout(() => {
      log(`Sincronizacion ${fecha} excedio ${CHILD_TIMEOUT_MINUTES} min. Se cerrara y quedara pendiente.`, 'WARN');
      child.kill();
    }, CHILD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => appendChildOutput(fecha, chunk, 'OUT'));
    child.stderr.on('data', (chunk) => appendChildOutput(fecha, chunk, 'ERR'));
    child.once('error', (err) => {
      log(`No pude iniciar sync.js para ${fecha}: ${err.message}`, 'ERROR');
      finish(false);
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        log(`Sincronizacion ${fecha} terminada OK.`);
        finish(true);
      } else {
        const salida = signal ? `senal ${signal}` : `codigo ${code}`;
        log(`Sincronizacion ${fecha} termino con ${salida}. Reintentara pronto.`, 'WARN');
        finish(false);
      }
    });
  });
}

const pending = new Map();

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const item of raw.pending || []) {
      if (!isIsoDate(item.fecha)) continue;
      pending.set(item.fecha, {
        fecha: item.fecha,
        firstSeenAt: item.firstSeenAt || nowIso(),
        lastAttemptAt: item.lastAttemptAt || null,
        nextTryAt: item.nextTryAt || null,
        attempts: Number(item.attempts) || 0,
        lastError: safeError(item.lastError),
      });
    }
    if (pending.size) log(`Estado cargado: ${pending.size} fecha(s) pendiente(s).`);
  } catch (err) {
    log(`No pude leer sync-state.json; seguire con cola nueva: ${err.message}`, 'WARN');
  }
}

function saveState() {
  const data = {
    updatedAt: nowIso(),
    pending: Array.from(pending.values()).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  };
  const tmp = `${STATE_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log(`No pude guardar sync-state.json: ${err.message}`, 'WARN');
  }
}

function queueDate(fecha, reason) {
  if (!isIsoDate(fecha)) return;
  const current = pending.get(fecha);
  if (current) {
    if (!current.nextTryAt) current.nextTryAt = nowIso();
    return;
  }
  pending.set(fecha, {
    fecha,
    firstSeenAt: nowIso(),
    lastAttemptAt: null,
    nextTryAt: nowIso(),
    attempts: 0,
    lastError: reason || '',
  });
}

function queueRollingWindow(reason) {
  for (let daysAgo = DAYS_BACK; daysAgo >= 0; daysAgo -= 1) {
    queueDate(localIsoDate(daysAgo), reason);
  }
  saveState();
  log(`Ventana de recuperacion en cola: hoy y ${DAYS_BACK} dia(s) atras. Pendientes=${pending.size}.`);
}

function duePending() {
  const now = Date.now();
  return Array.from(pending.values())
    .filter((item) => !item.nextTryAt || Date.parse(item.nextTryAt) <= now)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function markResult(fecha, ok, errorMessage) {
  if (ok) {
    pending.delete(fecha);
    saveState();
    return;
  }
  const current = pending.get(fecha) || { fecha, firstSeenAt: nowIso(), attempts: 0 };
  current.attempts = (Number(current.attempts) || 0) + 1;
  current.lastAttemptAt = nowIso();
  current.nextTryAt = new Date(Date.now() + RETRY_SECONDS * 1000).toISOString();
  current.lastError = safeError(errorMessage || `fallo intento ${current.attempts}`);
  pending.set(fecha, current);
  saveState();
}

function msUntilNextWork() {
  const now = Date.now();
  const nextDue = Array.from(pending.values())
    .map((item) => Date.parse(item.nextTryAt || nowIso()))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  if (!nextDue) return IDLE_SECONDS * 1000;
  return Math.max(1000, Math.min(IDLE_SECONDS * 1000, nextDue - now));
}

async function runDueWork() {
  const due = duePending();
  if (!due.length) return false;
  log(`Intentando ${due.length} fecha(s) pendiente(s): ${due.map((item) => item.fecha).join(', ')}`);
  for (const item of due) {
    const ok = await runSyncForDate(item.fecha);
    markResult(item.fecha, ok);
    if (!ok) {
      log(`Fecha ${item.fecha} queda pendiente; proximo intento en ${RETRY_SECONDS} segundo(s).`, 'WARN');
    }
  }
  return true;
}

async function main() {
  ensureLogDir();
  const guard = await startSingleInstanceGuard();
  if (!guard) return;

  loadState();
  queueRollingWindow('arranque');
  let lastRollingWindowAt = Date.now();

  log(`Daemon iniciado. Intervalo=${INTERVAL_MINUTES} min, reintento=${RETRY_SECONDS}s, dias atras=${DAYS_BACK}, timeout=${CHILD_TIMEOUT_MINUTES} min.`);
  if (START_DELAY_SECONDS > 0) await sleep(START_DELAY_SECONDS * 1000);

  while (true) {
    try {
      const now = Date.now();
      if (now - lastRollingWindowAt >= INTERVAL_MINUTES * 60 * 1000) {
        queueRollingWindow('ciclo');
        lastRollingWindowAt = now;
      }
      const worked = await runDueWork();
      if (!worked) await sleep(msUntilNextWork());
    } catch (err) {
      log(`Error en ciclo daemon: ${err.message || String(err)}`, 'ERROR');
      await sleep(RETRY_SECONDS * 1000);
    }
  }
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
