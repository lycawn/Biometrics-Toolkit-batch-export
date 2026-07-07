#!/usr/bin/env node
// CLI: extract Y-axis (goniometer) peaks from Biometrics/DataLITE .txt exports.
//
// Usage:
//   node bin/biometrics-peaks.mjs <folder-or-file...> [--out results.csv]
//
// Examples:
//   node bin/biometrics-peaks.mjs ./data
//   node bin/biometrics-peaks.mjs ./data/1.30.1,2.txt ./data/2.20.1.txt --out peaks.csv

import fs from "node:fs";
import path from "node:path";
import {
  processFileBuffer,
  sortRows,
  rowsToCsv,
} from "../src/hook/biometricsCore.js";

function printUsage() {
  console.log(`Usage: biometrics-peaks <folder-or-file...> [--out results.csv]

Reads Biometrics/DataLITE .txt exports (UTF-16LE, tab-delimited), auto-detects
each repetition's peak on the Y-axis (goniometer) channel, and prints a
summary table. Pass --out <path> to also write a CSV file.`);
}

function collectTxtFiles(inputPaths) {
  const files = [];
  for (const p of inputPaths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) {
        if (entry.toLowerCase().endsWith(".txt")) {
          files.push(path.join(p, entry));
        }
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

function padCell(value, width) {
  return String(value ?? "").padEnd(width);
}

function printTable(rows) {
  const cols = [
    ["Συμμετέχων", "participant"],
    ["Πρωτόκολλο", "protocol"],
    ["Μέτρηση", "measurement"],
    ["Preceding DF (°)", "precedingDFDisplay"],
    ["Peak PF (°)", "peakDisplay"],
    ["Εύρος DF→PF (°)", "excursionDisplay"],
    ["Αρχείο", "file"],
  ];

  const widths = cols.map(([label, key]) =>
    Math.max(label.length, ...rows.map((r) => String(r[key] ?? "").length))
  );

  const line = (cells) => cells.map((c, i) => padCell(c, widths[i])).join("  ");

  console.log(line(cols.map(([label]) => label)));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(line(cols.map(([, key]) => r[key])));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }

  const outIndex = args.indexOf("--out");
  let outPath = null;
  let inputArgs = args;
  if (outIndex !== -1) {
    outPath = args[outIndex + 1];
    if (!outPath) {
      console.error("Error: --out requires a file path.");
      process.exit(1);
    }
    inputArgs = [...args.slice(0, outIndex), ...args.slice(outIndex + 2)];
  }

  if (!inputArgs.length) {
    console.error("Error: no input folder or file given.");
    printUsage();
    process.exit(1);
  }

  for (const p of inputArgs) {
    if (!fs.existsSync(p)) {
      console.error(`Error: path not found: ${p}`);
      process.exit(1);
    }
  }

  const files = collectTxtFiles(inputArgs);
  if (!files.length) {
    console.error("No .txt files found.");
    process.exit(1);
  }

  const allRows = [];
  for (const filePath of files) {
    const buf = fs.readFileSync(filePath);
    const rows = await processFileBuffer(path.basename(filePath), buf);
    allRows.push(...rows);
  }

  const numDisplay = (v) => (v === null || v === undefined ? "" : v.toFixed(2));
  const sorted = sortRows(allRows).map((r) => ({
    ...r,
    precedingDFDisplay: r.error ? "" : numDisplay(r.precedingDF),
    peakDisplay: r.error ? r.error : numDisplay(r.peak),
    excursionDisplay: r.error ? "" : numDisplay(r.excursion),
  }));

  printTable(sorted);

  const errorCount = sorted.filter((r) => r.error).length;
  console.log(`\n${sorted.length} γραμμές (${errorCount} με σφάλμα) από ${files.length} αρχεία.`);

  if (outPath) {
    fs.writeFileSync(outPath, rowsToCsv(allRows), "utf8");
    console.log(`CSV written to ${outPath}`);
  }
}

main();
