import { processFileBuffer, sortRows, rowsToCsv } from "./biometricsCore.js";

// ── Per-file processing (browser: File API) ─────────────────────────────────

async function processFile(file) {
  const buf = await file.arrayBuffer();
  return processFileBuffer(file.name, buf);
}

// ── Render ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v) {
  return v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(2);
}

function buildTable(rows) {
  const body = rows
    .map(
      (r) => `
      <tr class="${r.error ? "biob-err" : ""}">
        <td>${esc(r.participant)}</td>
        <td>${esc(r.protocol)}</td>
        <td>${esc(r.measurement)}</td>
        <td>${r.error ? "" : fmt(r.precedingDF)}</td>
        <td>${r.error ? esc(r.error) : fmt(r.peak)}</td>
        <td>${r.error ? "" : fmt(r.excursion)}</td>
        <td class="biob-file" title="${esc(r.file)}">${esc(r.file)}</td>
      </tr>`
    )
    .join("");

  return `
    <table class="biob-table">
      <thead>
        <tr>
          <th>Συμμετέχων</th>
          <th>Πρωτόκολλο</th>
          <th>Μέτρηση</th>
          <th>Preceding DF (°)</th>
          <th>Peak PF (°)</th>
          <th>Εύρος DF→PF (°)</th>
          <th>Αρχείο</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function buildModal(rows) {
  return `
    <div class="biob-overlay" id="biob-overlay">
      <div class="biob-modal" role="dialog" aria-modal="true" aria-label="Biometrics batch peak analysis">
        <div class="biob-modal-head">
          <div>
            <div class="biob-modal-title">BIOMETRICS · BATCH PEAK EXTRACTION</div>
            <div class="biob-modal-sub">${rows.length} γραμμές</div>
          </div>
          <button class="biob-close" id="biob-close" aria-label="Close">&times;</button>
        </div>
        <div class="biob-modal-body">
          <div class="biob-actions">
            <button id="biob-export-csv">Export CSV</button>
          </div>
          ${buildTable(rows)}
        </div>
      </div>
    </div>`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
.biob-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);
  display:flex;align-items:center;justify-content:center;padding:12px;
  backdrop-filter:blur(6px);}
.biob-modal{background:#131C24;border:1px solid #233040;border-radius:4px;
  width:100%;max-width:920px;max-height:92vh;display:flex;flex-direction:column;
  overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5);}
.biob-modal-head{display:flex;align-items:flex-start;justify-content:space-between;
  padding:18px 22px 14px;border-bottom:1px solid #233040;flex-shrink:0;gap:12px;}
.biob-modal-title{font-family:'Courier New',Courier,monospace;font-size:10px;
  letter-spacing:.22em;text-transform:uppercase;color:#3A9ED4;margin-bottom:3px;}
.biob-modal-sub{font-size:12px;color:#5C7A90;}
.biob-close{background:none;border:1px solid #233040;color:#5C7A90;font-size:18px;
  line-height:1;cursor:pointer;width:30px;height:30px;border-radius:2px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  transition:border-color .14s,color .14s;}
.biob-close:hover{border-color:#CF4E68;color:#CF4E68;}
.biob-modal-body{overflow-y:auto;padding:18px 22px 22px;}
.biob-actions{display:flex;justify-content:flex-end;margin-bottom:12px;}
#biob-export-csv{background:#0B0F13;border:1px solid #233040;color:#C8DFF0;
  font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:.08em;
  padding:7px 14px;border-radius:3px;cursor:pointer;transition:border-color .14s,color .14s;}
#biob-export-csv:hover{border-color:#3A9ED4;color:#3A9ED4;}
.biob-table{width:100%;border-collapse:collapse;font-size:12px;}
.biob-table th,.biob-table td{padding:7px 10px;border-bottom:1px solid #233040;
  text-align:left;white-space:nowrap;}
.biob-table th{font-family:'Courier New',Courier,monospace;font-size:9px;
  letter-spacing:.15em;text-transform:uppercase;color:#5C7A90;}
.biob-table td{color:#C8DFF0;font-variant-numeric:tabular-nums;}
.biob-file{color:#5C7A90;font-size:10px;max-width:260px;overflow:hidden;
  text-overflow:ellipsis;}
.biob-err td{color:#CF4E68;}
`;

function injectStyles() {
  if (document.getElementById("biob-styles")) return;
  const el = document.createElement("style");
  el.id = "biob-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── CSV export ───────────────────────────────────────────────────────────────

function downloadCsv(rows) {
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "biometrics_peaks.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Modal lifecycle ──────────────────────────────────────────────────────────

function showModal(rows) {
  document.getElementById("biob-overlay")?.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildModal(rows);
  const overlay = wrapper.firstElementChild;
  document.body.appendChild(overlay);

  const close = () => document.getElementById("biob-overlay")?.remove();

  document.getElementById("biob-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    "keydown",
    (e) => { if (e.key === "Escape") close(); },
    { once: true }
  );

  document.getElementById("biob-export-csv").addEventListener("click", () => downloadCsv(rows));
}

// ── Public ───────────────────────────────────────────────────────────────────

export const openBiometricsBatchAnalyzer = () => {
  injectStyles();

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt";
  input.multiple = true;

  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const allRows = [];
    for (const file of files) {
      const rows = await processFile(file);
      allRows.push(...rows);
    }

    showModal(sortRows(allRows));
  });

  input.click();
};
