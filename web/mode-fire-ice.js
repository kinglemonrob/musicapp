import { GAME_CONFIG } from "./game-core.js";

const FIRE = "#ff8066";
const ICE = "#75f0ff";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FireIceMode {
  constructor(core, options = {}) {
    this.core = core;
    this.noFail = options.noFail || (() => false);
    this.onJudgment = options.onJudgment || (() => {});
    this.onGameOver = options.onGameOver || (() => {});
    this.onStep = options.onStep || (() => {});
    this.events = [];
    this.tiles = [];
    this.nextIndex = 0;
    this.gameOver = false;
    this.lastJudgment = "";
    this.failedTimeMs = 0;
  }

  load() {
    this.events = this.core.filteredEvents();
    this.tiles = this.createPath(this.events.length + 1);
    this.nextIndex = 0;
    this.gameOver = false;
    this.lastJudgment = "";
  }

  createPath(count) {
    const path = [{ x: 0, y: 0 }];
    const turns = [0, 0, 45, 0, -45, 0, 0, 45, 0, -45, 0, 0];
    let heading = -Math.PI / 2;
    for (let index = 1; index < count; index += 1) {
      heading += turns[(index - 1) % turns.length] * Math.PI / 180;
      path.push({ x: path[index - 1].x + Math.cos(heading), y: path[index - 1].y + Math.sin(heading) });
    }
    return path;
  }

  seek(timeMs) {
    let low = 0;
    let high = this.events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.events[middle].time_ms < timeMs - GAME_CONFIG.judgment.fiftyMs) low = middle + 1;
      else high = middle;
    }
    this.nextIndex = low;
    this.gameOver = false;
    this.failedTimeMs = 0;
  }

  input() {
    if (this.gameOver || this.nextIndex >= this.events.length) return null;
    const event = this.events[this.nextIndex];
    const judgment = this.core.judge(event.time_ms);
    const distance = Math.abs(judgment.offsetMs);
    let label;
    if (distance <= GAME_CONFIG.judgment.perfectMs) label = "Perfect";
    else if (distance <= GAME_CONFIG.judgment.goodMs) label = judgment.timing === "early" ? "Early" : "Late";
    else if (distance <= GAME_CONFIG.judgment.fiftyMs) label = judgment.timing === "early" ? "Too Early" : "Too Late";
    else label = judgment.timing === "early" ? "Too Early" : "Too Late";

    const scored = { ...judgment, label, mode: "fire-ice" };
    if (distance > GAME_CONFIG.judgment.fiftyMs) {
      scored.value = "miss";
      this.core.record(scored);
      this.lastJudgment = label;
      if (!this.noFail()) {
        this.gameOver = true;
        this.failedTimeMs = event.time_ms;
        this.onJudgment(scored);
        this.onGameOver(scored);
        return scored;
      }
    } else {
      scored.value = distance <= GAME_CONFIG.judgment.perfectMs ? 300
        : distance <= GAME_CONFIG.judgment.goodMs ? 100 : 50;
      this.core.record(scored);
      this.lastJudgment = label;
    }
    this.nextIndex += 1;
    this.onJudgment(scored);
    this.onStep(this.nextIndex);
    return scored;
  }

  update(clockMs) {
    if (this.gameOver || this.nextIndex >= this.events.length) return;
    const event = this.events[this.nextIndex];
    if (clockMs > event.time_ms + GAME_CONFIG.judgment.fiftyMs) {
      const miss = { value: "miss", offsetMs: clockMs - event.time_ms, timing: "late", label: "Miss", mode: "fire-ice" };
      this.core.record(miss);
      this.lastJudgment = "Miss";
      if (!this.noFail()) {
        this.gameOver = true;
        this.failedTimeMs = event.time_ms;
        this.onJudgment(miss);
        this.onGameOver(miss);
        return;
      }
      this.nextIndex += 1;
      this.onJudgment(miss);
      this.onStep(this.nextIndex);
    }
  }

  draw(context, width, height, clockMs) {
    context.clearRect(0, 0, width, height);
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#11191d");
    background.addColorStop(.52, "#182225");
    background.addColorStop(1, "#21191c");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const beatIndex = clamp(this.nextIndex, 0, Math.max(0, this.events.length - 1));
    const previousBeatTime = beatIndex > 0 ? this.events[beatIndex - 1].time_ms : 0;
    const targetBeatTime = this.events[beatIndex]?.time_ms ?? previousBeatTime;
    const progress = clamp((clockMs - previousBeatTime) / Math.max(1, targetBeatTime - previousBeatTime), 0, 1);
    const plantedIndex = beatIndex;
    const planted = this.tiles[plantedIndex] || { x: 0, y: 0 };
    const landing = this.tiles[plantedIndex + 1] || planted;
    const previous = this.tiles[Math.max(0, plantedIndex - 1)] || planted;
    const startAngle = plantedIndex ? Math.atan2(previous.y - planted.y, previous.x - planted.x) : Math.atan2(planted.y - landing.y, planted.x - landing.x);
    const targetAngle = Math.atan2(landing.y - planted.y, landing.x - planted.x);
    let turn = targetAngle - startAngle;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const angle = startAngle + turn * progress;

    const tileSize = clamp(Math.min(width / 8, height / 4.8), 34, 66);
    const cameraX = planted.x + (landing.x - planted.x) * progress;
    const cameraY = planted.y + (landing.y - planted.y) * progress;
    const screen = (tile) => ({ x: width / 2 + (tile.x - cameraX) * tileSize, y: height / 2 + (tile.y - cameraY) * tileSize });
    const firstTile = Math.max(0, plantedIndex - 4);
    const lastTile = Math.min(this.tiles.length - 1, plantedIndex + 7);

    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(224,240,234,.28)";
    context.lineWidth = 3;
    context.beginPath();
    for (let index = firstTile; index <= lastTile; index += 1) {
      const point = screen(this.tiles[index]);
      if (index === firstTile) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();

    for (let index = firstTile; index <= lastTile; index += 1) {
      const point = screen(this.tiles[index]);
      const size = tileSize * .58;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(Math.PI / 4);
      context.fillStyle = index === plantedIndex + 1 ? "rgba(246,208,111,.28)" : "rgba(35,49,52,.96)";
      context.strokeStyle = index === plantedIndex + 1 ? "#f6d06f" : "rgba(190,211,204,.42)";
      context.lineWidth = index === plantedIndex + 1 ? 2.5 : 1.2;
      context.beginPath(); context.roundRect(-size / 2, -size / 2, size, size, 5); context.fill(); context.stroke();
      context.restore();
    }

    const pivot = screen(planted);
    const targetVector = screen(landing);
    const radius = Math.hypot(targetVector.x - pivot.x, targetVector.y - pivot.y);
    const moving = { x: pivot.x + Math.cos(angle) * radius, y: pivot.y + Math.sin(angle) * radius };
    const plantedColor = beatIndex % 2 ? ICE : FIRE;
    const movingColor = beatIndex % 2 ? FIRE : ICE;
    this.drawOrb(context, pivot.x, pivot.y, plantedColor, false);
    this.drawOrb(context, moving.x, moving.y, movingColor, true);

    this.drawProgress(context, width, this.core.audio.duration * 1000 ? clockMs / (this.core.audio.duration * 1000) : 0);
    if (this.gameOver) this.drawGameOver(context, width, height);
    else if (this.lastJudgment) this.drawJudgment(context, width, height);
  }

  drawOrb(context, x, y, color, moving) {
    context.save();
    context.shadowColor = color;
    context.shadowBlur = moving ? 22 : 11;
    const gradient = context.createRadialGradient(x - 5, y - 6, 2, x, y, 18);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(.28, color);
    gradient.addColorStop(1, color === FIRE ? "#662e28" : "#245562");
    context.fillStyle = gradient;
    context.beginPath(); context.arc(x, y, moving ? 14 : 11, 0, Math.PI * 2); context.fill();
    context.restore();
  }

  drawProgress(context, width, ratio) {
    const left = 14;
    const right = width - 14;
    context.fillStyle = "rgba(240,248,240,.16)";
    context.fillRect(left, 10, right - left, 4);
    context.fillStyle = "#f6d06f";
    context.fillRect(left, 10, (right - left) * clamp(ratio, 0, 1), 4);
  }

  drawJudgment(context, width, height) {
    context.textAlign = "center";
    context.fillStyle = this.lastJudgment === "Perfect" ? "#f6d06f" : "#f2f4ed";
    context.font = "600 12px DM Mono, monospace";
    context.fillText(this.lastJudgment.toUpperCase(), width / 2, height - 18);
    context.textAlign = "left";
  }

  drawGameOver(context, width, height) {
    context.fillStyle = "rgba(7,12,14,.78)";
    context.fillRect(0, 0, width, height);
    context.textAlign = "center";
    context.fillStyle = "#ff8268";
    context.font = "700 22px Space Grotesk, sans-serif";
    context.fillText("GAME OVER", width / 2, height / 2 - 8);
    context.fillStyle = "#d6dfda";
    context.font = "10px DM Mono, monospace";
    context.fillText("Restart the game or enable no-fail practice", width / 2, height / 2 + 15);
    context.textAlign = "left";
  }
}