// ── Binary helpers ─────────────────────────────────────────────────────────────

function findSeq(haystack, needle, start = 0) {
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function latin1Slice(bytes, start, end) {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++)
    s += String.fromCharCode(bytes[i]);
  return s;
}

// ── Encoding detection ─────────────────────────────────────────────────────────

function detectEncoding(bytes) {
  // Explicit UTF-16 LE BOM: FF FE
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
    return { utf16le: true, bomLen: 2 };
  // UTF-16 LE without BOM: alternating ASCII / null bytes at the start
  if (bytes.length >= 4 &&
      bytes[1] === 0x00 && bytes[3] === 0x00 &&
      bytes[0] >= 0x20 && bytes[0] < 0x80 &&
      bytes[2] >= 0x20 && bytes[2] < 0x80)
    return { utf16le: true, bomLen: 0 };
  return { utf16le: false, bomLen: 0 };
}

// Build UTF-16 LE byte sequence for an ASCII string, then search for it
function findStrUtf16Le(haystack, str, start = 0) {
  const needle = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    needle[i * 2] = str.charCodeAt(i);
    needle[i * 2 + 1] = 0;
  }
  return findSeq(haystack, needle, start);
}

// ── Log parser ─────────────────────────────────────────────────────────────────

function parseLog(buf) {
  const bytes = new Uint8Array(buf);
  const { utf16le, bomLen } = detectEncoding(bytes);

  const MARKER = "WirelessDigitals=";
  let mPos = -1;
  let dataStart = 0;
  let headerText = "";

  if (utf16le) {
    mPos = findStrUtf16Le(bytes, MARKER, bomLen);

    if (mPos >= 0) {
      // Scan forward 2 bytes at a time for LF (0x0A 0x00) in UTF-16 LE
      let i = mPos + MARKER.length * 2;
      while (i + 1 < bytes.length) {
        if (bytes[i] === 0x0D && bytes[i + 1] === 0x00) { i += 2; continue; } // skip CR
        if (bytes[i] === 0x0A && bytes[i + 1] === 0x00) { dataStart = i + 2; break; }
        i += 2;
      }
      if (dataStart === 0) {
        // Fallback: bare LF without paired null
        let j = mPos + MARKER.length * 2;
        while (j < bytes.length && bytes[j] !== 0x0A) j++;
        dataStart = Math.min(j + 1, bytes.length);
      }
    }

    // Decode header portion as UTF-16 LE (parseHeader stops at WirelessDigitals= anyway)
    const hSlice = Math.min(
      mPos >= 0 ? mPos + MARKER.length * 2 + 512 : bytes.length,
      bytes.length
    );
    headerText = new TextDecoder("utf-16le").decode(bytes.slice(bomLen, hSlice));

  } else {
    // Latin-1 / raw binary header
    const marker = new TextEncoder().encode(MARKER);
    mPos = findSeq(bytes, marker);

    const hEnd = mPos >= 0
      ? Math.min(mPos + 256, bytes.length)
      : Math.min(8192, bytes.length);
    headerText = latin1Slice(bytes, 0, hEnd);

    if (mPos >= 0) {
      let i = mPos + marker.length;
      while (i < bytes.length && bytes[i] !== 0x0A) i++;
      dataStart = i + 1;
    }
  }

  const { channels, meta } = parseHeader(headerText);
  const analog = channels.filter((c) => c.id !== "D");
  const totalAvail = bytes.length - dataStart;
  const totalDeclared = analog.reduce((s, c) => s + c.sampleCount * c.bps, 0);
  const scale =
    totalDeclared > 0 && totalDeclared > totalAvail
      ? totalAvail / totalDeclared
      : 1;

  let offset = dataStart;
  for (const ch of analog) {
    const byteCount = Math.min(
      Math.floor(ch.sampleCount * scale) * ch.bps,
      bytes.length - offset
    );
    ch.stats = analyze(bytes, offset, byteCount, ch.bps, ch.gain, ch.fullScale);
    offset += byteCount;
  }

  return { channels: analog, meta };
}

