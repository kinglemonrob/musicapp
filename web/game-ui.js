import { GameCore } from "./game-core.js";
import { OsuMode } from "./mode-osu.js";
import { FireIceMode } from "./mode-fire-ice.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function initializeRhythmGame(audio) {
  return new RhythmGameUI(audio);
}

class RhythmGameUI {
  constructor(audio) {
    this.audio = audio;
    this.core = new GameCore(audio);
    this.modeName = "osu";
    this.mode = this.createMode();
    this.canvas = document.querySelector("#beatGameCanvas");
    this.context = this.canvas.getContext("2d");
    this.active = false;
    this.analysis = null;
    this.currentFile = null;
    this.analysisRequestId = 0;
    this.loading = false;
    this.practiceMode = document.querySelector("#gameNoFail").checked;
    this.debug = document.querySelector("#beatDebugToggle");
    this.healthFill = document.querySelector("#gameHealthFill");
    this.resultDialog = document.querySelector("#gameResultsDialog");
    this.bindControls();
    this.frame = requestAnimationFrame((time) => this.render(time));
  }

  bindControls() {
    document.querySelector("#gameToggle").addEventListener("click", () => this.toggle());
    document.querySelector("#beatTapButton").addEventListener("click", () => this.hit());
    for (const button of document.querySelectorAll("[data-game-mode]")) {
      button.addEventListener("click", () => this.setMode(button.dataset.gameMode));
    }
    for (const button of document.querySelectorAll("[data-game-difficulty]")) {
      button.addEventListener("click", () => {
        this.core.setDifficulty(button.dataset.gameDifficulty);
        for (const choice of document.querySelectorAll("[data-game-difficulty]")) {
          const selected = choice === button;
          choice.classList.toggle("is-selected", selected);
          choice.setAttribute("aria-pressed", String(selected));
        }
        if (this.analysis) this.loadMode();
      });
    }
    const calibration = document.querySelector("#gameLatency");
    calibration.value = String(this.core.latencyMs);
    document.querySelector("#gameLatencyValue").textContent = `${this.core.latencyMs} ms`;
    calibration.addEventListener("input", () => {
      this.core.setLatency(calibration.value);
      document.querySelector("#gameLatencyValue").textContent = `${this.core.latencyMs} ms`;
    });
    document.querySelector("#gameNoFail").addEventListener("change", (event) => {
      this.practiceMode = event.target.checked;
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.modeName === "osu") {
        this.canvas.setPointerCapture(event.pointerId);
        const point = this.pointerPosition(event);
        const rect = this.canvas.getBoundingClientRect();
        this.mode.pointerDownAt(point.x, point.y, rect.width, rect.height, this.core.clockMs());
      } else this.hit();
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.modeName !== "osu") return;
      const point = this.pointerPosition(event);
      const rect = this.canvas.getBoundingClientRect();
      this.mode.pointerMove(point.x, point.y, rect.width, rect.height, this.core.clockMs());
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.canvas.addEventListener(type, () => {
        if (this.modeName === "osu") this.mode.pointerUp(this.core.clockMs());
      });
    }
    window.addEventListener("keydown", (event) => {
      if (!this.active || this.resultDialog.open || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, input, textarea, select, [contenteditable='true']")) return;
      if (this.modeName === "osu" && (event.code === "KeyZ" || event.code === "KeyX")) {
        event.preventDefault();
        this.hit();
      } else if (this.modeName === "fire-ice" && !["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        if (event.code !== "Space" && event.key.length !== 1) return;
        event.preventDefault();
        this.hit();
      }
    });
    this.audio.addEventListener("seeking", () => {
      this.mode.seek(this.core.songTimeMs());
      this.core.syncToAudio();
    });
    this.audio.addEventListener("seeked", () => {
      this.mode.seek(this.core.songTimeMs());
      this.core.syncToAudio();
    });
    this.audio.addEventListener("play", () => this.updateStatus());
    this.audio.addEventListener("pause", () => this.updateStatus());
    document.querySelector("#resultsClose").addEventListener("click", () => this.resultDialog.close());
    document.querySelector("#resultsRestart").addEventListener("click", () => {
      this.resultDialog.close();
      this.core.reset();
      this.active = true;
      this.audio.currentTime = 0;
      this.mode.seek(0);
      this.audio.play().catch(() => {});
      this.updateStatus();
    });
  }

  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  createMode() {
    const onJudgment = (judgment) => this.showJudgment(judgment);
    if (this.modeName === "osu") return new OsuMode(this.core, onJudgment);
    return new FireIceMode(this.core, {
      noFail: () => this.practiceMode,
      onJudgment,
      onGameOver: () => this.gameOver(),
    });
  }

  loadMode() {
    if (this.modeName === "osu") this.mode.load(this.analysis);
    else this.mode.load();
    this.mode.seek(this.core.songTimeMs());
  }

  setMode(modeName) {
    if (modeName === this.modeName) return;
    this.modeName = modeName;
    this.mode = this.createMode();
    if (this.analysis) this.loadMode();
    for (const button of document.querySelectorAll("[data-game-mode]")) {
      const selected = button.dataset.gameMode === modeName;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const osu = modeName === "osu";
    document.querySelector(".rhythm-game").setAttribute("aria-label", osu ? "osu! Standard rhythm game" : "A Dance of Fire and Ice rhythm game");
    document.querySelector("#gameTitle").textContent = osu ? "osu! Standard" : "A Dance of Fire and Ice";
    document.querySelector("#beatTapButton").textContent = osu ? "Hit circle  Z  X" : "Tap beat  Space";
    document.querySelector("#gameHelp").textContent = osu
      ? "Click/tap numbered circles. Hold sliders, spin during gaps. Z / X are hit keys."
      : "Press Space or any key as the orb lands. Fire and Ice alternate on each tile.";
    this.canvas.setAttribute("aria-label", osu
      ? "osu! playfield. Click or tap numbered circles as their approach rings close."
      : "Fire and Ice orbit around a planted orb and land on a generated tile path.");
    this.updateStatus();
  }

  hit() {
    if (!this.active || this.audio.paused) return;
    if (this.modeName === "osu") this.mode.keyDown(this.core.clockMs());
    else this.mode.input();
  }

  gameOver() {
    this.active = false;
    this.audio.pause();
    this.setStatus("Miss · game over. Start again or enable no-fail practice.");
    document.querySelector("#gameToggle").textContent = "Restart game";
  }

  async loadTrack(file) {
    if (this.currentFile === file) return;
    const requestId = ++this.analysisRequestId;
    this.currentFile = file;
    this.analysis = null;
    this.active = false;
    document.querySelector("#beatTapButton").disabled = true;
    if (this.modeName === "osu") this.mode.objects = [];
    else this.mode.events = [];
    this.setStatus("Analyzing song...");
    document.querySelector("#gameToggle").disabled = true;
    document.querySelector("#gameToggle").textContent = "Analyzing...";
    document.querySelector("#beatTapButton").disabled = true;
    let analysis;
    try {
      analysis = await this.fetchBackendAnalysis(file);
    } catch {
      try {
        analysis = await detectBrowserBeats(file);
      } catch (error) {
        if (requestId !== this.analysisRequestId) return;
        document.querySelector("#gameToggle").disabled = false;
        document.querySelector("#gameToggle").textContent = "Choose song";
        this.setStatus(`Beat analysis failed: ${error.message}`);
        return;
      }
    }
    if (requestId !== this.analysisRequestId) return;
    this.analysis = analysis;
    this.core.setAnalysis(this.analysis);
    this.loadMode();
    this.updateMetrics(this.core.results());
    document.querySelector("#gameToggle").disabled = false;
    document.querySelector("#gameToggle").textContent = "Start game";
    document.querySelector("#beatTapButton").disabled = false;
    this.setStatus(`Ready · ${Math.round(this.analysis.bpm || 0)} BPM · ${this.analysis.detector}`);
  }

  clear() {
    this.analysisRequestId += 1;
    this.currentFile = null;
    this.analysis = null;
    this.active = false;
    this.core.reset();
    if (this.modeName === "osu") this.mode.objects = [];
    else this.mode.events = [];
    document.querySelector("#gameToggle").disabled = false;
    document.querySelector("#gameToggle").textContent = "Choose song";
    document.querySelector("#beatTapButton").disabled = true;
    document.querySelector("#gameHealthFill").style.width = "100%";
    this.setStatus("Choose a track to analyze");
  }

  async fetchBackendAnalysis(file) {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await fetch("/api/beats", { method: "POST", body: form });
    if (!response.ok) throw new Error("Local beat API unavailable");
    const result = await response.json();
    if (!Array.isArray(result.beats)) throw new Error("Invalid beat response");
    return result;
  }

  async toggle() {
    if (!this.analysis) {
      document.querySelector("#fileInput").click();
      return;
    }
    if (this.modeName === "fire-ice" && this.mode.gameOver) {
      this.audio.currentTime = 0;
      this.core.reset();
      this.mode.seek(0);
      this.active = true;
      if (this.audio.paused) await this.audio.play().catch(() => {});
      this.updateStatus();
      return;
    }
    const wasActive = this.active;
    if (!wasActive) {
      this.active = true;
      this.core.reset();
      this.mode.seek(this.core.songTimeMs());
    }
    if (this.audio.paused) {
      try { await this.audio.play(); } catch { this.setStatus("Press the player Play button to resume."); }
    } else if (wasActive) {
      this.audio.pause();
    }
    this.updateStatus();
  }

  updateStatus() {
    if (!this.analysis) return;
    if (this.modeName === "fire-ice" && this.mode.gameOver) this.setStatus("Miss · game over. Start again or enable no-fail practice.");
    else if (!this.active) this.setStatus(`Ready · ${Math.round(this.analysis.bpm || 0)} BPM`);
    else this.setStatus(this.audio.paused ? "Paused · resume to continue" : `Playing · ${Math.round(this.analysis.bpm || 0)} BPM`);
    document.querySelector("#gameToggle").textContent = this.modeName === "fire-ice" && this.mode.gameOver
      ? "Restart game"
      : this.active
      ? this.audio.paused ? "Resume game" : "Pause game"
      : "Start game";
  }

  setStatus(message) {
    document.querySelector("#gameStatus").textContent = message;
  }

  showJudgment(judgment) {
    const label = judgment.label || (judgment.value === "miss" ? "Miss" : String(judgment.value));
    document.querySelector("#gameFeedback").textContent = label;
    document.querySelector("#gameFeedback").dataset.judgment = label.toLowerCase();
    this.updateMetrics(judgment.stats || this.core.results());
  }

  updateMetrics(stats) {
    document.querySelector("#gameScore").textContent = stats.score;
    document.querySelector("#gameCombo").textContent = stats.combo;
    document.querySelector("#gameAccuracy").textContent = `${stats.accuracy.toFixed(2)}%`;
    document.querySelector("#gameBpm").textContent = Math.round(this.analysis?.bpm || 0);
    document.querySelector("#gameHealthFill").style.width = `${stats.health * 100}%`;
    document.querySelector(".game-health").setAttribute("aria-valuenow", String(Math.round(stats.health * 100)));
  }

  drawProgressDebug(context, width, height, durationMs) {
    if (!this.debug.checked || !this.analysis || !durationMs) return;
    context.save();
    for (const onset of this.analysis.onsets || []) {
      const x = 7 + (width - 14) * onset.time_ms / durationMs;
      context.strokeStyle = `rgba(117, 240, 255, ${.2 + onset.strength * .4})`;
      context.lineWidth = 1;
      context.beginPath(); context.moveTo(x, 5); context.lineTo(x, height - 5); context.stroke();
    }
    for (const beat of this.analysis.beats) {
      const x = 7 + (width - 14) * beat.time_ms / durationMs;
      context.strokeStyle = `rgba(255, 208, 106, ${.28 + beat.strength * .68})`;
      context.lineWidth = beat.strength > .75 ? 2 : 1;
      context.beginPath(); context.moveTo(x, 3); context.lineTo(x, height - 3); context.stroke();
    }
    context.restore();
  }

  async finish() {
    this.active = false;
    this.updateStatus();
    const result = this.core.results();
    document.querySelector("#resultRank").textContent = result.rank;
    document.querySelector("#resultScore").textContent = result.score.toLocaleString();
    document.querySelector("#resultAccuracy").textContent = `${result.accuracy.toFixed(2)}%`;
    document.querySelector("#resultCombo").textContent = result.maxCombo;
    document.querySelector("#resultHits").textContent = result.hits;
    document.querySelector("#resultMisses").textContent = result.misses;
    this.resultDialog.showModal();
  }

  render() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const clockMs = this.core.songTimeMs();
    const health = this.core.tick(this.active);
    if (this.active && !this.audio.paused) {
      this.mode.update(clockMs, width, height);
      if (!this.practiceMode && health <= 0) {
        this.audio.pause();
        this.finish();
      }
    }
    this.mode.draw(this.context, width, height, clockMs);
    this.healthFill.style.width = `${health * 100}%`;
    this.updateMetrics(this.core.results());
    this.frame = requestAnimationFrame(() => this.render());
  }
}

async function detectBrowserBeats(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser");
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const stride = Math.max(1, Math.round(buffer.sampleRate / 22_050));
    const sampleRate = buffer.sampleRate / stride;
    const mono = new Float32Array(Math.ceil(buffer.length / stride));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    for (let index = 0; index < mono.length; index += 1) {
      let sum = 0;
      for (const channel of channels) sum += channel[index * stride] || 0;
      mono[index] = sum / channels.length;
    }
    const frameSize = 1024;
    const hop = 512;
    const window = Float32Array.from({ length: frameSize }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (frameSize - 1)));
    const previous = new Float32Array(frameSize / 2 + 1);
    const flux = [];
    for (let start = 0; start + frameSize <= mono.length; start += hop) {
      const magnitude = fftMagnitude(mono, start, window);
      let sum = 0;
      for (let bin = 1; bin < magnitude.length; bin += 1) {
        sum += Math.max(0, magnitude[bin] - previous[bin]);
        previous[bin] = magnitude[bin];
      }
      flux.push(sum);
      if (flux.length % 512 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const detected = spectralFluxEvents(flux, sampleRate, hop);
    const beats = detected.beats;
    const onsets = detected.onsets;
    const tempoEvents = beats.length > 1 ? beats : onsets;
    const intervals = tempoEvents.slice(1).map((beat, index) => beat.time_ms - tempoEvents[index].time_ms).filter((gap) => gap >= 300 && gap <= 1_500);
    const medianGap = intervals.sort((left, right) => left - right)[Math.floor(intervals.length / 2)] || 0;
    let bpm = medianGap ? 60_000 / medianGap : 0;
    if (bpm < 60) bpm *= 2;
    else if (bpm > 180) bpm /= 2;
    return { beats, onsets, bpm, duration_ms: Math.round(buffer.duration * 1000), detector: "browser-web-audio-flux" };
  } finally {
    await context.close();
  }
}

function fftMagnitude(samples, start, window) {
  const size = window.length;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) real[index] = samples[start + index] * window[index];
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let startIndex = 0; startIndex < size; startIndex += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = startIndex + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  return Float32Array.from({ length: size / 2 + 1 }, (_, index) => Math.hypot(real[index], imaginary[index]));
}

