export const appUI = () => `
  <div class="app-shell">
    <header class="app-head">
      <div class="app-title">Biometrics Toolkit</div>
      <p class="app-sub">Ανάλυση αρχείων Biometrics/DataLITE και εξαγωγή κορυφών (peaks) ανά επανάληψη.</p>
    </header>

    <div class="app-actions">
      <button id="analyze-log-btn" class="app-btn">
        <span class="app-btn-label">Ανάλυση Αρχείου Log</span>
        <span class="app-btn-hint">Ένα αρχείο · στατιστικά ανά κανάλι</span>
      </button>
      <button id="analyze-batch-btn" class="app-btn">
        <span class="app-btn-label">Batch Εξαγωγή Κορυφών</span>
        <span class="app-btn-hint">Πολλαπλά αρχεία · peak ανά επανάληψη σε °</span>
      </button>
    </div>
  </div>
`;