function parseHeader(text) {
  const lines = text.split("\n");
  const channels = [];
  const meta = {};
  let last = null;

  for (const raw of lines) {
    const ln = raw.trim();
    if (ln.startsWith("Start=")) meta.start = ln.slice(6).trim();
    if (ln.startsWith("End=")) meta.end = ln.slice(4).trim();
    if (ln.startsWith("Recorded=")) meta.recorded = ln.slice(9).trim();

    const m = ln.match(/^Channel\s+(\w+)\s*=\s*(.*)$/);
    if (m) {
      const id = m[1];
      const parts = m[2].trim().split(/\s+/);
      const unit =
        parts.find((p) => /[°%a-zA-Z\/]/.test(p) && !/^-?\d+$/.test(p)) || "°";
      last = {
        id,
        title: `Channel ${id}`,
        sampleCount: parseInt(parts[0]) || 0,
        bps: parseInt(parts[1]) || 2,
        sampleRate: parseInt(parts[2]) || 100,
        fullScale: parseInt(parts[3]) || 1,
        gain: parseInt(parts[7]) || 1,
        unit,
        stats: null,
      };
      channels.push(last);
    }

    if (ln.startsWith("Title=") && last) {
      const t = ln.slice(6).trim();
      if (t) last.title = t;
    }

    if (ln.startsWith("WirelessDigitals=")) break;
  }

  return { channels, meta };
}

function analyze(bytes, start, byteCount, bps, gain, fullScale) {
  if (byteCount < bps) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, byteCount);
  const n = Math.floor(byteCount / bps);
  const scale = gain > 0 ? fullScale / gain : 1;

  let maxR = -Infinity, minR = Infinity, sumR = 0, sumSq = 0, maxI = 0;

  for (let i = 0; i < n; i++) {
    let r;
    if (bps === 2) r = view.getInt16(i * 2, true);
    else if (bps === 4) r = view.getInt32(i * 4, true);
    else r = view.getInt8(i);

    if (r > maxR) { maxR = r; maxI = i; }
    if (r < minR) minR = r;
    sumR += r;
    sumSq += r * r;
  }

  return {
    max: maxR * scale,
    min: minR * scale,
    mean: (sumR / n) * scale,
    rms: Math.sqrt(sumSq / n) * scale,
    peakToPeak: (maxR - minR) * scale,
    n,
    maxI,
  };
}

// ── Render ─────────────────────────────────────────────────────────────────────

const CH_COLORS = ["#3A9ED4", "#29C47E", "#D4943A", "#B46ED4", "#3AD4C4", "#D46E3A"];

