const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const OUT_DIR = __dirname;
const PDF_PATH = path.join(OUT_DIR, 'Vales_Don_Harina_Junio_2026.pdf');
const CSV_PATH = path.join(OUT_DIR, 'Vales_Don_Harina_Junio_2026.csv');

const VALE_SECRET = ['SGM', '2024', 'MORGAN'].join('');

function hashVale(folio, ts) {
  const str = folio + ts + VALE_SECRET;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).toUpperCase().padStart(6, '0');
}

function buildVales() {
  const out = [];
  const prefix = 'DHAR';
  const cliente = 'DON HARINA / WAWITA';
  const lote = 'DHAR-JUNIO-2026';
  const vigenciaInicio = '2026-06-03';
  const vigenciaFin = '2026-06-30';
  const baseTs = 1780466400000;
  const defs = [
    { producto: 'DIESEL', serie: 'D', total: 30, etiqueta: 'DIESEL UBA' },
    { producto: 'EXTRA', serie: 'E', total: 46, etiqueta: 'EXTRA' },
    { producto: 'SUPREME+', serie: 'S', total: 1, etiqueta: 'SUPREME+' },
  ];
  let idx = 0;
  for (const def of defs) {
    for (let n = 1; n <= def.total; n++) {
      const folio = `${prefix}-JUN26-${def.serie}${String(n).padStart(3, '0')}`;
      const ts = baseTs + idx;
      const hash = hashVale(folio, ts);
      const qrData = `${folio}|${cliente}|${def.producto}|${hash}`;
      out.push({
        folio,
        prefix,
        cliente,
        producto: def.producto,
        etiqueta: def.etiqueta,
        hash,
        ts,
        qrData,
        vigenciaInicio,
        vigenciaFin,
        lote,
      });
      idx++;
    }
  }
  return out;
}

function productColor(producto) {
  if (producto === 'DIESEL') return '#0057B8';
  if (producto === 'EXTRA') return '#00A651';
  return '#D99700';
}

function drawVale(doc, vale, x, y, w, h, qrDataUrl) {
  const c = productColor(vale.producto);
  doc.roundedRect(x, y, w, h, 8).lineWidth(1.2).stroke('#D9DEE8');
  doc.rect(x, y, 7, h).fill(c);
  doc.fillColor('#101827').font('Helvetica-Bold').fontSize(8).text('SGM METEPEC - VALE DE COMBUSTIBLE', x + 18, y + 12, { width: w - 36 });
  doc.fillColor(c).font('Helvetica-Bold').fontSize(15.2).text(vale.folio, x + 18, y + 31, { width: w - 126, lineBreak: false });
  doc.fillColor('#101827').font('Helvetica-Bold').fontSize(10).text(vale.etiqueta, x + 18, y + 54, { width: w - 130, lineBreak: false });
  doc.fillColor('#536173').font('Helvetica').fontSize(8).text('Cliente', x + 18, y + 78);
  doc.fillColor('#101827').font('Helvetica-Bold').fontSize(9).text(vale.cliente, x + 18, y + 90, { width: w - 140, lineBreak: false });
  doc.fillColor('#536173').font('Helvetica').fontSize(8).text('Vigencia', x + 18, y + 112);
  doc.fillColor('#101827').font('Helvetica-Bold').fontSize(8.8).text('03 JUN 2026 - 30 JUN 2026', x + 18, y + 124, { width: w - 140, lineBreak: false });
  doc.fillColor('#D91F2D').font('Helvetica-Bold').fontSize(8.5).text('SIN LIMITE DE CARGA', x + 18, y + 143, { width: w - 140, lineBreak: false });
  doc.image(qrDataUrl, x + w - 104, y + 24, { width: 80, height: 80 });
  doc.fillColor('#536173').font('Helvetica').fontSize(6.7).text(`Hash ${vale.hash}`, x + w - 104, y + 108, { width: 80, align: 'center' });
  doc.fillColor('#6B7280').font('Helvetica').fontSize(6.1).text('Escanear antes de cargar. Duplicado o vencido = no despachar.', x + 18, y + h - 15, { width: w - 36, lineBreak: false });
}

async function main() {
  const vales = buildVales();
  const qrImages = await Promise.all(vales.map(v => QRCode.toDataURL(v.qrData, {
    margin: 1,
    width: 220,
    errorCorrectionLevel: 'M',
  })));

  const doc = new PDFDocument({ size: 'LETTER', margin: 28, autoFirstPage: false });
  doc.pipe(fs.createWriteStream(PDF_PATH));

  const pageW = 612;
  const pageH = 792;
  const margin = 28;
  const gap = 12;
  const cardW = (pageW - margin * 2 - gap) / 2;
  const cardH = 168;
  const perPage = 8;

  for (let i = 0; i < vales.length; i++) {
    if (i % perPage === 0) {
      doc.addPage();
      doc.fillColor('#101827').font('Helvetica-Bold').fontSize(13).text('DON HARINA / WAWITA - LOTE DE VALES JUNIO 2026', margin, 18);
      doc.fillColor('#536173').font('Helvetica').fontSize(8).text('30 DIESEL UBA | 46 EXTRA | 1 SUPREME+ | Vigencia 03/06/2026 al 30/06/2026 | Sin limite', margin, 34);
    }
    const p = i % perPage;
    const col = p % 2;
    const row = Math.floor(p / 2);
    const x = margin + col * (cardW + gap);
    const y = 54 + row * (cardH + 10);
    drawVale(doc, vales[i], x, y, cardW, cardH, qrImages[i]);
  }

  doc.end();

  const csv = [
    'folio,cliente,producto,hash,qrData,vigenciaInicio,vigenciaFin,lote',
    ...vales.map(v => [v.folio, v.cliente, v.producto, v.hash, v.qrData, v.vigenciaInicio, v.vigenciaFin, v.lote].map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  fs.writeFileSync(CSV_PATH, csv, 'utf8');

  console.log(JSON.stringify({ pdf: PDF_PATH, csv: CSV_PATH, total: vales.length }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
