# Biometrics Toolkit

A small toolkit for analyzing **Biometrics Ltd / DataLITE** exercise-recording exports (electrogoniometer `.txt`/`.log` files), available both as a **browser app** and a **CLI**.

It solves one specific problem: instead of manually eyeballing a chart to find the peak angle of each repetition, it reads the raw exported data and finds every repetition's peak (and its preceding trough) automatically.

## Features

- **Single-file log analyzer** — drop in one `BiometricsDataLog` export and see per-channel stats (max, min, mean, RMS, peak-to-peak).
- **Batch peak extractor** — drop in many `.txt` exports at once and get a table of every repetition's peak angle, ready to export as CSV.
- **CLI** — same peak-extraction logic, runnable from a terminal over a whole folder, for scripting/automation.

## Getting started

```bash
npm install
npm run dev       # starts the browser app (Vite)
npm run build      # production build
```

Open the app, and use either:

- **Ανάλυση Αρχείου Log** — analyze a single file's channels.
- **Batch Εξαγωγή Κορυφών** — select multiple `.txt` files and get a combined peaks table with CSV export.

## CLI usage

```bash
node bin/biometrics-peaks.mjs <folder-or-file...> [--out results.csv]

# examples
node bin/biometrics-peaks.mjs ./data
node bin/biometrics-peaks.mjs ./data/1.30.1,2.txt ./data/2.20.1.txt --out peaks.csv
npm run biometrics-peaks -- ./data --out peaks.csv
```

Point it at a folder (it scans for `.txt` files) or at specific files. It prints a table to the terminal and, with `--out`, writes a CSV (UTF-8 with BOM, `;`-delimited — opens cleanly in Excel).

## Input file format

Exports are UTF-16LE, tab-delimited text, e.g.:

```
File Name: 1.1.30.15.2.log
Channel 1: '  X axis', 138980 values, raw ADC, no filters.
Channel 2: '  Y axis', 138980 values, raw ADC, no filters.
Digitals combined (event=16, d=8, c=4, b=2, a=1): 138990 values, .

-66	505	3
-66	505	3
...
```

Each data row is `channel1<TAB>channel2<TAB>digital`. The toolkit reads whichever channel is labeled **"Y axis"** (falling back to the 2nd column if no channel label matches).

### Filename convention

Files are expected to be named `<participant>.<protocol>...txt`, e.g. `2.20.1.txt` or `1.30.1,2.txt`. Only the first two dot-separated segments are used (participant, protocol) — anything after that is ignored, since each individual repetition is detected automatically from the signal itself, not from the filename.

### Raw ADC → degrees

If a channel's header says `raw ADC`, its values are converted to degrees using the Biometrics electrogoniometer scale: **±4000 raw counts = ±180°** (i.e. `degrees = raw × 0.045`). This was empirically confirmed by cross-checking a raw-ADC export against the same recording exported in engineering units — the two matched to within 0.005° across 19 repetitions. Files already exported in engineering units (not `raw ADC`) are used as-is, unscaled.

## How peak detection works

Both the browser tool and the CLI share the same logic (`src/hook/biometricsCore.js`): a sequential trend-following detector walks the Y-axis samples in order. While the signal rises, it tracks the running max; once the signal drops off that max by more than a noise-rejection threshold, the max is confirmed as one repetition's peak. It then waits through the following valley, and once the signal climbs back up by that same margin, starts tracking the next repetition. This repeats to the end of the file — so the number of repetitions found is whatever the signal actually contains, not a fixed count.

Each detected peak also records its **preceding trough** (e.g. the dorsiflexion low point right before a plantarflexion peak), so the output includes both the peak and the excursion between them.

> Recordings with a long rest/transition between sets can occasionally produce a few small spurious peaks during that transition — always sanity-check the repetition count against the chart for files with unusual gaps.

## Project structure

```
src/
  hook/
    biometricsCore.js         # shared parsing + peak-detection logic (no DOM)
    BiometricsAnalyzer.js      # browser: single-file channel stats modal
    BiometricsBatchAnalyzer.js # browser: batch peak-extraction modal
  components/UI/App.js         # app shell / buttons
bin/
  biometrics-peaks.mjs         # CLI entry point
```

## Contributing

Issues and pull requests are welcome. This project intentionally has no build dependencies beyond Vite — keep it that way unless there's a strong reason not to.

## License

[MIT](LICENSE)
