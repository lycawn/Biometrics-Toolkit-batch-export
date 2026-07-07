// Self-contained SVG chart builder for the per-repetition range-of-motion
// visualization (preceding DF → peak PF, in degrees). No charting library —
// plain SVG string generation, reused by the batch-analyzer modal, the
// standalone HTML report export, and (rasterized to PNG) the Excel export.

// Single-series mark color: validated against the app's dark chart surface
// (#131C24) — contrast >= 3:1, lightness/chroma within the sequential band.
const MARK_COLOR = "#3A9ED4";
const AXIS_COLOR = "#5C7A90";
const GRID_COLOR = "#233040";
const TEXT_COLOR = "#C8DFF0";

function niceStep(roughStep) {
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / pow10;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * pow10;
}

function buildTicks(min, max, targetCount = 5) {
  const range = max - min || 1;
  const step = niceStep(range / targetCount);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = start; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  if (min <= 0 && max >= 0 && !ticks.includes(0)) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Builds one chart for one file's repetitions: a floating bar per
// repetition spanning [precedingDF, peak] on a single degrees axis.
export function buildPeaksChart(rows) {
  const points = rows.filter(
    (r) => !r.error && r.peak !== null && r.precedingDF !== null
  );
  if (!points.length) return null;

  const barW = Math.max(6, Math.min(24, Math.floor(640 / points.length)));
  const gap = 4;
  const slot = barW + gap;
  const marginLeft = 42, marginRight = 12, marginTop = 18, marginBottom = 22;
  const plotWidth = points.length * slot;
  const plotHeight = 160;
  const width = plotWidth + marginLeft + marginRight;
  const height = plotHeight + marginTop + marginBottom;

  const rawMin = Math.min(0, ...points.map((p) => p.precedingDF));
  const rawMax = Math.max(0, ...points.map((p) => p.peak));
  const pad = (rawMax - rawMin) * 0.12 || 1;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const yScale = (v) => marginTop + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;
  const ticks = buildTicks(yMin, yMax);
  const zeroY = yScale(0);

  const gridLines = ticks
    .map((t) => {
      const y = yScale(t).toFixed(1);
      return `
      <line x1="${marginLeft}" y1="${y}" x2="${(marginLeft + plotWidth).toFixed(1)}" y2="${y}"
        stroke="${GRID_COLOR}" stroke-width="1" />
      <text x="${marginLeft - 6}" y="${(yScale(t) + 3).toFixed(1)}" text-anchor="end"
        font-size="9" font-family="Courier New, monospace" fill="${AXIS_COLOR}">${t}°</text>`;
    })
    .join("");

  let maxIdx = 0;
  points.forEach((p, i) => { if (p.peak > points[maxIdx].peak) maxIdx = i; });

  const bars = points
    .map((p, i) => {
      const x = marginLeft + i * slot + gap / 2;
      const yTop = yScale(p.peak);
      const yBottom = yScale(p.precedingDF);
      const top = Math.min(yTop, yBottom);
      const h = Math.max(2, Math.abs(yBottom - yTop));
      const label =
        i === maxIdx
          ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(yTop - 6).toFixed(1)}" text-anchor="middle"
               font-size="9" font-family="Courier New, monospace" fill="${TEXT_COLOR}">${p.peak.toFixed(1)}°</text>`
          : "";
      return `
        <g class="biob-bar" tabindex="0"
          data-rep="${esc(p.measurement)}" data-df="${p.precedingDF.toFixed(2)}"
          data-pf="${p.peak.toFixed(2)}" data-exc="${p.excursion.toFixed(2)}">
          <rect x="${(x - 2).toFixed(1)}" y="${marginTop}" width="${barW + 4}" height="${plotHeight}"
            fill="transparent" />
          <rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}"
            rx="3" fill="${MARK_COLOR}" />
          ${label}
        </g>`;
    })
    .join("");

  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
      aria-label="Εύρος κίνησης (preceding DF έως peak PF) ανά επανάληψη, σε μοίρες"
      xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <line x1="${marginLeft}" y1="${zeroY.toFixed(1)}" x2="${(marginLeft + plotWidth).toFixed(1)}" y2="${zeroY.toFixed(1)}"
        stroke="${AXIS_COLOR}" stroke-width="1" />
      ${bars}
    </svg>`;

  return { svg, width, height };
}

// Groups already-computed rows by source file, preserving first-seen order.
export function groupRowsByFile(rows) {
  const order = [];
  const byFile = new Map();
  for (const r of rows) {
    if (!byFile.has(r.file)) {
      byFile.set(r.file, []);
      order.push(r.file);
    }
    byFile.get(r.file).push(r);
  }
  return order.map((file) => ({ file, rows: byFile.get(file) }));
}

// Attaches a lightweight hover/focus tooltip to every ".biob-bar" mark
// inside `container`. `tooltipEl` is a positioned element reused across bars.
export function attachChartTooltips(container, tooltipEl) {
  const bars = container.querySelectorAll(".biob-bar");

  const show = (bar, clientX, clientY) => {
    const rep = bar.dataset.rep;
    const df = bar.dataset.df;
    const pf = bar.dataset.pf;
    const exc = bar.dataset.exc;

    tooltipEl.innerHTML = "";
    const line1 = document.createElement("div");
    line1.className = "biob-tip-strong";
    line1.textContent = `PF ${pf}°`;
    const line2 = document.createElement("div");
    line2.textContent = `DF ${df}° · εύρος ${exc}° · rep ${rep}`;
    tooltipEl.append(line1, line2);

    tooltipEl.style.display = "block";
    tooltipEl.style.left = `${clientX + 14}px`;
    tooltipEl.style.top = `${clientY + 14}px`;
  };

  const hide = () => { tooltipEl.style.display = "none"; };

  bars.forEach((bar) => {
    bar.addEventListener("pointermove", (e) => show(bar, e.clientX, e.clientY));
    bar.addEventListener("pointerenter", (e) => show(bar, e.clientX, e.clientY));
    bar.addEventListener("pointerleave", hide);
    bar.addEventListener("focus", () => {
      const rect = bar.getBoundingClientRect();
      show(bar, rect.left, rect.top);
    });
    bar.addEventListener("blur", hide);
  });
}

// Rasterizes an SVG string to a PNG data URL (for embedding in the .xlsx
// export, since Excel worksheets can't reference live SVG markup).
export function svgToPngDataUrl(svg, width, height, background = "#131C24", scale = 2) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
