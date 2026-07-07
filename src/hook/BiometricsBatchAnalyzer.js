import { processFileBuffer, sortRows, rowsToCsv } from "./biometricsCore.js";
import {
  buildPeaksChart,
  groupRowsByFile,
  attachChartTooltips,
  svgToPngDataUrl,
} from "./biometricsChart.js";

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

function buildChartsSection(rows) {
  const groups = groupRowsByFile(rows);
  const panels = groups
    .map(({ file, rows: fileRows }) => {
      const chart = buildPeaksChart(fileRows);
      if (!chart) return "";
      const first = fileRows[0];
      return `
        <div class="biob-chart-card">
          <div class="biob-chart-head">
            <span class="biob-chart-title">Συμμετέχων ${esc(first.participant)} · Πρωτόκολλο ${esc(first.protocol)}</span>
            <span class="biob-chart-file" title="${esc(file)}">${esc(file)}</span>
          </div>
          <div class="biob-chart-scroll">${chart.svg}</div>
        </div>`;
    })
    .join("");

  if (!panels) return "";
  return `<div class="biob-charts">${panels}</div>`;
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
            <button id="biob-export-html">Export HTML Report</button>
            <button id="biob-export-xlsx">Export Excel</button>
          </div>
          ${buildChartsSection(rows)}
          ${buildTable(rows)}
        </div>
      </div>
      <div class="biob-tooltip" id="biob-tooltip"></div>
    </div>`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
.biob-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);
  display:flex;align-items:center;justify-content:center;padding:12px;
  backdrop-filter:blur(6px);}
.biob-modal{background:#131C24;border:1px solid #233040;border-radius:4px;
  width:100%;max-width:960px;max-height:92vh;display:flex;flex-direction:column;
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
.biob-actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
.biob-actions button{background:#0B0F13;border:1px solid #233040;color:#C8DFF0;
  font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:.08em;
  padding:7px 14px;border-radius:3px;cursor:pointer;transition:border-color .14s,color .14s;}
.biob-actions button:hover{border-color:#3A9ED4;color:#3A9ED4;}
.biob-actions button:disabled{opacity:.5;cursor:wait;}
.biob-charts{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;}
.biob-chart-card{border:1px solid #233040;border-radius:3px;background:#0B0F13;padding:12px 14px 8px;}
.biob-chart-head{display:flex;align-items:baseline;justify-content:space-between;
  gap:10px;margin-bottom:6px;flex-wrap:wrap;}
.biob-chart-title{font-size:12px;font-weight:600;color:#C8DFF0;}
.biob-chart-file{font-family:'Courier New',Courier,monospace;font-size:9px;color:#5C7A90;}
.biob-chart-scroll{overflow-x:auto;}
.biob-chart-scroll svg{display:block;}
.biob-bar{cursor:pointer;}
.biob-bar:focus-visible rect{outline:2px solid #3A9ED4;outline-offset:1px;}
.biob-tooltip{position:fixed;display:none;pointer-events:none;z-index:10000;
  background:#0B0F13;border:1px solid #233040;border-radius:3px;padding:6px 9px;
  font-family:'Courier New',Courier,monospace;font-size:10px;color:#C8DFF0;
  line-height:1.5;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.4);}
.biob-tip-strong{font-size:12px;font-weight:600;color:#3A9ED4;}
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

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(rows) {
  downloadBlob(rowsToCsv(rows), "text/csv;charset=utf-8;", "biometrics_peaks.csv");
}

// ── HTML report export (self-contained, no dependencies) ───────────────────

function buildStandaloneReportHtml(rows) {
  return `<!doctype html>
<html lang="el"><head><meta charset="utf-8">
<title>Biometrics · Batch Peak Report</title>
<style>${CSS}
body{margin:0;background:#0B0F13;padding:24px;font-family:system-ui,sans-serif;}
.biob-page{max-width:960px;margin:0 auto;background:#131C24;border:1px solid #233040;
  border-radius:4px;padding:22px;}
</style></head>
<body>
  <div class="biob-page">
    <div class="biob-modal-title">BIOMETRICS · BATCH PEAK EXTRACTION</div>
    <div class="biob-modal-sub" style="margin-bottom:18px;">${rows.length} γραμμές · εξήχθη ${new Date().toLocaleString("el-GR")}</div>
    ${buildChartsSection(rows)}
    ${buildTable(rows)}
  </div>
  <div class="biob-tooltip" id="biob-tooltip"></div>
  <script>
    (${attachChartTooltips.toString()})(document, document.getElementById("biob-tooltip"));
  </script>
</body></html>`;
}

function downloadHtmlReport(rows) {
  downloadBlob(buildStandaloneReportHtml(rows), "text/html;charset=utf-8;", "biometrics_peaks_report.html");
}

// ── Excel export (data + embedded chart images) ─────────────────────────────

async function downloadXlsx(rows, button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Εξαγωγή…";

  try {
    const mod = await import("exceljs");
    const ExcelJS = mod.default ?? mod;
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet("Peaks");
    sheet.columns = [
      { header: "Συμμετέχων", key: "participant", width: 12 },
      { header: "Πρωτόκολλο", key: "protocol", width: 12 },
      { header: "Μέτρηση", key: "measurement", width: 10 },
      { header: "Preceding DF (°)", key: "precedingDF", width: 16 },
      { header: "Peak PF (°)", key: "peak", width: 14 },
      { header: "Εύρος DF→PF (°)", key: "excursion", width: 16 },
      { header: "Αρχείο", key: "file", width: 28 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const r of rows) {
      sheet.addRow({
        participant: r.participant,
        protocol: r.protocol,
        measurement: r.measurement,
        precedingDF: r.precedingDF === null ? "" : Number(r.precedingDF.toFixed(2)),
        peak: r.error ? r.error : Number(r.peak.toFixed(2)),
        excursion: r.excursion === null ? "" : Number(r.excursion.toFixed(2)),
        file: r.file,
      });
    }

    const chartSheet = workbook.addWorksheet("Charts");
    const groups = groupRowsByFile(rows);
    let rowCursor = 1;

    for (const { file, rows: fileRows } of groups) {
      const chart = buildPeaksChart(fileRows);
      if (!chart) continue;

      chartSheet.getCell(`A${rowCursor}`).value = file;
      chartSheet.getCell(`A${rowCursor}`).font = { bold: true };
      rowCursor += 1;

      const pngDataUrl = await svgToPngDataUrl(chart.svg, chart.width, chart.height);
      const imageId = workbook.addImage({
        base64: pngDataUrl.split(",")[1],
        extension: "png",
      });

      const displayWidth = Math.min(chart.width, 900);
      const displayHeight = (chart.height / chart.width) * displayWidth;
      chartSheet.addImage(imageId, {
        tl: { col: 0, row: rowCursor - 1 },
        ext: { width: displayWidth, height: displayHeight },
      });

      rowCursor += Math.ceil(displayHeight / 20) + 2;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "biometrics_peaks.xlsx"
    );
  } catch (err) {
    alert(`Αποτυχία εξαγωγής Excel: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
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
  document.getElementById("biob-export-html").addEventListener("click", () => downloadHtmlReport(rows));
  document.getElementById("biob-export-xlsx").addEventListener("click", (e) => downloadXlsx(rows, e.currentTarget));

  attachChartTooltips(overlay, document.getElementById("biob-tooltip"));
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
