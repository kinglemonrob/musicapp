export const GAME_CONFIG = {
  judgment: { perfectMs: 40, goodMs: 90, fiftyMs: 150 },
  approachMs: 1_200,
  healthDrainPerSecond: 0.006,
  healthRecovery: { 300: 0.045, 100: 0.025, 50: 0.012, miss: -0.12 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class GameCore {
  constructor(audio) {
    this.audio = audio;
    this.analysis = { beats: [], onsets: [], bpm: 0, duration_ms: 0 };
    this.difficulty = "normal";
    try {
      const storedLatency = Number(localStorage.getItem("rhythm-latency-ms") || 0);
      this.latencyMs = Number.isFinite(storedLatency) ? clamp(storedLatency, -150, 150) : 0;
    } catch {
      this.latencyMs = 0;
    }
    this.stats = this.emptyStats();
    this.lastSongTimeMs = 0;
    this.inputCallback = null;
  }

  emptyStats() {
    return { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, total: 0, counts: { 300: 0, 100: 0, 50: 0, miss: 0 }, health: 1 };
  }

  setAnalysis(analysis) {
    this.analysis = analysis;
    this.reset();
  }

  reset() {
    this.stats = this.emptyStats();
    this.lastSongTimeMs = this.songTimeMs();
  }

  setDifficulty(difficulty) {
    this.difficulty = difficulty;
  }

  setLatency(offsetMs) {
    const value = Number(offsetMs);
    this.latencyMs = Number.isFinite(value) ? clamp(value, -150, 150) : 0;
    try { localStorage.setItem("rhythm-latency-ms", String(this.latencyMs)); } catch { /* Storage may be disabled. */ }
  }

  songTimeMs() {
    return this.audio.currentTime * 1000;
  }

  syncToAudio() {
    this.lastSongTimeMs = this.songTimeMs();
  }

  clockMs() {
    return this.songTimeMs() + this.latencyMs;
  }

  filteredEvents() {
    const beats = (this.analysis.beats || []).map((event) => ({ ...event, kind: event.kind || "beat" }));
    const onsets = (this.analysis.onsets || []).map((event) => ({ ...event, kind: "onset" }));
    let events;
    if (this.difficulty === "easy") {
      events = beats.filter((event) => event.strength >= 0.68);
      if (!events.length) events = beats.filter((_, index) => index % 2 === 0);
    } else if (this.difficulty === "hard") {
      events = [...beats, ...onsets].sort((left, right) => left.time_ms - right.time_ms);
    } else {
      events = beats;
    }
    const unique = [];
    for (const event of events) {
      if (!unique.length || event.time_ms - unique[unique.length - 1].time_ms > 35) unique.push(event);
      else if (event.strength > unique[unique.length - 1].strength) unique[unique.length - 1] = event;
    }
    return unique;
  }

  judge(targetTimeMs, inputTimeMs = this.clockMs()) {
    const offsetMs = inputTimeMs - targetTimeMs;
    const delta = Math.abs(offsetMs);
    const window = GAME_CONFIG.judgment;
    const value = delta <= window.perfectMs ? 300
      : delta <= window.goodMs ? 100
        : delta <= window.fiftyMs ? 50 : "miss";
    return { value, offsetMs, timing: offsetMs < 0 ? "early" : offsetMs > 0 ? "late" : "perfect" };
  }

  record(judgment) {
    const value = judgment.value;
    this.stats.total += 1;
    this.stats.counts[value] += 1;
    if (value === "miss") {
      this.stats.misses += 1;
      this.stats.combo = 0;
      this.stats.health = Math.max(0, this.stats.health + GAME_CONFIG.healthRecovery.miss);
    } else {
      this.stats.hits += 1;
      this.stats.combo += 1;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
      this.stats.score += Math.round(value * (1 + (this.stats.combo - 1) / 10));
      this.stats.health = Math.min(1, this.stats.health + GAME_CONFIG.healthRecovery[value]);
    }
    if (this.inputCallback) this.inputCallback({ ...judgment, stats: this.results() });
    return judgment;
  }

  tick(active = false) {
    const now = this.songTimeMs();
    if (active && !this.audio.paused && !this.audio.seeking && now >= this.lastSongTimeMs) {
      this.stats.health = Math.max(0, this.stats.health - (now - this.lastSongTimeMs) / 1000 * GAME_CONFIG.healthDrainPerSecond);
    }
    this.lastSongTimeMs = now;
    return this.stats.health;
  }

  results() {
    const possible = this.stats.total * 300;
    const earned = this.stats.counts[300] * 300 + this.stats.counts[100] * 100 + this.stats.counts[50] * 50;
    const accuracy = possible ? earned / possible * 100 : 100;
    const rank = accuracy >= 100 ? "SS" : accuracy >= 95 ? "S" : accuracy >= 90 ? "A" : accuracy >= 80 ? "B" : accuracy >= 70 ? "C" : "D";
    return { ...this.stats, accuracy, rank };
  }
}