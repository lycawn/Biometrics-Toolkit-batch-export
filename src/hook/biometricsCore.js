// Shared, DOM-free parsing/analysis logic for Biometrics/DataLITE .txt exports.
// Used by both the browser UI (BiometricsBatchAnalyzer.js) and the CLI
// (bin/biometrics-peaks.mjs) so the two never drift apart.

// Biometrics electrogoniometer channels: full-scale ±4000 raw ADC counts
// correspond to ±180°. Confirmed by cross-checking a raw-ADC export against
// the same recording exported in engineering units (degrees) — the two
// matched to within 0.005° across 19 repetitions.
export const RAW_ADC_TO_DEGREES = 180 / 4000;

export function decodeUtf16(bufOrBytes) {
  const bytes = new Uint8Array(bufOrBytes);
  const bomLen = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0;
  return new TextDecoder("utf-16le").decode(bytes.slice(bomLen));
}

// ── Filename parsing ─────────────────────────────────────────────────────────
// Expected pattern: <participant>.<protocol>.<...>.txt
// The participant is always the first dot-segment, the protocol the second.
// Any remaining segments (leftover device export parameters, set labels, etc.)
// are not needed — each individual repetition is auto-detected from the trace
// itself (see findAllPeaks below), not from the filename.
export function parseFilename(name) {
  const base = name.replace(/\.[^.]+$/, "");
  const parts = base.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  return { participant: parts[0], protocol: parts[1] };
}

// ── File content parsing ─────────────────────────────────────────────────────
// Files are UTF-16LE tab-delimited exports:
//   Channel 1: '..  X axis', N values, raw ADC, no filters.
//   Channel 2: '..  Y axis', N values, raw ADC, no filters.
//   Digitals combined (...): N values, .
//   <blank line>
//   v1<TAB>v2<TAB>v3
//   ...

export function parseYAxisSamples(text) {
  const lines = text.split(/\r?\n/);
  const channelRe = /^Channel\s+(\d+):\s*'(.*)',/;

  let yColumn = -1;
  let yIsRawAdc = false;
  let dataStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(channelRe);
    if (m) {
      if (/y\s*axis/i.test(m[2])) {
        yColumn = parseInt(m[1], 10) - 1;
        yIsRawAdc = /raw\s*adc/i.test(line);
      }
      continue;
    }
    if (/^-?\d+(\.\d+)?\t/.test(line)) {
      dataStart = i;
      break;
    }
  }

  if (dataStart === -1) throw new Error("Δεν βρέθηκαν δεδομένα (tab-delimited) στο αρχείο.");
  if (yColumn === -1) {
    yColumn = 1; // fallback: 2nd column is conventionally Y axis
    yIsRawAdc = true;
  }

  // Files exported as "raw ADC" need the goniometer scale applied to read as
  // degrees; files already exported in engineering units are used as-is.
  const scale = yIsRawAdc ? RAW_ADC_TO_DEGREES : 1;

  const values = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const raw = parseFloat(line.split("\t")[yColumn]);
    if (!Number.isNaN(raw)) values.push(raw * scale);
  }

  if (!values.length) throw new Error("Η στήλη Y axis δεν περιείχε αριθμητικές τιμές.");
  return values;
}

// ── Peak detection ───────────────────────────────────────────────────────────
// Sequential trend-following peak detector: walk the Y values in order while
// rising, tracking the running max; once the signal drops off that max by
// more than `thresholdPct` of the file's overall value range, the max is
// confirmed as one repetition's peak and recorded. Then wait through the
// valley — once the signal climbs back up by that same margin, start
// tracking the next repetition's max. Repeat to the end of the file.
//
// Each confirmed peak also carries `precedingMin`: the trough (e.g. the
// dorsiflexion low point) that immediately preceded that repetition's rise —
// so callers can report both the peak and the excursion from its own valley.
//
// The threshold acts purely as noise rejection (so small ADC jitter within a
// single repetition doesn't get counted as a fall/rise); it does not limit
// how many repetitions can be found.

