/* Descifra la contraseña de SICAR cifrada con Jasypt (PBEWithMD5AndDES).
 *
 * SICAR (CheckVersion) usa org.jasypt.util.text.BasicTextEncryptor con la
 * contraseña maestra "zaq=wsx". El texto cifrado viene en Base64 y su formato
 * Jasypt clásico es: [salt(8 bytes)][cuerpo cifrado DES-CBC].
 *
 * Derivación PBE (PKCS#5 v1.5, PBKDF1 con MD5, 1000 iteraciones):
 *   DK = MD5^1000( password_bytes || salt )   (16 bytes)
 *   key = DK[0..8]   iv = DK[8..16]
 *
 * Uso:  node descifrar-jasypt.js "<password_cifrado_base64>" [clave_maestra]
 *       (clave por defecto: zaq=wsx)
 *
 * Compatible con Node aunque DES esté deshabilitado: implementa DES en JS puro
 * como respaldo si crypto no expone des-cbc.
 */
'use strict';
const crypto = require('crypto');

const cifradoB64 = process.argv[2];
const PASSWORD = process.argv[3] || 'zaq=wsx';
if (!cifradoB64) { console.error('Uso: node descifrar-jasypt.js "<cifrado_base64>" [clave]'); process.exit(1); }

const ITER = 1000;

function md5(buf) { return crypto.createHash('md5').update(buf).digest(); }

// Deriva key+iv estilo PBEWithMD5AndDES (PBKDF1).
function deriveKeyIv(passBytes, salt) {
  let dk = Buffer.concat([passBytes, salt]);
  for (let i = 0; i < ITER; i++) dk = md5(dk);
  return { key: dk.slice(0, 8), iv: dk.slice(8, 16) };
}

// --- DES en JS puro (respaldo si OpenSSL bloquea des-cbc) -------------------
// Implementación compacta de DES (ECB) para descifrar un bloque de 8 bytes.
const PC1=[57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const PC2=[14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS=[1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const IP=[58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const FP=[40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const E=[32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const P=[16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const S=[[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]];
function bytesToBits(b){const o=[];for(const x of b)for(let i=7;i>=0;i--)o.push((x>>i)&1);return o;}
function bitsToBytes(bits){const o=Buffer.alloc(bits.length/8);for(let i=0;i<o.length;i++){let v=0;for(let j=0;j<8;j++)v=(v<<1)|bits[i*8+j];o[i]=v;}return o;}
function permute(bits,table){return table.map(i=>bits[i-1]);}
function genKeys(keyBits){const k=permute(keyBits,PC1);let C=k.slice(0,28),D=k.slice(28,56);const ks=[];for(let i=0;i<16;i++){for(let s=0;s<SHIFTS[i];s++){C.push(C.shift());D.push(D.shift());}ks.push(permute(C.concat(D),PC2));}return ks;}
function feistel(R,k){const e=permute(R,E);const x=e.map((b,i)=>b^k[i]);let out=[];for(let i=0;i<8;i++){const six=x.slice(i*6,i*6+6);const row=(six[0]<<1)|six[5];const col=(six[1]<<3)|(six[2]<<2)|(six[3]<<1)|six[4];const val=S[i][row*16+col];for(let j=3;j>=0;j--)out.push((val>>j)&1);}return permute(out,P);}
function desBlock(blockBits,ks){let bits=permute(blockBits,IP);let L=bits.slice(0,32),R=bits.slice(32,64);for(let i=0;i<16;i++){const f=feistel(R,ks[i]);const nR=L.map((b,j)=>b^f[j]);L=R;R=nR;}return permute(R.concat(L),FP);}
function desDecryptBlock(block8,key8){const ks=genKeys(bytesToBits(key8)).reverse();return bitsToBytes(desBlock(bytesToBits(block8),ks));}
function desCbcDecrypt(data,key,iv){const out=Buffer.alloc(data.length);let prev=Buffer.from(iv);for(let i=0;i<data.length;i+=8){const block=data.slice(i,i+8);const dec=desDecryptBlock(block,key);for(let j=0;j<8;j++)out[i+j]=dec[j]^prev[j];prev=Buffer.from(block);}return out;}
function pkcs5strip(buf){const pad=buf[buf.length-1];if(pad<1||pad>8)return buf;return buf.slice(0,buf.length-pad);}
// ---------------------------------------------------------------------------

function tryOpenSSL(key,iv,body){
  try{
    const d=crypto.createDecipheriv('des-cbc',key,iv);
    return Buffer.concat([d.update(body),d.final()]);
  }catch(e){ return null; }
}

function descifrar(b64, pass) {
  const all = Buffer.from(b64, 'base64');
  const salt = all.slice(0, 8);
  const body = all.slice(8);
  const passBytes = Buffer.from(pass, 'utf8');
  const { key, iv } = deriveKeyIv(passBytes, salt);
  let out = tryOpenSSL(key, iv, body);
  if (!out) {
    // Respaldo: DES en JS puro.
    out = pkcs5strip(desCbcDecrypt(body, key, iv));
  }
  const txt = out.toString('utf8');
  return txt;
}

try {
  const r = descifrar(cifradoB64, PASSWORD);
  if (/^[\x20-\x7E]{1,128}$/.test(r)) {
    console.log('\n  ✅ CONTRASEÑA DESCIFRADA: ' + r + '\n');
  } else {
    console.log('\n  Resultado (revisar): ' + JSON.stringify(r) + '\n');
    console.log('  Si se ve raro, prueba con otra clave: node descifrar-jasypt.js "<cifrado>" otraClave');
  }
} catch (e) {
  console.error('  Error: ' + e.message);
  console.log('  Prueba otra clave maestra. Vista en el código: zaq=wsx');
}
