# Original Slamdemonium procedural audio. Dedicated to CC0-1.0.
import math, random, struct, wave
from pathlib import Path
rng = random.Random(0x534C414D)
noise = [rng.uniform(-1, 1) for _ in range(1024)]
for name, duration in [('boost-loop', 1.0), ('boost-attack', 0.32)]:
    samples = []
    for i in range(round(duration * 48000)):
        t = i / 48000
        phase = t * 1024
        index = int(phase) % 1024
        fraction = phase % 1
        wind = noise[index] * (1-fraction) + noise[(index+1) % 1024] * fraction
        if name == 'boost-loop':
            value = 0.18*wind + 0.12*math.sin(2*math.pi*110*t) + 0.06*math.sin(2*math.pi*220*t)
        else:
            envelope = min(1, t/0.005) * (1-t/duration)**2
            value = envelope*(0.35*wind + 0.25*math.sin(2*math.pi*(180*t-140*t*t)))
        samples.append(struct.pack('<h', round(value * 32767)))
    with wave.open(str(Path(__file__).parent / (name+'.wav')), 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(48000)
        wav.writeframes(b''.join(samples))
