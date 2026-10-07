import { GAME_CONFIG } from "./game-core.js";

const PALETTE = ["#62edc3", "#ff8268", "#ffd06a", "#77d5ff"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class OsuMode {
  constructor(core, onJudgment = () => {}) {
    this.core = core;
    this.onJudgment = onJudgment;
    this.objects = [];
    this.activeSlider = null;
    this.spinner = null;
    this.spinnerAngle = 0;
    this.pointerAngle = null;
    this.pointerDown = false;
    this.particles = [];
  }

  load(analysis) {
    const events = this.core.filteredEvents();
    this.objects = this.makeObjects(events);
    this.activeSlider = null;
    this.spinner = null;
    this.particles = [];
  }

  makeObjects(events) {
    const positions = this.flowingPositions(events.length);
    const objects = events.map((event, index) => {
      const next = events[index + 1];
      const gap = next ? next.time_ms - event.time_ms : 0;
      const slider = index % 8 === 5 && next && gap >= 420 && gap <= 1_050;
      return {
        id: index,
        type: slider ? "slider" : "circle",
        timeMs: event.time_ms,
        endTimeMs: slider ? next.time_ms : event.time_ms,
        strength: event.strength || .5,
        x: positions[index].x,
        y: positions[index].y,
        endX: slider ? positions[index + 1].x : positions[index].x,
        endY: slider ? positions[index + 1].y : positions[index].y,
        number: index % 16 + 1,
        newCombo: index > 0 && index % 16 === 0,
        color: PALETTE[Math.floor(index / 16) % PALETTE.length],
        judged: false,
      };
    });
    for (let index = 0; index < events.length - 1; index += 1) {
      const gap = events[index + 1].time_ms - events[index].time_ms;
      if (gap > 1_900) {
        const startMs = events[index].time_ms + 180;
        const endMs = events[index + 1].time_ms - 180;
        if (endMs - startMs > 700) {
          objects.push({ id: `spinner-${index}`, type: "spinner", timeMs: startMs, startMs, endMs, judged: false });
        }
      }
    }
    return objects.sort((left, right) => left.timeMs - right.timeMs);
  }

  flowingPositions(count) {
    const positions = [];
    let x = .5;
    let y = .5;
    let angle = -Math.PI / 2;
    for (let index = 0; index < count; index += 1) {
      if (index) {
        angle += (Math.sin(index * 1.7) * .68) + (index % 4 === 0 ? .9 : 0);
        const step = .13 + (index % 3) * .018;
        x += Math.cos(angle) * step;
        y += Math.sin(angle) * step;
        if (x < .14 || x > .86) { angle = Math.PI - angle; x = clamp(x, .14, .86); }
        if (y < .17 || y > .83) { angle = -angle; y = clamp(y, .17, .83); }
      }
      positions.push({ x, y });
    }
    return positions;
  }

  seek(timeMs) {
    this.objects.forEach((object) => { object.judged = object.timeMs < timeMs - 160; });
    this.activeSlider = null;
    this.spinner = null;
  }

  pointerMove(x, y, width, height, clockMs) {
    if (this.spinner && this.pointerDown) {
      const angle = Math.atan2(y - this.spinner.cy, x - this.spinner.cx);
      if (this.pointerAngle !== null) {
        let delta = angle - this.pointerAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        this.spinnerAngle += Math.abs(delta);
      }
      this.pointerAngle = angle;
    }
    if (this.activeSlider && this.pointerDown) this.activeSlider.lastMoveMs = clockMs;
  }

  pointerDownAt(x, y, width, height, clockMs) {
    this.pointerDown = true;
    this.pointerAngle = null;
    const spinner = this.objects.find((object) => object.type === "spinner" && !object.judged && clockMs >= object.startMs && clockMs <= object.endMs);
    if (spinner) {
      this.spinner = { ...spinner, cx: width / 2, cy: height / 2 };
      this.spinnerAngle = 0;
      return;
    }
    const active = this.objects.filter((object) => !object.judged && object.timeMs - GAME_CONFIG.approachMs <= clockMs);
    const hit = active.reduce((nearest, object) => {
      const centerX = object.x * width;
      const centerY = object.y * height;
      const distance = Math.hypot(x - centerX, y - centerY);
      return !nearest || distance < nearest.distance ? { object, distance } : nearest;
    }, null);
    if (!hit || hit.distance > Math.min(width, height) * .055) return;
    const judgment = this.core.judge(hit.object.timeMs, clockMs);
    if (judgment.value === "miss") return;
    hit.object.judged = true;
    this.core.record(judgment);
    this.burst(hit.object.x * width, hit.object.y * height, hit.object.color);
    if (hit.object.type === "slider") this.activeSlider = { object: hit.object, lastMoveMs: clockMs };
    this.onJudgment({ ...judgment, mode: "osu" });
  }

  pointerUp(clockMs) {
    this.pointerDown = false;
    this.pointerAngle = null;
    if (this.activeSlider && clockMs < this.activeSlider.object.endTimeMs - 100) {
      this.core.record({ value: "miss", offsetMs: 0, timing: "late" });
      this.activeSlider.object.judged = true;
      this.onJudgment({ value: "miss", mode: "osu" });
    }
    this.activeSlider = null;
  }

  keyDown(clockMs) {
    if (this.spinner) return;
    const next = this.objects.find((object) => !object.judged && object.timeMs - GAME_CONFIG.approachMs <= clockMs);
    if (next && next.type !== "slider" && next.type !== "spinner") {
      this.pointerDownAt(next.x * 1000, next.y * 1000, 1000, 1000, clockMs);
      this.pointerDown = false;
    }
  }

  update(clockMs, width, height) {
    for (const object of this.objects) {
      if (object.type !== "spinner" && !object.judged && clockMs > object.timeMs + GAME_CONFIG.judgment.fiftyMs) {
        object.judged = true;
        this.core.record({ value: "miss", offsetMs: clockMs - object.timeMs, timing: "late" });
        this.onJudgment({ value: "miss", mode: "osu" });
      }
    }
    const spinner = this.objects.find((object) => object.type === "spinner" && !object.judged && clockMs >= object.startMs && clockMs <= object.endMs);
    if (spinner && !this.spinner) this.spinner = { ...spinner, cx: width / 2, cy: height / 2 };
    if (this.spinner && clockMs >= this.spinner.endMs) {
      const revolutions = this.spinnerAngle / (Math.PI * 2);
      const value = revolutions >= 1.5 ? 300 : revolutions >= 1 ? 100 : "miss";
      this.core.record({ value, offsetMs: 0, timing: "perfect" });
      this.spinner.judged = true;
      this.onJudgment({ value, mode: "osu-spinner" });
      this.spinner = null;
    }
    if (this.activeSlider && clockMs >= this.activeSlider.object.endTimeMs) this.activeSlider = null;
    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life -= .025;
    });
  }

  burst(x, y, color) {
    for (let index = 0; index < 14; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .7, color });
    }
  }

  draw(context, width, height, clockMs) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#10171b";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width, height);
    const radius = clamp(scale * .027, 15, 25);
    const visible = this.objects.filter((object) => object.type !== "spinner" && !object.judged && object.timeMs - GAME_CONFIG.approachMs <= clockMs && object.timeMs + 160 >= clockMs);
    const slider = visible.find((object) => object.type === "slider");
    if (slider) this.drawSlider(context, slider, width, height, radius, clockMs);
    const current = [...visible].reverse();
    current.forEach((object) => this.drawCircle(context, object, width, height, radius, clockMs));
    const activeSpinner = this.objects.find((object) => object.type === "spinner" && !object.judged && clockMs >= object.startMs && clockMs <= object.endMs);
    if (activeSpinner) this.drawSpinner(context, width, height, clockMs);
    for (const particle of this.particles) {
      context.globalAlpha = clamp(particle.life, 0, 1);
      context.fillStyle = particle.color;
      context.beginPath(); context.arc(particle.x, particle.y, 2 + particle.life * 2, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 1;
  }

  drawCircle(context, object, width, height, radius, clockMs) {
    const x = object.x * width;
    const y = object.y * height;
    const remaining = clamp((object.timeMs - clockMs) / GAME_CONFIG.approachMs, 0, 1);
    const approach = radius * (1 + remaining * 2.4);
    context.save();
    if (object.newCombo) {
      context.fillStyle = "rgba(246,248,237,.9)";
      context.beginPath(); context.arc(x, y, radius + 4, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = .8;
    context.strokeStyle = object.color;
    context.lineWidth = 3;
    context.shadowColor = object.color;
    context.shadowBlur = 10;
    context.beginPath(); context.arc(x, y, approach, 0, Math.PI * 2); context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = object.color;
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
    context.fillStyle = "rgba(12,18,21,.75)";
    context.beginPath(); context.arc(x, y, radius - 4, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#f7f8ef";
    context.font = `700 ${Math.round(radius * .95)}px Space Grotesk, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(object.number), x, y + 1);
    context.restore();
  }

  drawSlider(context, object, width, height, radius, clockMs) {
    const x1 = object.x * width;
    const y1 = object.y * height;
    const x2 = object.endX * width;
    const y2 = object.endY * height;
    context.save();
    context.strokeStyle = "rgba(255,255,255,.78)";
    context.lineWidth = radius * 1.6;
    context.lineCap = "round";
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
    const progress = clamp((clockMs - object.timeMs) / Math.max(1, object.endTimeMs - object.timeMs), 0, 1);
    const ballX = x1 + (x2 - x1) * progress;
    const ballY = y1 + (y2 - y1) * progress;
    context.fillStyle = "#f6cf69";
    context.shadowColor = "#f6cf69";
    context.shadowBlur = 16;
    context.beginPath(); context.arc(ballX, ballY, radius * .42, 0, Math.PI * 2); context.fill();
    context.restore();
  }

  drawSpinner(context, width, height, clockMs) {
    const x = width / 2;
    const y = height / 2;
    const radius = Math.min(width, height) * .22;
    context.save();
    context.translate(x, y);
    context.strokeStyle = "rgba(255,130,104,.8)";
    context.lineWidth = 4;
    context.setLineDash([8, 8]);
    context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);
    context.rotate(this.spinnerAngle);
    context.strokeStyle = "#ff8268";
    context.lineWidth = 7;
    context.beginPath(); context.moveTo(-radius, 0); context.lineTo(radius, 0); context.stroke();
    context.fillStyle = "#f4f5ec";
    context.beginPath(); context.arc(radius, 0, 7, 0, Math.PI * 2); context.fill();
    context.restore();
    context.fillStyle = "#f2f4ee";
    context.font = "600 12px DM Mono, monospace";
    context.textAlign = "center";
    context.fillText("SPIN!", x, y + radius + 28);
  }
}