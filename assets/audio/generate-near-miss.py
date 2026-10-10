"""Generate the original mono near-miss cue; encode its WAV to Ogg Vorbis.

No external source sample is used. The fixed seed makes the noise sweep
reproducible for the licence manifest and asset checks.
"""

from math import pi, sin
from pathlib import Path
import struct
import wave

RATE = 48000
SECONDS = 0.28
COUNT = round(RATE * SECONDS)
seed = 0x1294A37B
low = 0.0
high = 0.0
samples = bytearray()

for index in range(COUNT):
    t = index / COUNT
    seed ^= (seed << 13) & 0xFFFFFFFF
    seed ^= seed >> 17
    seed ^= (seed << 5) & 0xFFFFFFFF
    noise = (seed / 0xFFFFFFFF) * 2 - 1
    # A moving high band plus a rounded envelope reads as air passing a door,
    # without the low-frequency metal attack used by crash audio.
    low += (noise - low) * (0.02 + 0.10 * t)
    high += (noise - high) * (0.16 + 0.20 * t)
    envelope = max(0, sin(pi * t)) ** 1.4
    value = max(-1, min(1, (high - low) * envelope * 0.58))
    samples.extend(struct.pack('<h', round(value * 32767)))

destination = Path(__file__).with_name('near-miss.wav')
with wave.open(str(destination), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(samples)
print(destination)
