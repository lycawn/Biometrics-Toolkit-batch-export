import "./style.css";

import { appUI } from "./components/UI/App.js";
import { openBiometricsAnalyzer } from "./hook/BiometricsAnalyzer.js";
import { openBiometricsBatchAnalyzer } from "./hook/BiometricsBatchAnalyzer.js";

document.querySelector("#app").innerHTML = appUI();

document.querySelector("#analyze-log-btn").addEventListener("click", openBiometricsAnalyzer);
document.querySelector("#analyze-batch-btn").addEventListener("click", openBiometricsBatchAnalyzer);
