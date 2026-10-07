"""Local beat analysis with a Windows-safe NumPy path."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import tempfile
import wave
from io import BytesIO
from pathlib import Path

import librosa
import numpy as np


LOGGER = logging.getLogger(__name__)
CACHE_DIR = Path(__file__).parent / ".beat-cache"
ANALYSIS_VERSION = 2
TARGET_SAMPLE_RATE = 22_050
FRAME_LENGTH = 2_048
HOP_LENGTH = 512


def analyze_audio(data: bytes, filename: str) -> dict:
    """Analyze an upload and cache only its compact beat JSON."""
    audio_hash = hashlib.sha256(data).hexdigest()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{audio_hash}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("analysis_version") == ANALYSIS_VERSION:
                return cached
        except (OSError, json.JSONDecodeError):
            LOGGER.warning("Ignoring invalid beat cache %s", cache_path.name)

    if platform.system() == "Windows":
        result = _analyze_wav_numpy(data)
        detector = "numpy-spectral-flux-wav"
    else:
        try:
            result = _analyze_with_librosa(data, Path(filename).suffix.lower())
            detector = "librosa"
        except Exception as error:
            LOGGER.warning("librosa analysis failed; using WAV spectral flux: %s", error)
            result = _analyze_wav_numpy(data)
            detector = "numpy-spectral-flux-wav"

    result.update({"analysis_version": ANALYSIS_VERSION, "audio_hash": audio_hash, "detector": detector})
    _write_cache(cache_path, result)
    return result


def _analyze_with_librosa(data: bytes, suffix: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=suffix or ".audio", delete=False) as audio_file:
        audio_file.write(data)
        audio_path = audio_file.name
    try:
        samples, sample_rate = librosa.load(audio_path, sr=TARGET_SAMPLE_RATE, mono=True)
        if samples.size == 0:
            raise ValueError("The uploaded audio is empty.")
        onset_envelope = librosa.onset.onset_strength(y=samples, sr=sample_rate, hop_length=HOP_LENGTH)
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_envelope,
            sr=sample_rate,
            hop_length=HOP_LENGTH,
            trim=False,
        )
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_envelope,
            sr=sample_rate,
            hop_length=HOP_LENGTH,
            backtrack=False,
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=HOP_LENGTH)
        onset_times = librosa.frames_to_time(onset_frames, sr=sample_rate, hop_length=HOP_LENGTH)
        bpm = float(np.asarray(tempo).reshape(-1)[0]) if np.size(tempo) else 0.0
        return _format_events(beat_times, onset_times, onset_envelope, sample_rate, len(samples) / sample_rate, bpm)
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            LOGGER.warning("Could not remove temporary audio file %s", audio_path)


def _analyze_wav_numpy(data: bytes) -> dict:
    try:
        with wave.open(BytesIO(data), "rb") as source:
            channel_count = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frame_count = source.getnframes()
            raw = source.readframes(frame_count)
    except (wave.Error, EOFError) as error:
        raise ValueError("This local backend supports PCM WAV; other formats use browser analysis.") from error

    if sample_width == 1:
        samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif sample_width == 2:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif sample_width == 3:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        values = packed[:, 0] | (packed[:, 1] << 8) | (packed[:, 2] << 16)
        samples = ((values ^ 0x800000) - 0x800000).astype(np.float32) / 8_388_608
    elif sample_width == 4:
        samples = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2_147_483_648
    else:
        raise ValueError("Unsupported WAV sample width.")

    samples = samples.reshape(-1, channel_count).mean(axis=1)
    duration = len(samples) / sample_rate if sample_rate else 0
    stride = max(1, round(sample_rate / TARGET_SAMPLE_RATE))
    samples = samples[::stride]
    analysis_rate = sample_rate / stride
    if len(samples) < FRAME_LENGTH:
        samples = np.pad(samples, (0, FRAME_LENGTH - len(samples)))

    frame_count = 1 + (len(samples) - FRAME_LENGTH) // HOP_LENGTH
    starts = np.arange(frame_count) * HOP_LENGTH
    offsets = np.arange(FRAME_LENGTH)
    window = np.hanning(FRAME_LENGTH).astype(np.float32)
    flux = np.zeros(frame_count, dtype=np.float32)
    previous = None
    for batch_start in range(0, frame_count, 512):
        batch = starts[batch_start:batch_start + 512]
        frames = samples[batch[:, None] + offsets[None, :]] * window
        spectrum = np.abs(np.fft.rfft(frames, axis=1))
        if previous is not None:
            spectrum = np.vstack((previous[None, :], spectrum))
            flux[batch_start:batch_start + len(batch)] = np.maximum(0, np.diff(spectrum, axis=0)).sum(axis=1)
        else:
            flux[batch_start] = 0
            flux[batch_start + 1:batch_start + len(batch)] = np.maximum(0, np.diff(spectrum, axis=0)).sum(axis=1)
        previous = spectrum[-1]

    smoothed = np.convolve(flux, np.ones(5, dtype=np.float32) / 5, mode="same")
    baseline = np.convolve(smoothed, np.ones(31, dtype=np.float32) / 31, mode="same")
    weak_threshold = max(float(np.percentile(smoothed, 35)), 1e-6)
    strong_threshold = max(float(np.percentile(smoothed, 60)), 1e-6)
    refractory = max(1, round(.14 * analysis_rate / HOP_LENGTH))
    peaks = []
    beats = []
    last_peak = -refractory
    for index in range(2, len(smoothed) - 2):
        is_peak = smoothed[index] >= max(smoothed[index - 2:index + 3])
        if is_peak and smoothed[index] > max(weak_threshold, baseline[index] * 1.05):
            if index - last_peak >= refractory:
                peaks.append(index)
                last_peak = index
                if smoothed[index] > max(strong_threshold, baseline[index] * 1.35):
                    beats.append(index)
    if not peaks and smoothed.size and smoothed.max() > 0:
        peaks = [int(np.argmax(smoothed))]
    if not beats:
        beats = peaks[::2]

    bpm = _estimate_bpm(smoothed, analysis_rate)
    onset_times = np.asarray(peaks, dtype=np.float64) * HOP_LENGTH / analysis_rate
    onset_strengths = _normalize(smoothed[peaks]) if peaks else []
    beat_times = np.asarray(beats, dtype=np.float64) * HOP_LENGTH / analysis_rate
    beat_strengths = _normalize(smoothed[beats]) if beats else []
    onset_events = [
        {"time_ms": round(float(time) * 1000), "strength": round(float(strength), 4), "kind": "onset"}
        for time, strength in zip(onset_times, onset_strengths)
    ]
    beat_events = [
        {"time_ms": round(float(time) * 1000), "strength": round(float(strength), 4), "kind": "beat"}
        for time, strength in zip(beat_times, beat_strengths)
    ]
    return {"beats": beat_events, "onsets": onset_events, "bpm": round(bpm, 2), "duration_ms": round(duration * 1000)}


def _estimate_bpm(envelope: np.ndarray, sample_rate: float) -> float:
    if len(envelope) < 4 or not np.any(envelope):
        return 0.0
    centered = envelope - envelope.mean()
    correlation = np.fft.irfft(np.abs(np.fft.rfft(centered, n=2 * len(centered))) ** 2)
    minimum = max(1, round(.3 * sample_rate / HOP_LENGTH))
    maximum = min(len(correlation) - 1, round(1.5 * sample_rate / HOP_LENGTH))
    if maximum < minimum:
        return 0.0
    lag = minimum + int(np.argmax(correlation[minimum:maximum + 1]))
    bpm = 60 * sample_rate / (lag * HOP_LENGTH)
    return bpm * 2 if bpm < 60 else bpm / 2 if bpm > 180 else bpm


def _format_events(beat_times, onset_times, envelope, sample_rate, duration, bpm) -> dict:
    strengths = np.asarray(envelope, dtype=np.float32)
    events = [(float(time), "beat") for time in beat_times]
    events.extend((float(time), "onset") for time in onset_times)
    events.sort()
    merged = []
    for time, kind in events:
        if merged and time - merged[-1][0] <= .055:
            if kind == "beat":
                merged[-1] = (merged[-1][0], "beat")
        else:
            merged.append((time, kind))
    frame_indexes = [min(len(strengths) - 1, round(time * sample_rate / HOP_LENGTH)) for time, _ in merged]
    event_strengths = _normalize(strengths[frame_indexes]) if frame_indexes and len(strengths) else []
    beats = []
    onsets = []
    for (time, kind), strength in zip(merged, event_strengths):
        event = {"time_ms": round(time * 1000), "strength": round(float(strength), 4), "kind": kind}
        (beats if kind == "beat" else onsets).append(event)
    return {
        "beats": beats,
        "onsets": onsets,
        "bpm": round(float(bpm), 2),
        "duration_ms": round(duration * 1000),
    }


def _normalize(values) -> list[float]:
    values = np.asarray(values, dtype=np.float32)
    if not values.size:
        return []
    scale = float(np.percentile(values, 95)) or float(values.max()) or 1.0
    return np.clip(values / scale, 0, 1).tolist()


def _write_cache(cache_path: Path, result: dict) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=cache_path.parent, delete=False) as handle:
        json.dump(result, handle, separators=(",", ":"))
        temporary_path = Path(handle.name)
    os.replace(temporary_path, cache_path)