export function findAllPeaks(values, thresholdPct = 0.2) {
  const n = values.length;
  if (!n) return [];

  let globalMax = -Infinity, globalMin = Infinity;
  for (let i = 0; i < n; i++) {
    if (values[i] > globalMax) globalMax = values[i];
    if (values[i] < globalMin) globalMin = values[i];
  }
  const threshold = Math.max(1e-9, (globalMax - globalMin) * thresholdPct);

  const peaks = [];
  // The very first repetition's direction isn't known yet: the recording
  // could start already rising toward its first peak, or dip to a lower
  // trough first. Track both the running max and min until one of them
  // is confirmed by a genuine excursion, then commit to a direction —
  // this avoids mistaking an early dip for the "preceding" trough of rep 1
  // when a lower one actually occurs a few samples in.
  let state = "undetermined";

  let curMax = values[0], curMaxIndex = 0;
  let curMin = values[0], curMinIndex = 0;
  let precedingMin = values[0], precedingMinIndex = 0;

  for (let i = 1; i < n; i++) {
    const v = values[i];

    if (state === "undetermined") {
      if (v > curMax) { curMax = v; curMaxIndex = i; }
      if (v < curMin) { curMin = v; curMinIndex = i; }

      if (curMax - curMin >= threshold) {
        if (curMinIndex < curMaxIndex) {
          // Dipped to a trough first, then rose — that trough is the
          // genuine preceding valley for the peak we're now tracking.
          precedingMin = curMin;
          precedingMinIndex = curMinIndex;
          state = "rising";
        } else {
          // Rose to a peak first, then fell — that peak is already
          // complete; nothing earlier in the file to call its valley.
          peaks.push({ value: curMax, sampleIndex: curMaxIndex, precedingMin, precedingMinIndex });
          state = "falling";
          curMin = v;
          curMinIndex = i;
        }
      }
      continue;
    }

    if (state === "rising") {
      if (v > curMax) { curMax = v; curMaxIndex = i; }
      if (curMax - v >= threshold) {
        peaks.push({ value: curMax, sampleIndex: curMaxIndex, precedingMin, precedingMinIndex });
        state = "falling";
        curMin = v;
        curMinIndex = i;
      }
    } else {
      if (v < curMin) { curMin = v; curMinIndex = i; }
      if (v - curMin >= threshold) {
        state = "rising";
        precedingMin = curMin;
        precedingMinIndex = curMinIndex;
        curMax = v;
        curMaxIndex = i;
      }
    }
  }
  // A trailing rise that never confirmed its fall is still a genuine peak.
  if (state === "rising" && curMax - curMin >= threshold) {
    peaks.push({ value: curMax, sampleIndex: curMaxIndex, precedingMin, precedingMinIndex });
  }

  return peaks;
}

// ── Per-file processing ──────────────────────────────────────────────────────
// `readBuffer` is injected so this stays usable from both the browser
// (File.arrayBuffer()) and Node (fs.readFileSync), without either environment
// leaking into this module.

export async function processFileBuffer(filename, buf) {
  const meta = parseFilename(filename);
  if (!meta) {
    return [{
      file: filename,
      participant: "?",
      protocol: "?",
      measurement: "?",
      peak: null,
      precedingDF: null,
      excursion: null,
      error: "Μη αναγνωρίσιμο όνομα αρχείου (αναμένεται συμμετέχοντας.πρωτόκολλο....txt)",
    }];
  }

  try {
    const text = decodeUtf16(buf);
    const values = parseYAxisSamples(text);
    const peaks = findAllPeaks(values);

    if (!peaks.length) {
      return [{
        file: filename,
        participant: meta.participant,
        protocol: meta.protocol,
        measurement: "?",
        peak: null,
        precedingDF: null,
        excursion: null,
        error: "Δεν εντοπίστηκε καμία κορυφή στο σήμα.",
      }];
    }

    return peaks.map((p, i) => ({
      file: filename,
      participant: meta.participant,
      protocol: meta.protocol,
      measurement: i + 1,
      peak: p.value,
      precedingDF: p.precedingMin,
      excursion: p.value - p.precedingMin,
      error: null,
    }));
  } catch (err) {
    return [{
      file: filename,
      participant: meta.participant,
      protocol: meta.protocol,
      measurement: "?",
      peak: null,
      precedingDF: null,
      excursion: null,
      error: err.message,
    }];
  }
}

export function sortRows(rows) {
  const numOr = (s) => {
    const n = parseFloat(s);
    return Number.isNaN(n) ? s : n;
  };
  return rows.slice().sort((a, b) => {
    const pa = numOr(a.participant), pb = numOr(b.participant);
    if (pa !== pb) return pa < pb ? -1 : 1;
    const proa = numOr(a.protocol), prob = numOr(b.protocol);
    if (proa !== prob) return proa < prob ? -1 : 1;
    const ma = numOr(a.measurement), mb = numOr(b.measurement);
    if (ma < mb) return -1;
    if (ma > mb) return 1;
    return 0;
  });
}

export function rowsToCsv(rows) {
  const header = [
    "Συμμετέχων",
    "Πρωτόκολλο",
    "Μέτρηση",
    "Preceding DF (°)",
    "Peak PF (°)",
    "Εύρος DF→PF (°)",
    "Αρχείο",
  ];
  const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = (v) => (v === null || v === undefined ? "" : v.toFixed(2));

  const lines = [header.map(csvEscape).join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.participant,
        r.protocol,
        r.measurement,
        r.error ? "" : num(r.precedingDF),
        r.error ? r.error : num(r.peak),
        r.error ? "" : num(r.excursion),
        r.file,
      ]
        .map(csvEscape)
        .join(";")
    );
  }
  return "﻿" + lines.join("\r\n");
}
