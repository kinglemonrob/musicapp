const audio = document.querySelector("#audio");
const title = document.querySelector("#trackTitle");
const meta = document.querySelector("#trackMeta");
const list = document.querySelector("#trackList");
const progress = document.querySelector("#progress");
const visualizer = document.querySelector("#visualizer");
const visualizerShell = document.querySelector("#visualizerShell");
const dialog = document.querySelector("#settingsDialog");
const progressContext = progress.getContext("2d");
const visualContext = visualizer.getContext("2d");

const visualizerModes = [
  "Spectrum Bars", "Mirror Bars", "Waveform", "Dot Stack", "Pulse Bubbles",
  "Segment Meter", "Radial Burst", "Ripple Rings", "Twin Wave", "Stepped Wave",
  "Capsules", "Matrix", "Laser Scan", "Fireflies", "Spiral",
];
const progressStyles = [
  "SoundCloud Waveform", "Neon Rail", "Rainbow Fade", "Block Party", "Candy Dashes",
  "Dot Trail", "Laser Beam", "Wave Track", "Double Glow", "Glass Capsule", "Pixel Steps",
];
const presets = {
  "Neon Mint": ["#101a1b", "#52f2c2"], "Electric Blue": ["#101421", "#57b7ff"],
  Sunset: ["#21151b", "#ff8066"], Bubblegum: ["#1a1422", "#f276c6"],
  "Laser Lime": ["#131a10", "#b8ff45"], "Arctic Pop": ["#101a20", "#75f0ff"],
  "Coral Reef": ["#201512", "#ff725e"], "Grape Soda": ["#1a1220", "#c17aff"],
  Tangerine: ["#21170e", "#ffad42"], "Cotton Candy": ["#201321", "#ff8bd5"],
  "Deep Sea": ["#0d1921", "#28d7c4"], "Cherry Pop": ["#210f18", "#ff4f78"],
  "Golden Hour": ["#211c0e", "#ffe15c"], Ultraviolet: ["#171024", "#a68aff"],
  "Ice Cream": ["#17201d", "#a5f27a"],
};

const defaults = {
  visualizerStyle: visualizerModes[0], colorPreset: "Neon Mint", customColor: "#52f2c2",
  progressStyle: progressStyles[0], bars: 48, glow: 45, progressGlow: 45,
  rainbow: false, smooth: true, calm: true, volumeColor: true, showVisualizer: true,
};
let settings = { ...defaults };
try {
  settings = { ...defaults, ...JSON.parse(localStorage.getItem("local-player-settings") || "{}") };
} catch { /* Ignore invalid or unavailable browser storage. */ }

const queue = [];
const waveform = Array.from({ length: 180 }, () => 0.08);
const waveformSeen = Array.from({ length: waveform.length }, () => false);
let activeIndex = -1;
let activeFilter = "all";
let audioContext;
let analyser;
let volumeGain;
let sourceNode;
let frequencyData;
let timeData;
let animationFrame = 0;
let hueOffset = 0;
let dragProgress = false;
let lastWaveBin = -1;
let currentLevels = Array(settings.bars).fill(0);
let targetLevels = Array(settings.bars).fill(0);

const $ = (selector) => document.querySelector(selector);
const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
const accent = () => settings.rainbow ? `hsl(${(hueOffset + 160) % 360} 90% 65%)` : settings.customColor;

function populateSelect(element, options, selected) {
  element.replaceChildren(...options.map((value) => new Option(value, value)));
  element.value = options.includes(selected) ? selected : options[0];
}

function applyPreset(name) {
  if (presets[name]) {
    settings.colorPreset = name;
    settings.customColor = presets[name][1];
    document.documentElement.style.setProperty("--visual-bg", presets[name][0]);
    $("#customColor").value = settings.customColor;
  } else {
    settings.colorPreset = "Custom";
  }
  persistSettings();
}

function persistSettings() {
  try { localStorage.setItem("local-player-settings", JSON.stringify(settings)); } catch { /* Storage can be disabled in private browsing. */ }
}

