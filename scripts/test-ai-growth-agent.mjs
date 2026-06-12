#!/usr/bin/env node
// Test harness del AI Growth Agent.
//
// Uso:
//   node scripts/test-ai-growth-agent.mjs                      # contra http://localhost:8888 (netlify dev)
//   AGENT_URL=https://asturvent-web.netlify.app node scripts/test-ai-growth-agent.mjs
//   node scripts/test-ai-growth-agent.mjs --case asturvent_google_ads
//
// Valida el contrato de respuesta (campos, tipos, fases, guardrails) y
// reglas de calidad por negocio (no inventar precios, alineación de marca, CTA).

const BASE = process.env.AGENT_URL || "http://localhost:8888";
const ENDPOINT = `${BASE}/api/ai-growth-agent`;
const onlyCase = process.argv.includes("--case")
  ? process.argv[process.argv.indexOf("--case") + 1]
  : null;

const CASES = [
  {
    id: "asturvent_google_ads",
    payload: {
      business: "asturvent",
      task_type: "google_ads",
      user_instruction:
        "Campana de busqueda para ventanas PVC Kömmerling enfocada en aislamiento acustico, presupuesto inicial controlado.",
      optional_context: { zona: "CDMX y Estado de Mexico", presupuesto_mxn_dia: 350 },
      output_format: "json",
    },
    expect: (r) => [
      [r.business === "asturvent", "business eco"],
      [/kömmerling|kommerling/i.test(r.copy_ready), "copy menciona Kömmerling"],
      [!/garantía de \d|db garantizados/i.test(r.copy_ready), "no inventa garantías/valores"],
    ],
  },
  {
    id: "asturvent_quote_followup",
    payload: {
      business: "asturvent",
      task_type: "quote_followup",
      user_instruction:
        "Cliente pidio cotizacion de 6 ventanas hace 5 dias y no responde. Seguimiento amable por WhatsApp.",
      optional_context: { nombre_cliente: "Arq. Lopez", piezas: 6 },
      output_format: "json",
    },
    expect: (r) => [
      [r.copy_ready.length > 100, "copy con contenido real"],
      [Array.isArray(r.variants) && r.variants.length >= 2, ">=2 variantes"],
    ],
  },
  {
    id: "sgm_fleet_landing",
    payload: {
      business: "sgm",
      task_type: "landing",
      user_instruction:
        "Landing B2B para venta de diesel y gasolina a flotillas con facturacion y control de consumo.",
      optional_context: { zona: "Metepec y Toluca" },
      output_format: "json",
    },
    expect: (r) => [
      [/flotilla|diesel|facturaci/i.test(r.copy_ready), "copy habla de flotillas/diesel/facturacion"],
      [!/descuento del? \d+%/i.test(r.copy_ready), "no promete descuentos no autorizados"],
    ],
  },
  {
    id: "supercheap_promo",
    payload: {
      business: "supercheap",
      task_type: "promotion",
      user_instruction: "Promo diaria cafe chiapaneco + cuernito jamon y queso para pantalla y WhatsApp.",
      optional_context: { formato: "pantalla 1:1", precio: "editable" },
      output_format: "json",
    },
    expect: (r) => [
      [!/\$\d+(\.\d+)?(?!\s*\{)/.test(r.copy_ready) || /\[precio\]|\$__|editable/i.test(r.copy_ready), "no inventa precios fijos"],
    ],
  },
  {
    id: "validation_bad_business",
    payload: { business: "acme", task_type: "promotion", user_instruction: "x" },
    expectStatus: 400,
  },
  {
    id: "validation_missing_instruction",
    payload: { business: "asturvent", task_type: "promotion", user_instruction: "" },
    expectStatus: 400,
  },
];

const CONTRACT_FIELDS = [
  ["ok", "boolean"],
  ["mode", "string"],
  ["business", "string"],
  ["task_type", "string"],
  ["summary", "string"],
  ["recommendation", "string"],
  ["copy_ready", "string"],
];
const CONTRACT_ARRAYS = ["variants", "risks", "next_actions", "kpis", "ab_tests"];

function checkContract(r) {
  const errs = [];
  for (const [field, type] of CONTRACT_FIELDS) {
    if (typeof r[field] !== type) errs.push(`campo ${field}: esperado ${type}, recibido ${typeof r[field]}`);
  }
  for (const field of CONTRACT_ARRAYS) {
    if (!Array.isArray(r[field])) errs.push(`campo ${field}: esperado array`);
  }
  if (!r.diagnostics || typeof r.diagnostics !== "object") {
    errs.push("falta diagnostics");
  } else {
    if (!Array.isArray(r.diagnostics.phases) || r.diagnostics.phases.length < 4) {
      errs.push("diagnostics.phases debe tener >=4 fases del pipeline");
    }
    if (!Array.isArray(r.diagnostics.quality_checks)) errs.push("falta diagnostics.quality_checks");
  }
  return errs;
}

async function run() {
  console.log(`\nAI Growth Agent — tests contra ${ENDPOINT}\n`);
  let passed = 0, failed = 0;

  for (const tc of CASES) {
    if (onlyCase && tc.id !== onlyCase) continue;
    const started = Date.now();
    let res, body;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tc.payload),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      console.log(`✗ ${tc.id} — error de red: ${e.message}`);
      failed++;
      continue;
    }
    const ms = Date.now() - started;

    const errs = [];
    if (tc.expectStatus) {
      if (res.status !== tc.expectStatus) errs.push(`status ${res.status}, esperado ${tc.expectStatus}`);
    } else {
      if (!res.ok) errs.push(`HTTP ${res.status}: ${body.error || "?"}`);
      else {
        errs.push(...checkContract(body));
        if (tc.expect) {
          for (const [cond, label] of tc.expect(body)) {
            if (!cond) errs.push(`regla: ${label}`);
          }
        }
      }
    }

    if (errs.length === 0) {
      const mode = body.mode ? ` [${body.mode}${body.model ? ":" + body.model : ""}]` : "";
      console.log(`✓ ${tc.id}${mode} (${ms}ms)`);
      passed++;
    } else {
      console.log(`✗ ${tc.id} (${ms}ms)`);
      for (const e of errs) console.log(`    - ${e}`);
      failed++;
    }
  }

  console.log(`\nResultado: ${passed} ok, ${failed} fallos\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
