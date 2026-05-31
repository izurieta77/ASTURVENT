#!/usr/bin/env node
/* ============================================================
   SUPER CHEAP — Descubridor de la base de SICAR (descubrir.js)
   ------------------------------------------------------------
   Corre en la PC donde está instalado SICAR. NO modifica nada:
   solo SE ASOMA a la base de datos y te imprime un reporte con
   los nombres de bases, tablas y columnas de ventas, para que
   nos lo mandes y armemos la consulta correcta.

   Uso (en la carpeta sicar-bridge):
     node descubrir.js

   Lee la sección "mysql" de config.json (host, port, user,
   password). El campo "database" puede quedar como "auto" para
   que el descubridor busque la base de SICAR por su cuenta.

   Requiere Node 18+ y el paquete "mysql2".
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Palabras que delatan tablas/bases relacionadas con ventas en SICAR.
const PISTAS_VENTA = ['venta', 'ticket', 'corte', 'caja', 'nota', 'ingreso'];
const TABLAS_CLAVE = [
  'articulo',
  'codigo',
  'detallev',
  'detallevimpuesto',
  'detallevlote',
  'detallevpromo',
  'metodopago',
  'tipopago',
  'venta',
  'ventatipopago',
];
// Bases del sistema que ignoramos al buscar la de SICAR.
const BASES_SISTEMA = ['information_schema', 'mysql', 'performance_schema', 'sys', 'phpmyadmin'];

function cargarConfig() {
  const ruta = path.join(__dirname, 'config.json');
  if (!fs.existsSync(ruta)) {
    throw new Error(
      'No encontré config.json. Copia config.example.json a config.json y pon tus datos de MySQL.'
    );
  }
  const cfg = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (!cfg.mysql || !cfg.mysql.host) {
    throw new Error('Falta la sección "mysql" (host, user, password) en config.json.');
  }
  return cfg.mysql;
}

async function main() {
  console.log('==================================================');
  console.log(' SUPER CHEAP — Descubridor de la base de SICAR');
  console.log(' (solo lee; no cambia nada en tu SICAR)');
  console.log('==================================================\n');

  let my;
  try {
    my = cargarConfig();
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(1);
  }

  // Conectamos SIN base fija para poder listar todas las bases.
  let conn;
  try {
    console.log(`[INFO] Conectando a MySQL en ${my.host}:${my.port || 3306} (usuario "${my.user}")...`);
    conn = await mysql.createConnection({
      host: my.host,
      port: my.port || 3306,
      user: my.user,
      password: my.password,
      // sin "database" a propósito
    });
    console.log('[OK] Conexión establecida.\n');
  } catch (e) {
    console.error('[ERROR] No pude conectar a MySQL: ' + e.message);
    if (/access denied/i.test(e.message)) {
      console.error('        => Usuario o CONTRASEÑA incorrectos. En SICAR 4 el usuario suele ser "root".');
      console.error('           Si no sabes la contraseña, prueba dejarla vacía ("") en config.json,');
      console.error('           o pídela al soporte de SICAR. Mándame este mensaje si sigues atorado.');
    } else if (/ECONNREFUSED|connect/i.test(e.message)) {
      console.error('        => ¿Está encendido SICAR/MariaDB? Prueba con SICAR abierto. Puerto típico: 3306.');
    }
    process.exit(1);
  }

  // 1) Listar bases de datos candidatas.
  const [bases] = await conn.query('SHOW DATABASES');
  const nombresBases = bases.map((r) => Object.values(r)[0]).filter((n) => !BASES_SISTEMA.includes(n));
  console.log('--- BASES DE DATOS ENCONTRADAS ---');
  nombresBases.forEach((n) => console.log('   • ' + n));
  console.log('');

  // Elegimos la base de SICAR: la indicada en config (si no es "auto"),
  // o la que se llame "sicar", o la primera no-sistema.
  const cfgDb = (my.database && my.database !== 'auto') ? my.database : null;
  let dbSicar = cfgDb
    || nombresBases.find((n) => /sicar/i.test(n))
    || nombresBases.find((n) => !BASES_SISTEMA.includes(n));

  if (!dbSicar) {
    console.error('[ERROR] No identifiqué una base de SICAR. Mándame la lista de arriba.');
    await conn.end().catch(() => {});
    process.exit(1);
  }
  console.log(`[INFO] Voy a explorar la base: "${dbSicar}"\n`);

  // 2) Listar tablas y marcar las que parecen de ventas.
  const [tablas] = await conn.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
    [dbSicar]
  );
  const nombresTablas = tablas.map((r) => r.t);
  const candidatas = Array.from(new Set([
    ...nombresTablas.filter((t) => PISTAS_VENTA.some((p) => t.toLowerCase().includes(p))),
    ...TABLAS_CLAVE.filter((t) => nombresTablas.includes(t)),
  ])).sort((a, b) => a.localeCompare(b));

  console.log(`--- TABLAS EN "${dbSicar}" (${nombresTablas.length}) ---`);
  console.log('   ' + nombresTablas.join(', '));
  console.log('');
  console.log('--- TABLAS QUE PARECEN DE VENTAS ---');
  console.log('   ' + (candidatas.length ? candidatas.join(', ') : '(ninguna obvia)'));
  console.log('');

  // 3) Para cada tabla candidata: columnas + total de filas + 1 fila de ejemplo.
  for (const t of candidatas) {
    console.log(`================ TABLA: ${dbSicar}.${t} ================`);
    try {
      const [cols] = await conn.query(
        'SELECT column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
        [dbSicar, t]
      );
      console.log('  Columnas:');
      cols.forEach((c) => console.log(`    - ${c.c} (${c.d})`));

      const [cnt] = await conn.query(`SELECT COUNT(*) AS n FROM \`${dbSicar}\`.\`${t}\``);
      console.log(`  Total de filas: ${cnt[0].n}`);

      const [muestra] = await conn.query(`SELECT * FROM \`${dbSicar}\`.\`${t}\` ORDER BY 1 DESC LIMIT 1`);
      if (muestra.length) {
        // Imprimimos solo nombres de columna -> tipo de dato de la muestra, sin volcar datos sensibles enteros.
        console.log('  Ejemplo (1 fila más reciente):');
        console.log('    ' + JSON.stringify(muestra[0]));
      }
    } catch (e) {
      console.log('  [aviso] No pude leer esta tabla: ' + e.message);
    }
    console.log('');
  }

  await conn.end().catch(() => {});
  console.log('==================================================');
  console.log(' LISTO. Copia TODO este reporte y envíamelo.');
  console.log(' Con eso te armo la consulta de ventas exacta.');
  console.log('==================================================');
}

main().catch((e) => {
  console.error('[ERROR] Error inesperado: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