function f(v, d = 2) {
  return v !== null && isFinite(v) ? v.toFixed(d) : "—";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function calcDuration(a, b) {
  try {
    const p = (s) => {
      const [dt, tm] = s.split(" ");
      const [mo, dy, yr] = dt.split("/");
      const [hh, mm, ss] = tm.split(":");
      return new Date(+yr, mo - 1, +dy, +hh, +mm, +ss);
    };
    const diff = (p(b) - p(a)) / 1000;
    const m = Math.floor(diff / 60), s = Math.round(diff % 60);
    return `${m}m ${String(s).padStart(2, "0")}s`;
  } catch {
    return null;
  }
}

function buildModal(filename, { channels, meta }) {
  const dur = meta.start && meta.end ? calcDuration(meta.start, meta.end) : null;

  const metaCells = [
    meta.start && ["START", meta.start],
    meta.end && ["END", meta.end],
    dur && ["DURATION", dur],
    channels.length && ["CHANNELS", channels.length],
  ]
    .filter(Boolean)
    .map(
      ([k, v]) => `
      <div class="bio-mc">
        <div class="bio-mk">${k}</div>
        <div class="bio-mv">${v}</div>
      </div>`
    )
    .join("");

  const cards = channels
    .map((ch, i) => {
      const color = CH_COLORS[i % CH_COLORS.length];
      const s = ch.stats;
      if (!s) return `
        <div class="bio-card" style="border-left-color:${color}">
          <div class="bio-ch-head">
            <span class="bio-badge">CH ${ch.id}</span>
            <span class="bio-ch-name">${esc(ch.title)}</span>
          </div>
          <p class="bio-nodata">No binary data found for this channel.</p>
        </div>`;

      const absExt = Math.max(Math.abs(s.max), Math.abs(s.min), 0.0001);
      const toX = (v) => ((v + absExt) / (absExt * 2)) * 100;
      const maxX = toX(s.max), minX = toX(s.min), zeroX = toX(0);
      const fillL = Math.min(minX, maxX), fillW = Math.abs(maxX - minX);

      return `
        <div class="bio-card" style="border-left-color:${color}">
          <div class="bio-ch-head">
            <span class="bio-badge">CH ${ch.id}</span>
            <span class="bio-ch-name">${esc(ch.title)}</span>
            <span class="bio-ch-meta">${esc(ch.unit)} · ${ch.sampleRate} Hz</span>
          </div>
          <div class="bio-stats">
            <div class="bio-sc">
              <div class="bio-sl">PEAK MAX</div>
              <div class="bio-sv bio-hi">${f(s.max)}<span class="bio-u">${esc(ch.unit)}</span></div>
            </div>
            <div class="bio-sc">
              <div class="bio-sl">PEAK MIN</div>
              <div class="bio-sv bio-lo">${f(s.min)}<span class="bio-u">${esc(ch.unit)}</span></div>
            </div>
            <div class="bio-sc">
              <div class="bio-sl">PEAK–PEAK</div>
              <div class="bio-sv">${f(s.peakToPeak)}<span class="bio-u">${esc(ch.unit)}</span></div>
            </div>
            <div class="bio-sc">
              <div class="bio-sl">MEAN</div>
              <div class="bio-sv">${f(s.mean)}<span class="bio-u">${esc(ch.unit)}</span></div>
            </div>
            <div class="bio-sc">
              <div class="bio-sl">RMS</div>
              <div class="bio-sv">${f(s.rms)}<span class="bio-u">${esc(ch.unit)}</span></div>
            </div>
          </div>
          <div class="bio-bar-wrap">
            <div class="bio-bar-track">
              <div class="bio-bar-zero" style="left:${zeroX.toFixed(2)}%"></div>
              <div class="bio-bar-fill" style="left:${fillL.toFixed(2)}%;width:${fillW.toFixed(2)}%;background:${color}"></div>
              <div class="bio-dot bio-dot-max" style="left:${maxX.toFixed(2)}%"></div>
              <div class="bio-dot bio-dot-min" style="left:${minX.toFixed(2)}%"></div>
            </div>
            <div class="bio-bar-foot">
              <span>${s.n.toLocaleString()} samples</span>
              <span>peak at sample ${s.maxI.toLocaleString()}</span>
            </div>
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="bio-overlay" id="bio-overlay">
      <div class="bio-modal" role="dialog" aria-modal="true" aria-label="Biometrics analysis">
        <div class="bio-modal-head">
          <div>
            <div class="bio-modal-title">BiometricsDataLog · V4</div>
            <div class="bio-modal-file">${esc(filename)}</div>
          </div>
          <button class="bio-close" id="bio-close" aria-label="Close">&times;</button>
        </div>
        <div class="bio-modal-body">
          <div class="bio-meta-strip">${metaCells}</div>
          <div class="bio-ch-list">${cards}</div>
        </div>
      </div>
    </div>`;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const CSS = `
.bio-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);
  display:flex;align-items:center;justify-content:center;padding:12px;
  backdrop-filter:blur(6px);}
.bio-modal{background:#131C24;border:1px solid #233040;border-radius:4px;
  width:100%;max-width:840px;max-height:92vh;display:flex;flex-direction:column;
  overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5);}
.bio-modal-head{display:flex;align-items:flex-start;justify-content:space-between;
  padding:18px 22px 14px;border-bottom:1px solid #233040;flex-shrink:0;gap:12px;}
.bio-modal-title{font-family:'Courier New',Courier,monospace;font-size:10px;
  letter-spacing:.22em;text-transform:uppercase;color:#3A9ED4;margin-bottom:3px;}
.bio-modal-file{font-size:12px;color:#5C7A90;}
.bio-close{background:none;border:1px solid #233040;color:#5C7A90;font-size:18px;
  line-height:1;cursor:pointer;width:30px;height:30px;border-radius:2px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  transition:border-color .14s,color .14s;}
.bio-close:hover{border-color:#CF4E68;color:#CF4E68;}
.bio-close:focus-visible{outline:2px solid #3A9ED4;outline-offset:2px;}
.bio-modal-body{overflow-y:auto;padding:18px 22px 22px;
  display:flex;flex-direction:column;gap:12px;}
.bio-meta-strip{display:flex;flex-wrap:wrap;border:1px solid #233040;
  border-radius:3px;overflow:hidden;background:#0B0F13;}
.bio-mc{flex:1 1 100px;padding:9px 14px;border-right:1px solid #233040;}
.bio-mc:last-child{border-right:none;}
.bio-mk{font-family:'Courier New',Courier,monospace;font-size:7px;
  letter-spacing:.22em;text-transform:uppercase;color:#5C7A90;margin-bottom:3px;}
.bio-mv{font-family:'Courier New',Courier,monospace;font-size:12px;
  color:#C8DFF0;font-variant-numeric:tabular-nums;white-space:nowrap;}
.bio-ch-list{display:flex;flex-direction:column;gap:8px;}
.bio-card{border:1px solid #233040;border-left-width:3px;
  border-radius:0 3px 3px 0;background:#0B0F13;padding:14px 16px 16px;}
.bio-ch-head{display:flex;align-items:baseline;gap:9px;
  margin-bottom:12px;flex-wrap:wrap;}
.bio-badge{font-family:'Courier New',Courier,monospace;font-size:8px;
  letter-spacing:.1em;border:1px solid #233040;padding:2px 6px;
  border-radius:2px;color:#5C7A90;flex-shrink:0;}
.bio-ch-name{font-size:13px;font-weight:600;color:#C8DFF0;}
.bio-ch-meta{margin-left:auto;font-family:'Courier New',Courier,monospace;
  font-size:10px;color:#5C7A90;}
.bio-nodata{font-size:12px;color:#5C7A90;}
.bio-stats{display:grid;grid-template-columns:repeat(5,1fr);
  gap:1px;background:#233040;border:1px solid #233040;
  border-radius:2px;overflow:hidden;}
.bio-sc{background:#131C24;padding:10px 11px 8px;}
.bio-sl{font-family:'Courier New',Courier,monospace;font-size:7px;
  letter-spacing:.2em;text-transform:uppercase;color:#5C7A90;margin-bottom:5px;}
.bio-sv{font-family:'Courier New',Courier,monospace;font-size:17px;
  font-variant-numeric:tabular-nums;color:#C8DFF0;line-height:1;white-space:nowrap;}
.bio-hi{color:#29C47E;}.bio-lo{color:#CF4E68;}
.bio-u{font-size:10px;opacity:0.7;margin-left:1px;vertical-align:baseline;}
.bio-bar-wrap{margin-top:12px;}
.bio-bar-track{height:3px;background:#233040;border-radius:2px;
  position:relative;overflow:visible;}
.bio-bar-zero{position:absolute;top:-4px;bottom:-4px;
  width:1px;background:#2E3E50;}
.bio-bar-fill{position:absolute;top:0;bottom:0;border-radius:2px;opacity:.45;}
.bio-dot{position:absolute;width:7px;height:7px;border-radius:50%;
  top:50%;transform:translate(-50%,-50%);}
.bio-dot-max{background:#29C47E;}.bio-dot-min{background:#CF4E68;}
.bio-bar-foot{display:flex;justify-content:space-between;margin-top:6px;
  font-family:'Courier New',Courier,monospace;font-size:9px;color:#5C7A90;
  letter-spacing:.05em;}
@media(max-width:520px){
  .bio-stats{grid-template-columns:repeat(3,1fr);}
  .bio-ch-meta{display:none;}
}`;

function injectStyles() {
  if (document.getElementById("bio-styles")) return;
  const el = document.createElement("style");
  el.id = "bio-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── Modal lifecycle ────────────────────────────────────────────────────────────

function showModal(filename, parsed) {
  document.getElementById("bio-overlay")?.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildModal(filename, parsed);
  const overlay = wrapper.firstElementChild;
  document.body.appendChild(overlay);

  const close = () => document.getElementById("bio-overlay")?.remove();

  document.getElementById("bio-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    "keydown",
    (e) => { if (e.key === "Escape") close(); },
    { once: true }
  );
}

// ── Public ─────────────────────────────────────────────────────────────────────

export const openBiometricsAnalyzer = () => {
  injectStyles();

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".log,.txt";

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      showModal(file.name, parseLog(buf));
    } catch (err) {
      alert(`Parse error: ${err.message}`);
    }
  });

  input.click();
};
