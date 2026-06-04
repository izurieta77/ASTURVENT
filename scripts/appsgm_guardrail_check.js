#!/usr/bin/env node
/*
 * APP SGM guardrail check.
 *
 * This is intentionally static and non-destructive. It does not call Netlify,
 * Google Sheets, Apps Script, Drive, or production URLs. It catches the common
 * ways the monolithic app gets broken before a deploy:
 *   - invalid inline JavaScript
 *   - critical write/read tab drift
 *   - pending/confirmation/vale invariants
 *   - evidence rules such as TOLUT firma-only
 *   - Apps Script backend contract used by the frontend
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const paths = {
  index: path.join(ROOT, 'index.html'),
  appsScript: path.join(ROOT, 'apps_script', 'Codigo.gs'),
  authFn: path.join(ROOT, 'netlify', 'functions', 'auth.js'),
  iaFn: path.join(ROOT, 'netlify', 'functions', 'ia.js'),
  valesCsv: path.join(ROOT, 'Vales', 'DHAR_Junio_2026', 'Vales_Don_Harina_Junio_2026.csv'),
  valesPdf: path.join(ROOT, 'Vales', 'DHAR_Junio_2026', 'Vales_Don_Harina_Junio_2026.pdf'),
};

const results = [];

function add(kind, name, detail = '') {
  results.push({ kind, name, detail });
}

function pass(name, detail = '') { add('PASS', name, detail); }
function warn(name, detail = '') { add('WARN', name, detail); }
function fail(name, detail = '') { add('FAIL', name, detail); }

function assert(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function read(file) {
  if (!fs.existsSync(file)) {
    fail(`Missing file: ${path.relative(ROOT, file)}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function compileJavaScript(source, filename) {
  try {
    new vm.Script(source, { filename });
    pass(`Syntax OK: ${filename}`);
  } catch (err) {
    fail(`Syntax error: ${filename}`, err && err.message || String(err));
  }
}

function extractInlineScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function hashVale(folio, ts) {
  const str = `${folio}${ts}SGM2024MORGAN`;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).toUpperCase().padStart(6, '0');
}

function checkValesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    fail('Don Harina voucher CSV has rows');
    return;
  }
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ['folio', 'cliente', 'producto', 'hash', 'qrData', 'vigenciaInicio', 'vigenciaFin'];
  assert(required.every(k => idx[k] !== undefined), 'Don Harina voucher CSV required headers');

  const rows = lines.slice(1).map(parseCsvLine);
  const seen = new Set();
  const counts = {};
  let duplicate = '';
  let badHash = '';
  let badVigencia = '';
  rows.forEach((r, i) => {
    const folio = String(r[idx.folio] || '').trim();
    const product = String(r[idx.producto] || '').trim();
    const hash = String(r[idx.hash] || '').trim();
    const qrData = String(r[idx.qrData] || '').trim();
    const expectedHash = hashVale(folio, 1780466400000 + i);
    if (seen.has(folio)) duplicate = duplicate || folio;
    seen.add(folio);
    counts[product] = (counts[product] || 0) + 1;
    if (hash !== expectedHash) badHash = badHash || `${folio}: ${hash} != ${expectedHash}`;
    if (!qrData.endsWith(`|${hash}`)) badHash = badHash || `${folio}: qrData/hash mismatch`;
    if (r[idx.vigenciaInicio] !== '2026-06-03' || r[idx.vigenciaFin] !== '2026-06-30') {
      badVigencia = badVigencia || folio;
    }
  });

  assert(rows.length === 77, 'Don Harina voucher count is 77', `actual=${rows.length}`);
  assert(!duplicate, 'Don Harina voucher folios are unique', duplicate);
  assert(counts.DIESEL === 30 && counts.EXTRA === 46 && counts['SUPREME+'] === 1,
    'Don Harina product counts match request',
    JSON.stringify(counts));
  assert(!badHash, 'Don Harina voucher hashes match printed QR payloads', badHash);
  assert(!badVigencia, 'Don Harina voucher validity is 2026-06-03 to 2026-06-30', badVigencia);
}

const index = read(paths.index);
const appsScript = read(paths.appsScript);

extractInlineScripts(index).forEach((script, i) => {
  compileJavaScript(script, `index.html:inline-script-${i + 1}.js`);
});
compileJavaScript(appsScript, 'apps_script/Codigo.gs');
compileJavaScript(read(paths.authFn), 'netlify/functions/auth.js');
compileJavaScript(read(paths.iaFn), 'netlify/functions/ia.js');

assert(/const\s+APP_WRITE_TAB\s*=\s*['"]Despachos_SGM_APP['"]/.test(index),
  'Frontend writes to Despachos_SGM_APP');
assert(/READ_TABS_PRIORITY\s*=\s*\[[^\]]*Despachos_SGM_APP[^\]]*Despachos_SGM/s.test(index),
  'Frontend read priority includes APP and legacy tabs');
assert(/HISTORICO_CONSOLIDADO_SHEET_ID:\s*['"]1TvL0tEzlTpTYOPXLNO0B-NWMftYb2inHcmCTtRJ1zQQ['"]/.test(index),
  'Frontend uses configured historical consolidated spreadsheet');
assert(/usarHistoricoConsolidado[\s\S]{0,260}tabs\s*=\s*tabs\.filter\(t\s*=>\s*t\s*===\s*APP_WRITE_TAB\)/.test(index),
  'When historical consolidated is active, frontend reads only APP tab from client sheets');
assert(/async\s+function\s+writeToSheet/.test(index) && /mode:\s*['"]no-cors['"]/.test(index),
  'Mobile write path remains no-cors simple POST');
assert(/confirmWriteViaBackendDiag_/.test(index) && /lastAppend/.test(index),
  'Frontend can use backend diag lastAppend confirmation');
assert(/if\s*\(\s*writeResult\?\.\s*confirmed\s*\)[\s\S]{0,500}marcarValeUsado_/.test(index),
  'Vouchers are consumed only after confirmed cloud write');
assert(/!r\._pending/.test(index),
  'Pending local records do not count as used vouchers');
assert(/FIRMA_ONLY_EVIDENCE_PREFIXES\s*=\s*new\s+Set\(\s*\[\s*['"]TOLUT['"]\s*\]\s*\)/.test(index),
  'TOLUT is firma-only for evidence requirements');
assert(/evidenceMissingLabels_\(urls,\s*isDEH,\s*pendingPref\)/.test(index),
  'Pending sync uses prefix-aware evidence requirements');
assert(/evidenceMissingLabels_\(uploadedEvidence,\s*isDEH,\s*prefActual\)/.test(index),
  'New dispatch save uses prefix-aware evidence requirements');

assert(/var\s+WRITE_TAB_NAME\s*=\s*['"]Despachos_SGM_APP['"]/.test(appsScript),
  'Apps Script writes to Despachos_SGM_APP');
assert(/LAST_APPEND_PROP_KEY/.test(appsScript) && /function\s+rememberLastAppend_/.test(appsScript) && /lastAppend:\s*loadLastAppend_\(\)/.test(appsScript),
  'Apps Script exposes lastAppend through diag');
assert(/function\s+isDuplicateById_/.test(appsScript) && /normalizeKey_\(headers\[i\]\)\s*===\s*['"]idregistro['"]/.test(appsScript),
  'Apps Script duplicate detection uses ID_REGISTRO header');
assert(/https:\/\/drive\.google\.com\/file\/d\/.+\/view/.test(appsScript),
  'Apps Script returns stable Drive viewer links');

if (fs.existsSync(paths.valesPdf)) {
  const size = fs.statSync(paths.valesPdf).size;
  assert(size > 100000, 'Don Harina voucher PDF exists and is printable-sized', `bytes=${size}`);
} else {
  fail('Don Harina voucher PDF exists');
}
if (fs.existsSync(paths.valesCsv)) checkValesCsv(read(paths.valesCsv));
else fail('Don Harina voucher CSV exists');

if (!/consolidarTorreDeControl/.test(appsScript) && !/consolidarTorreDeControl/.test(index)) {
  warn('consolidarTorreDeControl is not versioned in APPsgm local files',
    'The failing time-based trigger belongs to an external/unversioned Apps Script file.');
}

const failures = results.filter(r => r.kind === 'FAIL');
const warnings = results.filter(r => r.kind === 'WARN');

for (const r of results) {
  const extra = r.detail ? ` :: ${r.detail}` : '';
  console.log(`[${r.kind}] ${r.name}${extra}`);
}
console.log(`\nSummary: ${results.length - failures.length - warnings.length} pass, ${warnings.length} warn, ${failures.length} fail`);

if (failures.length) process.exit(1);