function setupSettings() {
  populateSelect($("#visualizerStyle"), visualizerModes, settings.visualizerStyle);
  populateSelect($("#colorPreset"), [...Object.keys(presets), "Custom"], settings.colorPreset);
  populateSelect($("#progressStyle"), progressStyles, settings.progressStyle);
  $("#barCount").value = settings.bars;
  $("#barCountValue").value = settings.bars;
  $("#glow").value = settings.glow;
  $("#glowValue").value = `${settings.glow}%`;
  $("#progressGlow").value = settings.progressGlow;
  $("#progressGlowValue").value = `${settings.progressGlow}%`;
  $("#customColor").value = settings.customColor;
  for (const key of ["rainbow", "smooth", "calm", "volumeColor"]) $(`#${key}`).checked = settings[key];
  $("#showVisualizer").checked = settings.showVisualizer;
  visualizerShell.hidden = !settings.showVisualizer;
  if (presets[settings.colorPreset]) document.documentElement.style.setProperty("--visual-bg", presets[settings.colorPreset][0]);
  for (const [id, key] of [["visualizerStyle", "visualizerStyle"], ["progressStyle", "progressStyle"]]) {
    $(`#${id}`).addEventListener("change", (event) => { settings[key] = event.target.value; persistSettings(); });
  }
  $("#colorPreset").addEventListener("change", (event) => applyPreset(event.target.value));
  $("#customColor").addEventListener("input", (event) => {
    settings.customColor = event.target.value;
    settings.colorPreset = "Custom";
    $("#colorPreset").value = "Custom";
    persistSettings();
  });
  $("#barCount").addEventListener("input", (event) => {
    settings.bars = Number(event.target.value);
    currentLevels = Array(settings.bars).fill(0);
    targetLevels = Array(settings.bars).fill(0);
    $("#barCountValue").value = settings.bars;
    persistSettings();
  });
  for (const [id, key, output, suffix] of [
    ["glow", "glow", "glowValue", "%"], ["progressGlow", "progressGlow", "progressGlowValue", "%"],
  ]) {
    $(`#${id}`).addEventListener("input", (event) => {
      settings[key] = Number(event.target.value);
      $(`#${output}`).value = `${settings[key]}${suffix}`;
      persistSettings();
    });
  }
  for (const key of ["rainbow", "smooth", "calm", "volumeColor"]) {
    $(`#${key}`).addEventListener("change", (event) => { settings[key] = event.target.checked; persistSettings(); });
  }
  $("#showVisualizer").addEventListener("change", (event) => {
    settings.showVisualizer = event.target.checked;
    visualizerShell.hidden = !settings.showVisualizer;
    persistSettings();
  });
  $("#resetSettings").addEventListener("click", () => {
    settings = { ...defaults };
    currentLevels = Array(settings.bars).fill(0);
    targetLevels = Array(settings.bars).fill(0);
    $("#visualizerStyle").value = settings.visualizerStyle;
    $("#colorPreset").value = settings.colorPreset;
    $("#progressStyle").value = settings.progressStyle;
    $("#barCount").value = settings.bars;
    $("#barCountValue").value = settings.bars;
    $("#glow").value = settings.glow;
    $("#glowValue").value = `${settings.glow}%`;
    $("#progressGlow").value = settings.progressGlow;
    $("#progressGlowValue").value = `${settings.progressGlow}%`;
    $("#customColor").value = settings.customColor;
    for (const key of ["rainbow", "smooth", "calm", "volumeColor"]) $(`#${key}`).checked = settings[key];
    $("#showVisualizer").checked = settings.showVisualizer;
    visualizerShell.hidden = !settings.showVisualizer;
    document.documentElement.style.setProperty("--visual-bg", presets[settings.colorPreset][0]);
    persistSettings();
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function titleFor(file) { return file.name.replace(/\.[^.]+$/, ""); }

function addFiles(files) {
  const supported = files.map((entry) => entry instanceof File
    ? { file: entry, relativePath: entry.webkitRelativePath || entry.name }
    : entry).filter(({ file }) => file.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i.test(file.name));
  const newTracks = [];
  for (const entry of supported) {
    const duplicate = queue.some((track) => track.file.name === entry.file.name
      && track.file.size === entry.file.size
      && track.file.lastModified === entry.file.lastModified
      && track.relativePath === entry.relativePath);
    if (duplicate) continue;
    const track = {
      ...entry,
      url: URL.createObjectURL(entry.file),
      duration: null,
      category: "Scanning",
    };
    queue.push(track);
    newTracks.push(track);
  }
  sortQueue();
  renderQueue();
  if (activeIndex < 0 && queue.length) selectTrack(0);
  if (newTracks.length) {
    $("#scanStatus").textContent = `Checking duration for ${newTracks.length} audio ${newTracks.length === 1 ? "file" : "files"}...`;
    classifyTracks(newTracks);
  } else if (!supported.length) {
    $("#scanStatus").textContent = "No supported audio files found in that selection.";
  }
}

function sortQueue() {
  const activeTrack = queue[activeIndex];
  const order = { Music: 0, Scanning: 1, Other: 2 };
  queue.sort((a, b) => order[a.category] - order[b.category]
    || a.file.name.localeCompare(b.file.name));
  activeIndex = activeTrack ? queue.indexOf(activeTrack) : -1;
}

function readDuration(track) {
  return new Promise((resolve) => {
    const probe = new Audio();
    let finished = false;
    const finish = (duration) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      probe.removeAttribute("src");
      probe.load();
      resolve(Number.isFinite(duration) ? duration : null);
    };
    const timeout = setTimeout(() => finish(null), 10000);
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => finish(probe.duration), { once: true });
    probe.addEventListener("error", () => finish(null), { once: true });
    probe.src = track.url;
  });
}

async function classifyTracks(tracks) {
  let completed = 0;
  for (let start = 0; start < tracks.length; start += 6) {
    const batch = tracks.slice(start, start + 6);
    await Promise.all(batch.map(async (track) => {
      track.duration = await readDuration(track);
      track.category = track.duration !== null && track.duration >= 40 ? "Music" : "Other";
    }));
    sortQueue();
    renderQueue();
    completed += batch.length;
    $("#scanStatus").textContent = `Checked ${completed} of ${tracks.length} new audio files.`;
  }
}

async function readDirectory(directory, parentPath = "") {
  const files = [];
  for await (const [name, entry] of directory.entries()) {
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    if (entry.kind === "directory") {
      files.push(...await readDirectory(entry, relativePath));
    } else if (entry.kind === "file") {
      files.push({ file: await entry.getFile(), relativePath });
    }
  }
  return files;
}

async function chooseFolder() {
  if (window.showDirectoryPicker) {
    try {
      const directory = await window.showDirectoryPicker({ mode: "read" });
      $("#scanStatus").textContent = `Reading ${directory.name} and its subfolders...`;
      addFiles(await readDirectory(directory, directory.name));
    } catch (error) {
      if (error.name !== "AbortError") $("#scanStatus").textContent = "Could not read that folder. Check folder access and try again.";
    }
  } else if ("webkitdirectory" in $("#folderInput")) {
    $("#folderInput").click();
  } else {
    $("#scanStatus").textContent = "Folder scanning is not supported here. Use Add audio to select files.";
    $("#fileInput").click();
  }
}

function renderQueue() {
  list.replaceChildren();
  const counts = {
    all: queue.length,
    Music: queue.filter((track) => track.category === "Music").length,
    Other: queue.filter((track) => track.category === "Other").length,
  };
  $("#allCount").textContent = counts.all;
  $("#musicCount").textContent = counts.Music;
  $("#otherCount").textContent = counts.Other;
  for (const tab of document.querySelectorAll("[data-queue-filter]")) {
    const active = tab.dataset.queueFilter === activeFilter;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  }
  const visibleTracks = queue.map((track, index) => ({ track, index }))
    .filter(({ track }) => activeFilter === "all" || track.category === activeFilter);
  visibleTracks.forEach(({ track, index }, visibleIndex) => {
    const item = document.createElement("li");
    item.className = "track-item";
    item.tabIndex = 0;
    item.setAttribute("aria-current", String(index === activeIndex));
    const number = document.createElement("span");
    number.className = "track-index";
    number.textContent = String(visibleIndex + 1).padStart(2, "0");
    const copy = document.createElement("span");
    copy.className = "track-copy";
    const name = document.createElement("span");
    name.className = "track-title";
    name.textContent = titleFor(track.file);
    const detail = document.createElement("span");
    detail.className = "track-subtitle";
    const duration = track.duration === null
      ? (track.category === "Scanning" ? "checking length" : "length unavailable")
      : formatTime(track.duration);
    detail.textContent = `${track.relativePath}  ·  ${duration}  ·  ${Math.max(1, Math.round(track.file.size / 1048576))} MB`;
    const category = document.createElement("span");
    category.className = `track-category${track.category === "Other" ? " other" : track.category === "Scanning" ? " scanning" : ""}`;
    category.textContent = track.category;
    copy.append(name, detail, category);
    const remove = document.createElement("button");
    remove.className = "remove-track";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${titleFor(track.file)}`);
    remove.addEventListener("click", (event) => { event.stopPropagation(); removeTrack(index); });
    item.append(number, copy, remove);
    item.addEventListener("click", () => selectTrack(index));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectTrack(index); }
    });
    list.append(item);
  });
  $("#emptyQueue").hidden = visibleTracks.length > 0;
  $("#emptyQueue").querySelector("strong").textContent = queue.length ? "No files in this category" : "Your queue is empty";
  $("#emptyQueue").querySelector("span:last-child").textContent = queue.length ? "Choose another filter." : "Add audio or scan a folder.";
  $("#trackCount").textContent = `${queue.length} ${queue.length === 1 ? "track" : "tracks"}`;
}

function selectTrack(index) {
  if (index < 0 || index >= queue.length) return;
  activeIndex = index;
  const track = queue[index];
  audio.pause();
  audio.src = track.url;
  audio.load();
  title.textContent = titleFor(track.file);
  meta.textContent = track.file.webkitRelativePath || track.file.name;
  $("#playButton").disabled = false;
  waveform.fill(0.08);
  waveformSeen.fill(false);
  lastWaveBin = -1;
  renderQueue();
  drawProgress();
}

function removeTrack(index) {
  const wasActive = index === activeIndex;
  URL.revokeObjectURL(queue[index].url);
  queue.splice(index, 1);
  if (!queue.length) {
    audio.pause();
    audio.removeAttribute("src");
    activeIndex = -1;
    title.textContent = "Choose some music";
    meta.textContent = "Add audio files from your device to get started.";
    $("#playButton").disabled = true;
  } else if (wasActive) {
    activeIndex = -1;
    selectTrack(Math.min(index, queue.length - 1));
  } else if (index < activeIndex) {
    activeIndex -= 1;
  }
  renderQueue();
}

function changeTrack(step, autoplay = !audio.paused) {
  if (!queue.length) return;
  selectTrack((activeIndex + step + queue.length) % queue.length);
  if (autoplay) audio.play().catch(() => {});
}

async function prepareAnalyser() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    volumeGain = audioContext.createGain();
    volumeGain.gain.value = Number($("#volume").value) / 100;
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(volumeGain);
    volumeGain.connect(audioContext.destination);
    audio.volume = 1;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
  }
  if (audioContext.state === "suspended") await audioContext.resume();
}

function updateTempo() {
  const tempo = Number($("#tempo").value);
  const semitones = Number($("#transpose").value);
  audio.playbackRate = tempo / 100 * (2 ** (semitones / 12));
  $("#tempoValue").value = `${tempo}%`;
  $("#transposeValue").value = `${semitones} st`;
}

function canvasSize(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function drawProgress() {
  const { width, height } = canvasSize(progress, progressContext);
  const context = progressContext;
  const left = 7;
  const right = width - 7;
  const centerY = height / 2;
  const trackWidth = Math.max(1, right - left);
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const ratio = duration ? clamp(audio.currentTime / duration, 0, 1) : 0;
  const headX = left + trackWidth * ratio;
  const playedColor = settings.volumeColor
    ? `hsl(${Math.round(175 * (1 - Number($("#volume").value) / 100))} 82% 61%)`
    : accent();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#364146";
  context.beginPath(); context.roundRect(left, centerY - 2, trackWidth, 4, 2); context.fill();

  if (settings.progressStyle === "SoundCloud Waveform") {
    const gap = 1;
    const barWidth = Math.max(.7, (trackWidth - gap * waveform.length) / waveform.length);
    for (let index = 0; index < waveform.length; index += 1) {
      const x = left + index * (barWidth + gap);
      const barHeight = Math.max(2, waveform[index] * (height - 14));
      context.fillStyle = index / waveform.length <= ratio ? playedColor : (waveformSeen[index] ? "#536066" : "#303b40");
      context.beginPath();
      context.roundRect(x, centerY - barHeight / 2, barWidth, barHeight, 1);
      context.fill();
    }
    context.shadowColor = playedColor;
    context.shadowBlur = settings.progressGlow / 14;
    context.fillStyle = "#f8fff9";
    context.beginPath(); context.roundRect(headX - 1, centerY - 12, 2, 24, 1); context.fill();
    context.shadowBlur = 0;
  } else {
    context.save();
    context.shadowColor = playedColor;
    context.shadowBlur = settings.progressGlow / 9;
    if (settings.progressStyle === "Rainbow Fade") {
      const gradient = context.createLinearGradient(left, 0, right, 0);
      gradient.addColorStop(0, playedColor);
      gradient.addColorStop(1, `hsl(${(hueOffset + 275) % 360} 85% 65%)`);
      context.fillStyle = gradient;
    } else context.fillStyle = playedColor;
    context.beginPath();
    context.roundRect(left, centerY - 4, Math.max(0, trackWidth * ratio), 8, 4);
    context.fill();
    context.restore();
    context.save();
    context.beginPath(); context.rect(left, centerY - 8, Math.max(0, trackWidth * ratio), 16); context.clip();
    if (settings.progressStyle === "Block Party" || settings.progressStyle === "Pixel Steps") {
      context.fillStyle = playedColor;
      for (let x = left; x < headX; x += settings.progressStyle === "Pixel Steps" ? 8 : 11) {
        const w = settings.progressStyle === "Pixel Steps" ? 6 : 8;
        const h = 3 + ((Math.floor(x / 8) % 3) * 2);
        context.fillRect(x, centerY - h / 2, w, h);
      }
    } else if (settings.progressStyle === "Candy Dashes") {
      context.strokeStyle = "rgba(255,255,255,.65)"; context.lineWidth = 2;
      for (let x = left - 10; x < headX; x += 12) { context.beginPath(); context.moveTo(x, centerY + 4); context.lineTo(x + 8, centerY - 4); context.stroke(); }
    } else if (settings.progressStyle === "Dot Trail") {
      context.fillStyle = playedColor;
      for (let x = left + 3; x < headX; x += 11) { context.beginPath(); context.arc(x, centerY, 2.5, 0, Math.PI * 2); context.fill(); }
    } else if (settings.progressStyle === "Wave Track") {
      context.strokeStyle = "rgba(255,255,255,.75)"; context.lineWidth = 1.5; context.beginPath();
      for (let x = left; x < headX; x += 4) context.lineTo(x, centerY + Math.sin(x / 4) * 2.5);
      context.stroke();
    } else if (settings.progressStyle === "Double Glow") {
      context.clearRect(left, centerY - 1, Math.max(0, trackWidth * ratio), 2);
    } else if (settings.progressStyle === "Laser Beam") {
      context.fillStyle = "#fff"; context.fillRect(left, centerY - 1, Math.max(0, trackWidth * ratio), 2);
    } else if (settings.progressStyle === "Glass Capsule") {
      context.fillStyle = "rgba(255,255,255,.25)"; context.fillRect(left, centerY - 4, Math.max(0, trackWidth * ratio), 2);
    }
    context.restore();
    context.fillStyle = "#f5f5ec"; context.beginPath(); context.arc(headX, centerY, 4, 0, Math.PI * 2); context.fill();
  }
  progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
}

function colorAt(index, count) {
  return settings.rainbow ? `hsl(${(hueOffset + index * 360 / count) % 360} 88% 65%)` : accent();
}

function drawVisualizer() {
  const { width, height } = canvasSize(visualizer, visualContext);
  const context = visualContext;
  context.clearRect(0, 0, width, height);
  const background = presets[settings.colorPreset]?.[0] || "#101a1b";
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  const count = currentLevels.length;
  if (!count) return;
  const mid = height / 2;
  const glow = settings.glow / 12;

  function drawBar(x, y, w, h, color, radius = 2) {
    context.shadowColor = color;
    context.shadowBlur = glow;
    context.fillStyle = color;
    context.beginPath(); context.roundRect(x, y, Math.max(1, w), Math.max(1, h), radius); context.fill();
    context.shadowBlur = 0;
  }

  if (["Spectrum Bars", "Mirror Bars", "Capsules", "Segment Meter", "Matrix"].includes(settings.visualizerStyle)) {
    const gap = 3;
    const barWidth = Math.max(1, (width - gap * (count + 1)) / count);
    currentLevels.forEach((level, index) => {
      const x = gap + index * (barWidth + gap);
      const color = colorAt(index, count);
      if (settings.visualizerStyle === "Mirror Bars") {
        const barHeight = Math.max(1, level * (height / 2 - 4));
        drawBar(x, mid - barHeight, barWidth, barHeight, color, barWidth / 2);
        drawBar(x, mid, barWidth, barHeight, color, barWidth / 2);
      } else if (settings.visualizerStyle === "Segment Meter" || settings.visualizerStyle === "Matrix") {
        const rows = settings.visualizerStyle === "Matrix" ? 5 : 12;
        const active = Math.round(level * rows);
        for (let row = 0; row < active; row += 1) {
          const segmentH = (height - 10) / rows;
          drawBar(x, height - 5 - (row + 1) * segmentH, barWidth, segmentH - 2, colorAt(index + row, count), 1);
        }
      } else {
        const barHeight = Math.max(2, level * (height - 10));
        drawBar(x, height - barHeight - 5, barWidth, barHeight, color, settings.visualizerStyle === "Capsules" ? barWidth / 2 : 2);
      }
    });
  } else if (["Waveform", "Twin Wave", "Stepped Wave", "Laser Scan"].includes(settings.visualizerStyle)) {
    context.beginPath();
    currentLevels.forEach((level, index) => {
      const x = index * width / Math.max(1, count - 1);
      const y = settings.visualizerStyle === "Twin Wave" ? mid - level * mid * .9 : height - 4 - level * (height - 8);
      if (index === 0) context.moveTo(x, y);
      else if (settings.visualizerStyle === "Stepped Wave") { context.lineTo(x, context.currentY || mid); context.lineTo(x, y); }
      else context.lineTo(x, y);
      context.currentY = y;
    });
    context.strokeStyle = colorAt(Math.floor(count / 2), count);
    context.lineWidth = 2; context.shadowColor = context.strokeStyle; context.shadowBlur = glow; context.stroke(); context.shadowBlur = 0;
    if (settings.visualizerStyle === "Twin Wave") {
      context.beginPath();
      currentLevels.forEach((level, index) => {
        const x = index * width / Math.max(1, count - 1);
        const y = mid + level * mid * .9;
        if (!index) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.strokeStyle = colorAt(Math.floor(count * .7), count); context.stroke();
    } else if (settings.visualizerStyle === "Laser Scan") {
      context.beginPath(); context.moveTo(width * audio.currentTime / (audio.duration || 1), 0); context.lineTo(width * audio.currentTime / (audio.duration || 1), height);
      context.strokeStyle = colorAt(0, count); context.lineWidth = 2; context.stroke();
    }
  } else if (["Dot Stack", "Pulse Bubbles", "Fireflies"].includes(settings.visualizerStyle)) {
    const gap = width / count;
    currentLevels.forEach((level, index) => {
      const x = gap * (index + .5);
      const y = height - 5 - level * (height - 10);
      if (settings.visualizerStyle === "Dot Stack") {
        const dots = Math.round(level * 10);
        for (let dot = 0; dot < dots; dot += 1) drawBar(x - 2, height - 6 - dot * (height - 12) / 10, 4, 4, colorAt(index, count), 2);
      } else {
        const radius = 2 + level * 10;
        drawBar(x - radius, y - radius, radius * 2, radius * 2, colorAt(index, count), radius);
        if (settings.visualizerStyle === "Fireflies") { context.fillStyle = "#fff"; context.fillRect(x - 1, y - 1, 2, 2); }
      }
    });
  } else if (settings.visualizerStyle === "Radial Burst") {
    const inner = Math.min(width, height) * .12;
    currentLevels.forEach((level, index) => {
      const angle = index * Math.PI * 2 / count;
      context.beginPath(); context.moveTo(width / 2 + Math.cos(angle) * inner, mid + Math.sin(angle) * inner);
      const radius = inner + level * Math.min(width, height) * .34;
      context.lineTo(width / 2 + Math.cos(angle) * radius, mid + Math.sin(angle) * radius);
      context.strokeStyle = colorAt(index, count); context.lineWidth = 2; context.shadowColor = context.strokeStyle; context.shadowBlur = glow; context.stroke(); context.shadowBlur = 0;
    });
  } else if (settings.visualizerStyle === "Ripple Rings") {
    const energy = currentLevels.reduce((sum, value) => sum + value, 0) / count;
    for (let ring = 1; ring <= 5; ring += 1) {
      context.beginPath(); context.arc(width / 2, mid, Math.min(width, height) * ring / 12 * (.7 + energy * .3), 0, Math.PI * 2);
      context.strokeStyle = colorAt(ring, 5); context.lineWidth = 2; context.stroke();
    }
  } else if (settings.visualizerStyle === "Spiral") {
    context.beginPath();
    currentLevels.forEach((level, index) => {
      const angle = index * Math.PI * 5 / count;
      const radius = Math.min(width, height) * (index + level * 5) / count * .45;
      const x = width / 2 + Math.cos(angle) * radius;
      const y = mid + Math.sin(angle) * radius;
      if (!index) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.strokeStyle = accent(); context.lineWidth = 2; context.shadowColor = accent(); context.shadowBlur = glow; context.stroke(); context.shadowBlur = 0;
  }
}

function readAudio() {
  if (!analyser || audio.paused || audio.ended) {
    targetLevels = Array(settings.bars).fill(0);
    return;
  }
  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(timeData);
  targetLevels = Array.from({ length: settings.bars }, (_, index) => {
    const start = Math.floor(index * frequencyData.length / settings.bars);
    const end = Math.max(start + 1, Math.floor((index + 1) * frequencyData.length / settings.bars));
    const sum = frequencyData.slice(start, end).reduce((total, value) => total + value, 0);
    return clamp(sum / (end - start) / 170, 0, 1);
  });
  const duration = audio.duration || 0;
  if (duration > 0) {
    const bin = Math.min(waveform.length - 1, Math.floor(audio.currentTime / duration * waveform.length));
    if (bin !== lastWaveBin) {
      const rms = Math.sqrt(timeData.reduce((total, sample) => total + ((sample - 128) / 128) ** 2, 0) / timeData.length);
      waveform[bin] = clamp(rms * 2.2, .08, 1);
      waveformSeen[bin] = true;
      lastWaveBin = bin;
    }
  }
}

function animate() {
  hueOffset = (hueOffset + .35) % 360;
  readAudio();
  const decay = audio.paused && settings.calm ? .88 : .22;
  currentLevels = currentLevels.map((current, index) => {
    if (audio.paused && !settings.calm) return current;
    const target = targetLevels[index] || 0;
    return settings.smooth ? current + (target - current) * (target > current ? .22 : decay) : target;
  });
  if (settings.showVisualizer) drawVisualizer();
  drawProgress();
  animationFrame = requestAnimationFrame(animate);
}

function seekAt(clientX) {
  if (!Number.isFinite(audio.duration) || !audio.duration) return;
  const rect = progress.getBoundingClientRect();
  audio.currentTime = clamp((clientX - rect.left) / rect.width, 0, 1) * audio.duration;
  drawProgress();
}

$("#addFilesButton").addEventListener("click", () => $("#fileInput").click());
$("#addFolderButton").addEventListener("click", chooseFolder);
$("#fileInput").addEventListener("change", (event) => { addFiles([...event.target.files]); event.target.value = ""; });
$("#folderInput").addEventListener("change", (event) => {
  addFiles([...event.target.files]);
  event.target.value = "";
});
for (const tab of document.querySelectorAll("[data-queue-filter]")) {
  tab.addEventListener("click", () => {
    activeFilter = tab.dataset.queueFilter;
    renderQueue();
  });
}
$("#playButton").addEventListener("click", async () => {
  if (audio.paused) {
    await prepareAnalyser();
    audio.playbackRate = Number($("#tempo").value) / 100 * (2 ** (Number($("#transpose").value) / 12));
    await audio.play();
  } else audio.pause();
});
$("#stopButton").addEventListener("click", () => { audio.pause(); audio.currentTime = 0; targetLevels = Array(settings.bars).fill(0); lastWaveBin = -1; });
$("#previousButton").addEventListener("click", () => changeTrack(-1));
$("#nextButton").addEventListener("click", () => changeTrack(1));
audio.addEventListener("play", () => { $("#playButton").textContent = "Pause"; $("#playButton").setAttribute("aria-label", "Pause"); });
audio.addEventListener("pause", () => { $("#playButton").textContent = "Play"; $("#playButton").setAttribute("aria-label", "Play"); });
audio.addEventListener("ended", () => changeTrack(1, true));
audio.addEventListener("loadedmetadata", () => { $("#duration").textContent = formatTime(audio.duration); drawProgress(); });
audio.addEventListener("timeupdate", () => { $("#currentTime").textContent = formatTime(audio.currentTime); drawProgress(); });
$("#volume").addEventListener("input", (event) => {
  const volume = Number(event.target.value) / 100;
  audio.volume = volumeGain ? 1 : volume;
  if (volumeGain && audioContext) volumeGain.gain.setTargetAtTime(volume, audioContext.currentTime, .015);
  $("#volumeValue").value = `${event.target.value}%`;
});
audio.volume = .7;
audio.preservesPitch = false;
if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = false;
$("#tempo").addEventListener("input", updateTempo);
$("#transpose").addEventListener("input", updateTempo);
progress.addEventListener("pointerdown", (event) => { dragProgress = true; progress.setPointerCapture(event.pointerId); seekAt(event.clientX); });
progress.addEventListener("pointermove", (event) => { if (dragProgress) seekAt(event.clientX); });
progress.addEventListener("pointerup", (event) => { if (dragProgress) seekAt(event.clientX); dragProgress = false; });
progress.addEventListener("pointercancel", () => { dragProgress = false; });
progress.addEventListener("keydown", (event) => {
  if (!audio.duration) return;
  if (event.key === "ArrowRight") audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  else if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (event.key === "Home") audio.currentTime = 0;
  else if (event.key === "End") audio.currentTime = audio.duration;
  else return;
  event.preventDefault();
});
for (const button of [$("#settingsButton"), $("#settingsButtonSmall")]) button.addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
window.addEventListener("resize", () => { drawProgress(); drawVisualizer(); });
window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame));

setupSettings();
$("#volume").dispatchEvent(new Event("input"));
updateTempo();
renderQueue();
animate();
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}