function spectralFluxEvents(flux, sampleRate, hop) {
  if (!flux.length) return { beats: [], onsets: [] };
  const sorted = [...flux].sort((left, right) => left - right);
  const weakThreshold = sorted[Math.floor(sorted.length * .35)] || 0;
  const strongThreshold = sorted[Math.floor(sorted.length * .68)] || 0;
  const refractory = Math.max(1, Math.round(.12 * sampleRate / hop));
  const peaks = [];
  let last = -refractory;
  for (let index = 2; index < flux.length - 2; index += 1) {
    const local = Math.max(...flux.slice(index - 2, index + 3));
    const neighborhood = flux.slice(Math.max(0, index - 15), Math.min(flux.length, index + 16));
    const baseline = neighborhood.reduce((sum, value) => sum + value, 0) / neighborhood.length;
    if (flux[index] >= local && flux[index] > Math.max(weakThreshold, baseline * 1.05) && index - last >= refractory) {
      peaks.push({ frame: index, strength: clamp(flux[index] / (sorted[Math.floor(sorted.length * .95)] || flux[index]), 0, 1) });
      last = index;
    }
  }
  const toEvent = (peak, kind) => ({ time_ms: Math.round(peak.frame * hop / sampleRate * 1000), strength: peak.strength, kind });
  const onsets = peaks.map((peak) => toEvent(peak, "onset"));
  let beats = peaks.filter((peak) => peak.strength >= .68 && flux[peak.frame] > strongThreshold * .55).map((peak) => toEvent(peak, "beat"));
  if (!beats.length) beats = peaks.filter((_, index) => index % 2 === 0).map((peak) => toEvent(peak, "beat"));
  return { beats, onsets };
}