"""Synthesize two original creature screams using Python's standard library.

Run from any directory with Python 3.12 or newer. No recorded voices are used.
The loss sting has a quick onset and a short tail. Granny's burning scream
descends more slowly and has a longer, broken echo.
"""

import argparse
from array import array
import math
from pathlib import Path
import random
import sys
import wave


SAMPLE_RATE = 44100
TAU = math.tau


class Resonator:
    """A narrow band-pass filter for the throat and metallic noise layers."""

    def __init__(self, frequency, quality):
        omega = TAU * frequency / SAMPLE_RATE
        alpha = math.sin(omega) / (2 * quality)
        denominator = 1 + alpha
        self.b0 = alpha / denominator
        self.b2 = -self.b0
        self.a1 = -2 * math.cos(omega) / denominator
        self.a2 = (1 - alpha) / denominator
        self.x1 = self.x2 = self.y1 = self.y2 = 0.0

    def process(self, value):
        result = self.b0 * value + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2
        self.x2, self.x1 = self.x1, value
        self.y2, self.y1 = self.y1, result
        return result


def synthesize(duration, seed, burning):
    rng = random.Random(seed)
    count = round(duration * SAMPLE_RATE)
    filters = [Resonator(760, 3.8), Resonator(1710, 5.2), Resonator(3080, 6.0)]
    dry = []
    phase = 0.0
    sub_phase = 0.0
    crushed = 0.0
    rasp = 0.0

    for index in range(count):
        time = index / SAMPLE_RATE
        progress = time / duration
        # Fast pitch motion and detuned harmonics give it a strained, inhuman tone.
        pitch = (510 if burning else 680) * math.exp(-1.18 * progress)
        pitch += 31 * math.sin(TAU * 13.7 * time) + 19 * math.sin(TAU * 37.1 * time)
        phase += TAU * pitch / SAMPLE_RATE
        sub_phase += TAU * (67 + 18 * math.sin(time * 5.1)) / SAMPLE_RATE
        throat = math.sin(phase + 1.6 * math.sin(phase * 1.47))
        throat += 0.33 * math.sin(phase * 2.013) + 0.24 * math.sin(phase * 3.987)
        noise = rng.uniform(-1, 1)
        excitation = 0.76 * throat + 0.67 * noise
        formants = sum(gain * resonator.process(excitation)
                       for gain, resonator in zip((1.6, 1.25, 0.8), filters))
        rasp += 0.45 * (noise - rasp)
        raw = 0.53 * throat + 1.5 * formants + 0.16 * rasp + 0.22 * math.sin(sub_phase)
        if index % 3 == 0:
            crushed = round(math.tanh(raw * 3.4) * 45) / 45
        flutter = 0.77 + 0.23 * math.sin(TAU * (47 if burning else 64) * time)
        attack = min(1, time / 0.004)
        release = min(1, max(0, duration - time) / 0.19) ** 1.6
        body = math.exp(-0.8 * progress)
        dry.append(crushed * flutter * attack * release * body)

    # Unequal echo taps spread the rasp across stereo without moving the attack.
    channels = []
    for delays in [
        ((0.029, 0.18), (0.071, -0.13), (0.143, 0.10)),
        ((0.041, -0.17), (0.089, 0.14), (0.167, 0.09)),
    ]:
        signal = list(dry)
        for seconds, gain in delays:
            offset = round(seconds * SAMPLE_RATE)
            for index in range(offset, count):
                signal[index] += gain * dry[index - offset]
        mean = sum(signal) / count
        for index in range(count):
            edge_fade = min(1, index / 160, (count - 1 - index) / 320)
            signal[index] = (signal[index] - mean) * max(0, edge_fade)
        channels.append(signal)

    peak = max(abs(value) for channel in channels for value in channel)
    gain = 0.89 / peak
    frames = array("h")
    for left, right in zip(*channels):
        frames.extend((round(left * gain * 32767), round(right * gain * 32767)))
    if sys.byteorder != "little":
        frames.byteswap()
    return frames


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "public" / "audio")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, duration, seed, burning in [
        ("scream-loss.wav", 1.50, 937, False),
        ("scream-granny.wav", 1.95, 1661, True),
    ]:
        frames = synthesize(duration, seed, burning)
        with wave.open(str(args.output_dir / name), "wb") as output:
            output.setparams((2, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
            output.writeframes(frames.tobytes())
        print(f"{name}: {duration:.2f}s, stereo {SAMPLE_RATE} Hz")


if __name__ == "__main__":
    main()
