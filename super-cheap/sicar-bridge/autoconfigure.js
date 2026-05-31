#!/usr/bin/env node
/*
   SUPER CHEAP - SICAR local autoconfig

   Runs only on the SICAR computer. It uses SICAR's local OSSEV environment
   value to decrypt the local database properties, updates config.json, and
   writes a discovery log without printing secrets.
*/

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DB_PATH = path.join(ROOT, 'db.txt');
const JASYPT_SCRIPT = path.join(ROOT, 'descifrar-jasypt.js');
const EMBEDDED_BTE_KEY = 'OcSO8fv1CqVvXkKPPXwCk4A/ABYXjTUu';

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function log(message, level = 'INFO') {
  ensureLogDir();
  const line = `[${stamp()}] [${level}] ${message}`;
  fs.appendFileSync(path.join(LOG_DIR, `autoconfigure-${new Date().toISOString().slice(0, 10)}.log`), line + '\n', 'utf8');
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const examplePath = path.join(ROOT, 'config.example.json');
  if (fs.existsSync(examplePath)) return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  return {};
}

function decryptJasypt(cipherText, password) {
  const res = spawnSync(process.execPath, [JASYPT_SCRIPT, String(cipherText || '').trim(), password], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const direct = /DESCIFRADA:\s*([\s\S]*?)\s*(?:\r?\n|$)/i.exec(out);
  if (direct) return direct[1].trim();
  const revisar = /Resultado \(revisar\):\s*("[\s\S]*?")\s*(?:\r?\n|$)/i.exec(out);
  if (revisar) return JSON.parse(revisar[1]);
  throw new Error('No pude descifrar bloque Jasypt.');
}

function parseProperties(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const m = /^([^:=\s]+)\s*[:=]\s*(.*)$/.exec(line);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function decryptAesSha1Ecb(cipherText, secret) {
  if (!cipherText) return '';
  try {
    const key = crypto.createHash('sha1').update(secret, 'utf8').digest().slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    const out = Buffer.concat([
      decipher.update(Buffer.from(String(cipherText).trim(), 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return /^[\x20-\x7E]{0,128}$/.test(out) ? out : '';
  } catch (err) {
    return '';
  }
}

function parseJdbcUrl(url) {
  const clean = String(url || '').trim();
  let m = /host=([^)]+)\)\(port=(\d+)\)\/([^?;&]+)/i.exec(clean);
  if (m) return { host: m[1], port: Number(m[2]) || 3306, database: m[3] };

  m = /^jdbc:mysql:\/\/([^:/?)]+)(?::(\d+))?\/([^?;&]+)/i.exec(clean);
  if (m) return { host: m[1], port: Number(m[2]) || 3306, database: m[3] };

  return { host: '127.0.0.1', port: 3306, database: 'sicar' };
}

function runDiscovery() {
  return new Promise((resolve) => {
    const outFile = path.join(LOG_DIR, `discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    const out = fs.createWriteStream(outFile, { flags: 'a' });
    const child = spawn(process.execPath, ['descubrir.js'], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.once('error', (err) => {
      log(`No pude iniciar descubrir.js: ${err.message}`, 'ERROR');
      out.end();
      resolve({ ok: false, outFile });
    });
    child.once('close', (code) => {
      log(`descubrir.js termino con codigo ${code}. Log: ${outFile}`);
      out.end();
      resolve({ ok: code === 0, outFile });
    });
  });
}

async function main() {
  log('Iniciando autoconfiguracion SICAR.');
  const ossev = process.env.OSSEV;
  if (!ossev) throw new Error('OSSEV no esta disponible en este usuario de Windows.');
  if (!fs.existsSync(DB_PATH)) throw new Error('No encontre db.txt junto al puente.');

  const stagePassword = decryptJasypt(EMBEDDED_BTE_KEY, ossev);
  if (!/^[\x20-\x7E]{1,128}$/.test(stagePassword)) {
    throw new Error('No pude derivar la clave local de SICAR.');
  }

  const propsText = decryptJasypt(fs.readFileSync(DB_PATH, 'utf8').trim(), stagePassword);
  if (!/javax\.persistence\.jdbc/i.test(propsText)) {
    throw new Error('La configuracion descifrada no parece sicardb.properties.');
  }

  const props = parseProperties(propsText);
  const jdbc = parseJdbcUrl(props['javax.persistence.jdbc.url']);
  const user = props['javax.persistence.jdbc.user']
    || props['javax.persistence.jdbc.username']
    || 'root';
  const rawPassword = props['javax.persistence.jdbc.password'] || '';
  const aesPassword = decryptAesSha1Ecb(rawPassword, 'zaq=wsx');
  const password = aesPassword || (rawPassword === 'javac' ? '' : rawPassword);

  const cfg = loadConfig();
  cfg.mysql = {
    ...(cfg.mysql || {}),
    host: jdbc.host || '127.0.0.1',
    port: jdbc.port || 3306,
    user,
    password,
    database: jdbc.database || 'sicar',
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  log(`config.json actualizado: host=${cfg.mysql.host}, port=${cfg.mysql.port}, database=${cfg.mysql.database}, user=${cfg.mysql.user}, password=${password ? 'presente' : 'vacia'}.`);

  await runDiscovery();
  log('Autoconfiguracion terminada.');
}

main().catch((err) => {
  log(`Autoconfiguracion fallo: ${err.message || String(err)}`, 'ERROR');
  process.exit(1);
});
