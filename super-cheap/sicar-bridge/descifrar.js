/* Descifra la contraseña de SICAR (AES/ECB/PKCS5, llave = SHA-1(semilla)[0..16]).
   Prueba una lista de semillas conocidas de SICAR contra el password cifrado.
   Uso:  node descifrar.js "<password_cifrado_base64>"
*/
'use strict';
const crypto = require('crypto');

const cifrado = process.argv[2];
if (!cifrado) { console.error('Uso: node descifrar.js "<password_cifrado>"'); process.exit(1); }

// Semillas candidatas (claves secretas internas tipicas de SICAR / apps Java).
const SEMILLAS = [
  'sicar', 'SICAR', 'Sicar', 'sicarkey', 'SicarKey', 'sicar2018', 'Sicar2018',
  'sicarmx', 'SICARMX', 'msmysql', 'mssicar', 'microsites', 'sicarpos',
  'clavesicar', 'SicarClave', 'sicar.mx', 'softwaresicar', 'sicarsoftware',
  'llavesicar', 'keysicar', 'sicar123', 'Sicar123', 'admin', 'sicaradmin',
  'PuntoDeVenta', 'puntodeventa', 'ventas', 'Ventas', 'sicar_aes', 'aessicar',
];

function descifrar(semilla, b64) {
  try {
    const key = crypto.createHash('sha1').update(semilla, 'utf8').digest().slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    let out = decipher.update(Buffer.from(b64, 'base64'));
    out = Buffer.concat([out, decipher.final()]);
    const txt = out.toString('utf8');
    // ¿Resultado imprimible/razonable como contraseña?
    if (/^[\x20-\x7E]{1,64}$/.test(txt)) return txt;
  } catch (e) {}
  return null;
}

console.log('Probando semillas contra el password cifrado...\n');
let encontrado = false;
for (const s of SEMILLAS) {
  const r = descifrar(s, cifrado);
  if (r) { console.log(`  [POSIBLE] semilla="${s}"  =>  contraseña="${r}"`); encontrado = true; }
}
if (!encontrado) {
  console.log('  Ninguna semilla conocida funcionó. Hay que decompilar AES.class para ver la semilla real.');
}
