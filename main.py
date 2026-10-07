import os
import math
import struct
import sys

from PyQt6.QtCore import QPointF, QRectF, QStandardPaths, QTimer, QUrl, Qt
from PyQt6.QtGui import QColor, QLinearGradient, QPainter, QPainterPath, QPen
from PyQt6.QtMultimedia import (
    QAudioBuffer,
    QAudioBufferOutput,
    QAudioFormat,
    QAudioOutput,
    QMediaPlayer,
)
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QColorDialog,
    QComboBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QPushButton,
    QSlider,
    QVBoxLayout,
    QWidget,
)


class CustomSeekBar(QSlider):
    STYLES = (
        "SoundCloud Waveform",
        "Rainbow Fade",
        "Block Party",
        "Candy Dashes",
        "Dot Trail",
        "Laser Beam",
        "Wave Track",
        "Double Glow",
        "Glass Capsule",
        "Pixel Steps",
    )

    def __init__(self, parent=None):
        super().__init__(Qt.Orientation.Horizontal, parent)
        self.visual_style = self.STYLES[0]
        self.volume_level = 0.7
        self.volume_reactive = True
        self.progress_color = "#52f2c2"
        self.glow = 45
        self._dragging = False
        self.waveform_levels = [0.08] * 180
        self.waveform_revealed = [False] * len(self.waveform_levels)
        self.setMinimumHeight(28)
        self.setMaximumHeight(38)

    def reset_waveform(self):
        self.waveform_levels = [0.08] * len(self.waveform_levels)
        self.waveform_revealed = [False] * len(self.waveform_levels)
        self.update()

    def record_audio_levels(self, levels, position_ms, duration_ms, frame_count, sample_rate):
        if duration_ms <= 0 or sample_rate <= 0 or not levels:
            return
        bin_count = len(self.waveform_levels)
        start = min(bin_count - 1, int(position_ms / duration_ms * bin_count))
        chunk_ms = frame_count / sample_rate * 1000
        bin_span = max(1, round(chunk_ms / duration_ms * bin_count))
        for offset in range(bin_span):
            index = start + offset
            if index >= bin_count:
                break
            level_index = min(len(levels) - 1, offset * len(levels) // bin_span)
            self.waveform_levels[index] = max(0.08, levels[level_index])
            self.waveform_revealed[index] = True
        self.update()

    def set_visual_style(self, style):
        self.visual_style = style
        self.update()

    def set_volume_level(self, level):
        self.volume_level = max(0.0, min(1.0, level))
        self.update()

    def set_volume_reactive(self, enabled):
        self.volume_reactive = enabled
        self.update()

    def set_progress_color(self, color):
        self.progress_color = color
        self.update()

    def set_glow(self, amount):
        self.glow = amount
        self.update()

    def current_color(self):
        if self.volume_reactive:
            hue = round(175 * (1 - self.volume_level))
            return QColor.fromHsv(hue, 220, 255)
        return QColor(self.progress_color)

    def _set_value_from_x(self, x):
        track_width = max(1, self.width() - 16)
        ratio = max(0.0, min(1.0, (x - 8) / track_width))
        value = round(ratio * self.maximum())
        self.setValue(value)
        self.sliderMoved.emit(value)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._dragging = True
            self.sliderPressed.emit()
            self._set_value_from_x(event.position().x())
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._dragging:
            self._set_value_from_x(event.position().x())
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._dragging and event.button() == Qt.MouseButton.LeftButton:
            self._set_value_from_x(event.position().x())
            self._dragging = False
            self.sliderReleased.emit()
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        track = QRectF(8, self.height() / 2 - 4, max(1, self.width() - 16), 8)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#343b40"))
        painter.drawRoundedRect(track, 4, 4)

        progress_width = track.width() * self.value() / max(1, self.maximum())
        if progress_width <= 0:
            event.accept()
            return

        progress = QRectF(track.left(), track.top(), progress_width, track.height())
        color = self.current_color()

        if self.visual_style == "SoundCloud Waveform":
            played_index = int(self.value() / max(1, self.maximum()) * len(self.waveform_levels))
            bar_gap = 1
            bar_width = max(1, (track.width() - bar_gap * len(self.waveform_levels)) / len(self.waveform_levels))
            center_y = track.center().y()
            for index, amplitude in enumerate(self.waveform_levels):
                x = track.left() + index * (bar_width + bar_gap)
                bar_height = max(2, amplitude * (self.height() - 6))
                bar = QRectF(x, center_y - bar_height / 2, bar_width, bar_height)
                if index <= played_index:
                    bar_color = color.lighter(100 + index % 3 * 12)
                    if self.glow and self.waveform_revealed[index]:
                        glow = QColor(bar_color)
                        glow.setAlpha(int(100 * self.glow / 100))
                        painter.setPen(Qt.PenStyle.NoPen)
                        painter.setBrush(glow)
                        painter.drawRoundedRect(bar.adjusted(-1, -2, 1, 2), 2, 2)
                else:
                    bar_color = QColor("#465159" if self.waveform_revealed[index] else "#303a40")
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(bar_color)
                painter.drawRoundedRect(bar, 1, 1)
            playhead_x = min(track.right(), max(track.left(), progress.right()))
            painter.setBrush(QColor("#ffffff"))
            painter.drawRoundedRect(QRectF(playhead_x - 1, track.top() - 7, 2, track.height() + 14), 1, 1)
            event.accept()
            return

        if self.glow and self.visual_style in ("Neon Rail", "Laser Beam", "Double Glow"):
            for spread, opacity in ((12, 0.06), (7, 0.13), (3, 0.2)):
                glow = QColor(color)
                glow.setAlpha(int(255 * opacity * self.glow / 45))
                painter.setBrush(glow)
                painter.drawRoundedRect(progress.adjusted(0, -spread / 2, 0, spread / 2), 6, 6)

        if self.visual_style == "Rainbow Fade":
            gradient = QLinearGradient(progress.topLeft(), progress.topRight())
            gradient.setColorAt(0, color.darker(125))
            gradient.setColorAt(0.5, color)
            gradient.setColorAt(1, color.lighter(160))
            painter.setBrush(gradient)
            painter.drawRoundedRect(progress, 4, 4)
        elif self.visual_style == "Block Party":
            block_gap = 3
            block_width = 8
            for x in range(int(progress.left()), int(progress.right()), block_width + block_gap):
                block_color = QColor(color).lighter(100 + (x // (block_width + block_gap)) % 4 * 18)
                painter.setBrush(block_color)
                painter.drawRoundedRect(QRectF(x, progress.top(), min(block_width, progress.right() - x), progress.height()), 2, 2)
        elif self.visual_style == "Candy Dashes":
            painter.save()
            painter.setClipRect(progress)
            painter.setBrush(color)
            painter.drawRoundedRect(progress, 4, 4)
            painter.setPen(QPen(QColor(255, 255, 255, 120), 3))
            for x in range(int(progress.left()) - 8, int(progress.right()) + 8, 12):
                painter.drawLine(x, int(progress.bottom()), x + 12, int(progress.top()))
            painter.restore()
        elif self.visual_style == "Dot Trail":
            painter.setBrush(color)
            radius = 3
            for x in range(int(track.left() + radius), int(progress.right()), 10):
                painter.drawEllipse(QPointF(x, track.center().y()), radius, radius)
        elif self.visual_style == "Laser Beam":
            beam = QRectF(progress.left(), track.center().y() - 1, progress.width(), 2)
            painter.setBrush(color.lighter(150))
            painter.drawRoundedRect(beam, 1, 1)
        elif self.visual_style == "Wave Track":
            painter.setBrush(color)
            painter.drawRoundedRect(progress, 4, 4)
            painter.setPen(QPen(color.lighter(150), 2))
            wave = QPainterPath()
            wave.moveTo(progress.left(), track.center().y())
            for x in range(int(progress.left()), int(progress.right()), 6):
                wave.lineTo(x + 3, track.center().y() + (2 if x % 12 else -2))
            painter.drawPath(wave)
        elif self.visual_style == "Double Glow":
            half = max(1, track.height() / 2 - 1)
            painter.setBrush(color)
            painter.drawRoundedRect(QRectF(progress.left(), track.center().y() - half - 1, progress.width(), half), 2, 2)
            painter.drawRoundedRect(QRectF(progress.left(), track.center().y() + 1, progress.width(), half), 2, 2)
        elif self.visual_style == "Glass Capsule":
            glass = QColor(color)
            glass.setAlpha(150)
            painter.setBrush(glass)
            painter.setPen(QPen(color.lighter(150), 1))
            painter.drawRoundedRect(progress, track.height() / 2, track.height() / 2)
        elif self.visual_style == "Pixel Steps":
            painter.setBrush(color)
            step_width = 8
            for x in range(int(progress.left()), int(progress.right()), step_width + 1):
                fraction = min(1.0, (x - progress.left() + step_width) / max(1, progress.width()))
                step_height = max(2, track.height() * fraction)
                painter.drawRect(QRectF(x, track.bottom() - step_height, min(step_width, progress.right() - x), step_height))
        else:
            painter.setBrush(color)
            painter.drawRoundedRect(progress, 4, 4)

        if self.visual_style not in ("Dot Trail", "Pixel Steps"):
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(color.lighter(160))
            painter.drawEllipse(QPointF(progress.right(), track.center().y()), 4, 4)
        event.accept()


class AudioVisualizer(QWidget):
    MODES = (
        "Spectrum Bars",
        "Mirror Bars",
        "Waveform",
        "Dot Stack",
        "Pulse Bubbles",
        "Segment Meter",
        "Radial Burst",
        "Ripple Rings",
        "Twin Wave",
        "Stepped Wave",
        "Capsules",
        "Matrix",
        "Laser Scan",
        "Fireflies",
        "Spiral",
    )

    def __init__(self, parent=None):
        super().__init__(parent)
        self.levels = [0.0] * 24
        self.background_color = "#101a1b"
        self.bar_color = "#52f2c2"
        self.mode = self.MODES[0]
        self.glow = 45
        self.sensitivity = 1.0
        self.smooth_reveal = True
        self.rainbow_enabled = False
        self.calm_on_stop = True
        self.hue_shift = 0
        self.setMinimumHeight(64)
        self.setMaximumHeight(120)
        self.rainbow_timer = QTimer(self)
        self.rainbow_timer.timeout.connect(self.advance_rainbow)
        self.decay_timer = QTimer(self)
        self.decay_timer.setInterval(30)
        self.decay_timer.timeout.connect(self.decay_levels)
        self.target_levels = list(self.levels)
        self.smooth_timer = QTimer(self)
        self.smooth_timer.setInterval(16)
        self.smooth_timer.timeout.connect(self.smooth_levels)

    def set_bar_count(self, count):
        self.levels = [0.0] * count
        self.target_levels = list(self.levels)
        self.update()

    def set_colors(self, background, bars):
        self.background_color = background
        self.bar_color = bars
        self.update()

    def set_levels(self, levels):
        self.decay_timer.stop()
        self.target_levels = list(levels)
        if not self.smooth_reveal:
            self.levels = list(levels)
            self.update()
        elif len(self.levels) != len(levels):
            self.levels = [0.0] * len(levels)
            self.smooth_timer.start()
        else:
            self.smooth_timer.start()

    def set_smooth_reveal(self, enabled):
        self.smooth_reveal = enabled
        if enabled:
            return
        self.smooth_timer.stop()
        self.levels = list(self.target_levels)
        self.update()

    def smooth_levels(self):
        if len(self.levels) != len(self.target_levels):
            self.levels = [0.0] * len(self.target_levels)
        self.levels = [current + (target - current) * 0.28 for current, target in zip(self.levels, self.target_levels)]
        if max((abs(current - target) for current, target in zip(self.levels, self.target_levels)), default=0) < 0.01:
            self.levels = list(self.target_levels)
            self.smooth_timer.stop()
        self.update()

    def set_calm_on_stop(self, enabled):
        self.calm_on_stop = enabled
        if not enabled:
            self.decay_timer.stop()

    def calm_to_idle(self):
        self.smooth_timer.stop()
        if self.calm_on_stop and any(self.levels):
            self.decay_timer.start()

    def decay_levels(self):
        self.levels = [level * 0.82 for level in self.levels]
        if max(self.levels, default=0) < 0.01:
            self.levels = [0.0] * len(self.levels)
            self.decay_timer.stop()
        self.update()

    def set_mode(self, mode):
        self.mode = mode
        self.update()

    def set_glow(self, amount):
        self.glow = amount
        self.update()

    def set_rainbow(self, enabled):
        self.rainbow_enabled = enabled
        if enabled:
            self.rainbow_timer.start(55)
        else:
            self.rainbow_timer.stop()
        self.update()

    def advance_rainbow(self):
        self.hue_shift = (self.hue_shift + 4) % 360
        self.update()

    def color_for(self, index, count):
        if self.rainbow_enabled:
            hue = (self.hue_shift + index * 360 // max(1, count)) % 360
            return QColor.fromHsv(hue, 220, 255)
        color = QColor(self.bar_color)
        return color.lighter(100 + index % 3 * 12)

    def draw_path(self, painter, path, color, width=2):
        if self.glow:
            for extra, opacity in ((10, 0.06), (6, 0.12), (3, 0.2)):
                glow_color = QColor(color)
                glow_color.setAlpha(int(255 * opacity * self.glow / 45))
                painter.setPen(QPen(glow_color, width + extra, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
                painter.drawPath(path)
        painter.setPen(QPen(color, width, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
        painter.drawPath(path)

    def draw_bar(self, painter, rect, color, rounded=False):
        radius = min(rect.width(), rect.height()) / 2 if rounded else 1
        if self.glow:
            for spread, opacity in ((8, 0.05), (5, 0.1), (2, 0.18)):
                glow_color = QColor(color)
                glow_color.setAlpha(int(255 * opacity * self.glow / 45))
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(glow_color)
                expanded = rect.adjusted(-spread / 2, -spread / 2, spread / 2, spread / 2)
                painter.drawRoundedRect(expanded, radius + spread / 2, radius + spread / 2)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(color)
        painter.drawRoundedRect(rect, radius, radius)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor(self.background_color))
        width = self.width()
        height = self.height()
        count = len(self.levels)
        middle = height / 2
        if not count:
            event.accept()
            return

        if self.mode in ("Spectrum Bars", "Mirror Bars", "Capsules", "Segment Meter"):
            gap = 3
            bar_width = max(2, (width - gap * (count + 1)) / count)
            segment_count = 12
            for index, level in enumerate(self.levels):
                x = gap + index * (bar_width + gap)
                color = self.color_for(index, count)
                if self.mode == "Mirror Bars":
                    bar_height = max(2, (height / 2 - 5) * level)
                    self.draw_bar(painter, QRectF(x, middle - bar_height, bar_width, bar_height), color, True)
                    self.draw_bar(painter, QRectF(x, middle, bar_width, bar_height), color, True)
                elif self.mode == "Segment Meter":
                    segment_gap = 2
                    segment_height = max(2, (height - 12) / segment_count)
                    active = round(level * segment_count)
                    for segment in range(active):
                        y = height - 5 - (segment + 1) * segment_height
                        self.draw_bar(
                            painter,
                            QRectF(x, y, bar_width, segment_height - segment_gap),
                            self.color_for(index + segment, count),
                            True,
                        )
                else:
                    bar_height = max(2, (height - 8) * level)
                    y = height - bar_height - 4
                    self.draw_bar(
                        painter,
                        QRectF(x, y, bar_width, bar_height),
                        color,
                        self.mode == "Capsules",
                    )
        elif self.mode in ("Waveform", "Twin Wave", "Stepped Wave", "Laser Scan"):
            path = QPainterPath()
            for index, level in enumerate(self.levels):
                x = index * width / max(1, count - 1)
                if self.mode == "Twin Wave":
                    y = middle - level * middle * 0.9
                elif self.mode == "Laser Scan":
                    y = middle + (0.5 - level) * height * 0.6
                else:
                    y = height - 4 - level * (height - 8)
                if index == 0:
                    path.moveTo(x, y)
                elif self.mode == "Stepped Wave":
                    path.lineTo(x, path.currentPosition().y())
                    path.lineTo(x, y)
                else:
                    path.lineTo(x, y)
            color = self.color_for(count // 2, count)
            self.draw_path(painter, path, color, 3 if self.mode == "Laser Scan" else 2)
            if self.mode == "Twin Wave":
                lower = QPainterPath()
                for index, level in enumerate(self.levels):
                    point = QPointF(index * width / max(1, count - 1), middle + level * middle * 0.9)
                    if index == 0:
                        lower.moveTo(point)
                    else:
                        lower.lineTo(point)
                self.draw_path(painter, lower, self.color_for(count * 2 // 3, count), 2)
            elif self.mode == "Laser Scan":
                scan_x = (self.hue_shift * width / 360) if self.rainbow_enabled else width * sum(self.levels) / count
                scan = QPainterPath(QPointF(scan_x, 0))
                scan.lineTo(scan_x, height)
                self.draw_path(painter, scan, self.color_for(0, count), 2)
        elif self.mode in ("Dot Stack", "Pulse Bubbles", "Matrix", "Fireflies"):
            gap = 4
            cell_width = max(2, (width - gap * (count + 1)) / count)
            for index, level in enumerate(self.levels):
                color = self.color_for(index, count)
                center_x = gap + index * (cell_width + gap) + cell_width / 2
                if self.mode == "Dot Stack":
                    rows = 10
                    active = round(level * rows)
                    for dot in range(active):
                        dot_y = height - 5 - (dot + 1) * (height - 10) / rows
                        radius = max(1.5, cell_width / 3)
                        self.draw_bar(painter, QRectF(center_x - radius, dot_y - radius, radius * 2, radius * 2), color, True)
                elif self.mode == "Matrix":
                    rows = 4
                    active = round(level * rows)
                    cell_height = (height - 10) / rows
                    for cell in range(active):
                        cell_y = height - 5 - (cell + 1) * cell_height
                        self.draw_bar(painter, QRectF(center_x - cell_width / 2, cell_y, cell_width, cell_height - 2), color, True)
                else:
                    radius = 2 + level * min(12, height / 4)
                    center_y = height - 6 - level * (height - 12)
                    bubble = QRectF(center_x - radius, center_y - radius, radius * 2, radius * 2)
                    self.draw_bar(painter, bubble, color, True)
                    if self.mode == "Fireflies":
                        sparkle = QRectF(center_x - 1, center_y - 1, 2, 2)
                        painter.setBrush(QColor("#ffffff"))
                        painter.setPen(Qt.PenStyle.NoPen)
                        painter.drawEllipse(sparkle)
        elif self.mode == "Radial Burst":
            center = QPointF(width / 2, height / 2)
            inner = min(width, height) * 0.12
            outer = min(width, height) * 0.46
            for index, level in enumerate(self.levels):
                angle = index * math.tau / count
                start = QPointF(center.x() + math.cos(angle) * inner, center.y() + math.sin(angle) * inner)
                end_radius = inner + level * (outer - inner)
                end = QPointF(center.x() + math.cos(angle) * end_radius, center.y() + math.sin(angle) * end_radius)
                path = QPainterPath(start)
                path.lineTo(end)
                self.draw_path(painter, path, self.color_for(index, count), 2)
        elif self.mode == "Ripple Rings":
            average = sum(self.levels) / count
            center = QPointF(width / 2, height / 2)
            max_radius = min(width, height) * 0.44
            for index in range(5):
                radius = max(3, max_radius * (index + 1) / 5 * (0.55 + average * 0.45))
                ring = QPainterPath()
                ring.addEllipse(center, radius, radius)
                self.draw_path(painter, ring, self.color_for(index, 5), 2)
        elif self.mode == "Spiral":
            center = QPointF(width / 2, height / 2)
            max_radius = min(width, height) * 0.43
            path = QPainterPath()
            for index, level in enumerate(self.levels):
                angle = index * math.tau * 2.5 / count
                radius = max_radius * (index + level * 0.35) / count
                point = QPointF(center.x() + math.cos(angle) * radius, center.y() + math.sin(angle) * radius)
                if index == 0:
                    path.moveTo(point)
                else:
                    path.lineTo(point)
            self.draw_path(painter, path, self.color_for(count // 2, count), 3)
        event.accept()


class VisualizerSettingsWindow(QDialog):
    PRESETS = {
        "Neon Mint": ("#101a1b", "#52f2c2"),
        "Electric Blue": ("#101421", "#57b7ff"),
        "Sunset": ("#21151b", "#ff8066"),
        "Bubblegum": ("#1a1422", "#f276c6"),
        "Laser Lime": ("#131a10", "#b8ff45"),
        "Arctic Pop": ("#101a20", "#75f0ff"),
        "Coral Reef": ("#201512", "#ff725e"),
        "Grape Soda": ("#1a1220", "#c17aff"),
        "Tangerine": ("#21170e", "#ffad42"),
        "Cotton Candy": ("#201321", "#ff8bd5"),
        "Deep Sea": ("#0d1921", "#28d7c4"),
        "Cherry Pop": ("#210f18", "#ff4f78"),
        "Golden Hour": ("#211c0e", "#ffe15c"),
        "Ultraviolet": ("#171024", "#a68aff"),
        "Ice Cream": ("#17201d", "#a5f27a"),
    }

    def __init__(self, visualizer, progress_bar, parent=None):
        super().__init__(parent)
        self.visualizer = visualizer
        self.progress_bar = progress_bar
        self.setWindowTitle("Visualizer Customization")
        self.setFixedWidth(390)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.mode_box = QComboBox()
        self.mode_box.addItems(visualizer.MODES)
        self.mode_box.setCurrentText(visualizer.mode)
        self.mode_box.currentTextChanged.connect(visualizer.set_mode)
        form.addRow("Visualizer style", self.mode_box)

        self.preset_box = QComboBox()
        self.preset_box.addItems(self.PRESETS)
        self.preset_box.addItem("Custom")
        self.preset_box.currentTextChanged.connect(self.apply_preset)
        form.addRow("Color preset", self.preset_box)

        self.background_button = QPushButton("Choose background")
        self.background_button.clicked.connect(self.choose_background)
        form.addRow("Background", self.background_button)

        self.bars_button = QPushButton("Choose bar color")
        self.bars_button.clicked.connect(self.choose_bar_color)
        form.addRow("Bars", self.bars_button)

        self.bar_count_label = QLabel("24 bars")
        self.bar_count_slider = QSlider(Qt.Orientation.Horizontal)
        self.bar_count_slider.setRange(12, 48)
        self.bar_count_slider.setValue(len(visualizer.levels))
        self.bar_count_slider.valueChanged.connect(self.set_bar_count)
        form.addRow("Detail", self.bar_count_slider)

        self.glow_label = QLabel(f"{visualizer.glow}%")
        self.glow_slider = QSlider(Qt.Orientation.Horizontal)
        self.glow_slider.setRange(0, 100)
        self.glow_slider.setValue(visualizer.glow)
        self.glow_slider.valueChanged.connect(self.set_glow)
        form.addRow("Glow", self.glow_slider)

        self.sensitivity_label = QLabel("100%")
        self.sensitivity_slider = QSlider(Qt.Orientation.Horizontal)
        self.sensitivity_slider.setRange(50, 200)
        self.sensitivity_slider.setValue(100)
        self.sensitivity_slider.valueChanged.connect(self.set_sensitivity)
        form.addRow("Sensitivity", self.sensitivity_slider)

        self.calm_toggle = QCheckBox("Calm to idle when stopped")
        self.calm_toggle.setChecked(visualizer.calm_on_stop)
        self.calm_toggle.toggled.connect(visualizer.set_calm_on_stop)
        form.addRow("Stop effect", self.calm_toggle)

        self.progress_style_box = QComboBox()
        self.progress_style_box.addItems(CustomSeekBar.STYLES)
        self.progress_style_box.setCurrentText(progress_bar.visual_style)
        self.progress_style_box.currentTextChanged.connect(progress_bar.set_visual_style)
        form.addRow("Progress style", self.progress_style_box)

        self.progress_glow_label = QLabel(f"{progress_bar.glow}%")
        self.progress_glow_slider = QSlider(Qt.Orientation.Horizontal)
        self.progress_glow_slider.setRange(0, 100)
        self.progress_glow_slider.setValue(progress_bar.glow)
        self.progress_glow_slider.valueChanged.connect(self.set_progress_glow)
        form.addRow("Progress glow", self.progress_glow_slider)

        layout.addLayout(form)
        layout.addWidget(self.bar_count_label)
        layout.addWidget(self.glow_label)
        layout.addWidget(self.sensitivity_label)

        self.rainbow_toggle = QCheckBox("Cycle rainbow colors")
        self.rainbow_toggle.setChecked(visualizer.rainbow_enabled)
        self.rainbow_toggle.toggled.connect(visualizer.set_rainbow)
        layout.addWidget(self.rainbow_toggle)

        self.smooth_toggle = QCheckBox("Smooth visualizer reveal")
        self.smooth_toggle.setChecked(visualizer.smooth_reveal)
        self.smooth_toggle.toggled.connect(visualizer.set_smooth_reveal)
        layout.addWidget(self.smooth_toggle)

        self.volume_color_toggle = QCheckBox("Progress color follows volume")
        self.volume_color_toggle.setChecked(progress_bar.volume_reactive)
        self.volume_color_toggle.toggled.connect(progress_bar.set_volume_reactive)
        layout.addWidget(self.volume_color_toggle)

        self.progress_color_button = QPushButton("Choose progress color")
        self.progress_color_button.clicked.connect(self.choose_progress_color)
        layout.addWidget(self.progress_color_button)

        self.reset_button = QPushButton("Reset visualizer")
        self.reset_button.clicked.connect(self.reset_settings)
        layout.addWidget(self.reset_button)

        self.apply_preset(self.preset_box.currentText())

    def apply_preset(self, name):
        preset = self.PRESETS.get(name)
        if preset is None:
            return
        background, bars = preset
        self.visualizer.set_colors(background, bars)
        self.background_button.setStyleSheet(f"background-color: {background};")
        self.bars_button.setStyleSheet(f"background-color: {bars};")

    def choose_background(self):
        color = QColorDialog.getColor(QColor(self.visualizer.background_color), self)
        if color.isValid():
            self.visualizer.set_colors(color.name(), self.visualizer.bar_color)
            self.background_button.setStyleSheet(f"background-color: {color.name()};")
            self.preset_box.setCurrentText("Custom")

    def choose_bar_color(self):
        color = QColorDialog.getColor(QColor(self.visualizer.bar_color), self)
        if color.isValid():
            self.visualizer.set_colors(self.visualizer.background_color, color.name())
            self.bars_button.setStyleSheet(f"background-color: {color.name()};")
            self.preset_box.setCurrentText("Custom")

    def set_bar_count(self, count):
        self.visualizer.set_bar_count(count)
        self.bar_count_label.setText(f"{count} bars")

    def set_glow(self, amount):
        self.visualizer.set_glow(amount)
        self.glow_label.setText(f"{amount}%")

    def set_sensitivity(self, amount):
        self.visualizer.sensitivity = amount / 100
        self.sensitivity_label.setText(f"{amount}%")

    def set_progress_glow(self, amount):
        self.progress_bar.set_glow(amount)
        self.progress_glow_label.setText(f"{amount}%")

    def choose_progress_color(self):
        color = QColorDialog.getColor(QColor(self.progress_bar.progress_color), self)
        if color.isValid():
            self.progress_bar.set_progress_color(color.name())
            self.progress_color_button.setStyleSheet(f"background-color: {color.name()};")
            self.volume_color_toggle.setChecked(False)

    def reset_settings(self):
        self.mode_box.setCurrentText(AudioVisualizer.MODES[0])
        self.preset_box.setCurrentText("Neon Mint")
        self.apply_preset("Neon Mint")
        self.bar_count_slider.setValue(24)
        self.glow_slider.setValue(45)
        self.sensitivity_slider.setValue(100)
        self.rainbow_toggle.setChecked(False)
        self.smooth_toggle.setChecked(True)
        self.calm_toggle.setChecked(True)
        self.progress_style_box.setCurrentText(CustomSeekBar.STYLES[0])
        self.progress_bar.reset_waveform()
        self.progress_glow_slider.setValue(45)
        self.progress_bar.set_progress_color("#52f2c2")
        self.volume_color_toggle.setChecked(True)
        self.progress_color_button.setStyleSheet("")


class MusicPlayer(QWidget):
    AUDIO_EXTENSIONS = {".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".wma"}

    def __init__(self):
        super().__init__()
        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.player.setAudioOutput(self.audio)
        self.audio_buffer_output = QAudioBufferOutput(self)
        self.player.setAudioBufferOutput(self.audio_buffer_output)
        self.song_paths = []
        self.music_folder = QStandardPaths.writableLocation(
            QStandardPaths.StandardLocation.MusicLocation
        )

        self.setWindowTitle("Music Player")
        self.resize(360, 560)

        layout = QVBoxLayout(self)

        self.name_label = QLabel("Choose a music folder")
        self.name_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.name_label)

        visualizer_row = QHBoxLayout()
        self.visualizer_toggle = QCheckBox("Show visualizer")
        self.visualizer_toggle.toggled.connect(self.toggle_visualizer)
        visualizer_row.addWidget(self.visualizer_toggle)
        self.customize_visualizer_btn = QPushButton("Customize")
        self.customize_visualizer_btn.clicked.connect(self.open_visualizer_settings)
        visualizer_row.addWidget(self.customize_visualizer_btn)
        layout.addLayout(visualizer_row)

        self.visualizer = AudioVisualizer()
        self.visualizer.setVisible(False)
        layout.addWidget(self.visualizer)
        self.audio_buffer_output.audioBufferReceived.connect(
            lambda buffer: self.update_visualizer(buffer)
        )
        self.visualizer_settings = None

        folder_row = QHBoxLayout()
        self.scan_btn = QPushButton("Scan Music")
        self.scan_btn.clicked.connect(lambda: self.load_music_folder(self.music_folder))
        self.choose_folder_btn = QPushButton("Choose Folder")
        self.choose_folder_btn.clicked.connect(self.choose_music_folder)
        folder_row.addWidget(self.scan_btn)
        folder_row.addWidget(self.choose_folder_btn)
        layout.addLayout(folder_row)

        self.playlist = QListWidget()
        self.playlist.currentRowChanged.connect(self.select_track)
        self.playlist.itemDoubleClicked.connect(self.toggle_play)
        layout.addWidget(self.playlist)

        self.time_label = QLabel("00:00 / 00:00")
        self.time_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.time_label)

        self.slider = CustomSeekBar()
        self.slider.setRange(0, 1000)
        self.slider.sliderMoved.connect(self.seek)
        self.slider.set_volume_level(0.7)
        layout.addWidget(self.slider)

        self.volume_label = QLabel("Volume: 70%")
        layout.addWidget(self.volume_label)
        self.volume_slider = QSlider(Qt.Orientation.Horizontal)
        self.volume_slider.setRange(0, 100)
        self.volume_slider.setValue(70)
        self.volume_slider.valueChanged.connect(self.set_volume)
        layout.addWidget(self.volume_slider)

        self.transpose_label = QLabel("Transpose: 0 semitones")
        layout.addWidget(self.transpose_label)
        self.transpose_slider = QSlider(Qt.Orientation.Horizontal)
        self.transpose_slider.setRange(-12, 12)
        self.transpose_slider.setValue(0)
        self.transpose_slider.valueChanged.connect(self.set_transpose)
        layout.addWidget(self.transpose_slider)

        self.tempo_label = QLabel("Tempo: 100%")
        layout.addWidget(self.tempo_label)
        self.tempo_slider = QSlider(Qt.Orientation.Horizontal)
        self.tempo_slider.setRange(70, 130)
        self.tempo_slider.setValue(100)
        self.tempo_slider.valueChanged.connect(self.set_tempo)
        layout.addWidget(self.tempo_slider)

        self.reset_btn = QPushButton("Reset Controls")
        self.reset_btn.clicked.connect(self.reset_controls)
        layout.addWidget(self.reset_btn)

        row = QHBoxLayout()
        self.back_btn = QPushButton("<")
        self.play_btn = QPushButton("Play")
        self.stop_btn = QPushButton("Stop")
        self.next_btn = QPushButton(">")

        self.back_btn.clicked.connect(self.back)
        self.play_btn.clicked.connect(self.toggle_play)
        self.stop_btn.clicked.connect(self.stop_playback)
        self.next_btn.clicked.connect(self.next)

        row.addWidget(self.back_btn)
        row.addWidget(self.play_btn)
        row.addWidget(self.stop_btn)
        row.addWidget(self.next_btn)
        layout.addLayout(row)

        self.player.positionChanged.connect(self.update_time)
        self.player.durationChanged.connect(self.update_time)
        self.player.playbackStateChanged.connect(self.update_play_button)
        self.player.mediaStatusChanged.connect(self.handle_media_status)
        self.audio.setVolume(0.7)
        self.load_music_folder(self.music_folder)

    def choose_music_folder(self):
        folder = QFileDialog.getExistingDirectory(
            self, "Choose Music Folder", self.music_folder
        )
        if folder:
            self.music_folder = folder
            self.load_music_folder(folder)

    def load_music_folder(self, folder):
        self.player.stop()
        self.song_paths = []
        self.playlist.clear()

        if os.path.isdir(folder):
            for root, _, files in os.walk(folder):
                for filename in files:
                    if os.path.splitext(filename)[1].lower() in self.AUDIO_EXTENSIONS:
                        self.song_paths.append(os.path.join(root, filename))

        self.song_paths.sort(key=str.casefold)
        for path in self.song_paths:
            display_path = os.path.relpath(path, folder)
            self.playlist.addItem(os.path.splitext(display_path)[0])

        has_tracks = bool(self.song_paths)
        self.play_btn.setEnabled(has_tracks)
        self.slider.setEnabled(has_tracks)
        if has_tracks:
            self.playlist.setCurrentRow(0)
        else:
            self.name_label.setText("No music files found")
            self.time_label.setText("00:00 / 00:00")

    def select_track(self, index):
        if 0 <= index < len(self.song_paths):
            path = self.song_paths[index]
            self.name_label.setText(os.path.splitext(os.path.basename(path))[0])
            self.slider.reset_waveform()
            self.player.setSource(QUrl.fromLocalFile(path))

    def change_track(self, step):
        if not self.song_paths:
            return

        was_playing = self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState
        next_index = (self.playlist.currentRow() + step) % len(self.song_paths)
        self.playlist.setCurrentRow(next_index)
        if was_playing:
            self.player.play()

    def handle_media_status(self, status):
        if status == QMediaPlayer.MediaStatus.EndOfMedia:
            self.change_track(1)
            self.player.play()

    def update_play_button(self, state):
        is_playing = state == QMediaPlayer.PlaybackState.PlayingState
        self.play_btn.setText("Pause" if is_playing else "Play")
        if is_playing:
            self.visualizer.decay_timer.stop()
        elif state == QMediaPlayer.PlaybackState.StoppedState:
            self.visualizer.calm_to_idle()

    def toggle_play(self):
        if not self.song_paths:
            return

        if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def back(self):
        self.change_track(-1)

    def next(self):
        self.change_track(1)

    def stop_playback(self):
        self.player.stop()
        self.visualizer.calm_to_idle()

    def set_volume(self, value):
        self.audio.setVolume(value / 100)
        self.slider.set_volume_level(value / 100)
        self.volume_label.setText(f"Volume: {value}%")

    def set_transpose(self, semitones):
        self.transpose_label.setText(f"Transpose: {semitones} semitones")
        self.update_playback_rate()

    def set_tempo(self, tempo):
        self.tempo_label.setText(f"Tempo: {tempo}%")
        self.update_playback_rate()

    def update_playback_rate(self):
        transpose_rate = 2 ** (self.transpose_slider.value() / 12)
        tempo_rate = self.tempo_slider.value() / 100
        self.player.setPlaybackRate(tempo_rate * transpose_rate)

    def reset_controls(self):
        self.volume_slider.setValue(70)
        self.transpose_slider.setValue(0)
        self.tempo_slider.setValue(100)

    def toggle_visualizer(self, visible):
        self.visualizer.setVisible(visible)

    def open_visualizer_settings(self):
        if self.visualizer_settings is None:
            self.visualizer_settings = VisualizerSettingsWindow(self.visualizer, self.slider, self)
        self.visualizer_settings.show()
        self.visualizer_settings.raise_()
        self.visualizer_settings.activateWindow()

    def update_visualizer(self, buffer: QAudioBuffer):
        if not buffer.isValid():
            return

        sample_format = buffer.format().sampleFormat()
        sample_types = {
            QAudioFormat.SampleFormat.Float: ("f", 1.0),
            QAudioFormat.SampleFormat.Int16: ("h", 32768.0),
            QAudioFormat.SampleFormat.Int32: ("i", 2147483648.0),
            QAudioFormat.SampleFormat.UInt8: ("B", 128.0),
        }
        sample_type = sample_types.get(sample_format)
        if sample_type is None:
            return

        format_code, scale = sample_type
        raw_samples = buffer.constData().asstring(buffer.byteCount())
        sample_size = struct.calcsize(format_code)
        sample_count = min(buffer.sampleCount(), len(raw_samples) // sample_size)
        if sample_count == 0:
            return

        samples = struct.unpack(f"={sample_count}{format_code}", raw_samples)
        bar_count = len(self.visualizer.levels)
        levels = []
        for index in range(bar_count):
            start = index * sample_count // bar_count
            end = max(start + 1, (index + 1) * sample_count // bar_count)
            segment = samples[start:end]
            if sample_format == QAudioFormat.SampleFormat.UInt8:
                peak = max((abs(sample - 128) for sample in segment), default=0)
            else:
                peak = max((abs(sample) for sample in segment), default=0)
            levels.append(min(1.0, peak / scale * self.visualizer.sensitivity))

        self.slider.record_audio_levels(
            levels,
            self.player.position(),
            self.player.duration(),
            buffer.frameCount(),
            buffer.format().sampleRate(),
        )
        if self.visualizer_toggle.isChecked():
            self.visualizer.set_levels(levels)

    def seek(self, value):
        duration = self.player.duration()
        if duration > 0:
            self.player.setPosition(int((value / 1000) * duration))

    def update_time(self, _=0):
        duration = self.player.duration()
        position = self.player.position()

        if duration > 0:
            self.slider.setValue(int((position / duration) * 1000))

        self.time_label.setText(f"{format_time(position)} / {format_time(duration)}")


def format_time(ms):
    total = max(0, ms // 1000)
    minutes, seconds = divmod(total, 60)
    return f"{minutes:02d}:{seconds:02d}"


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MusicPlayer()
    window.show()
    sys.exit(app.exec())