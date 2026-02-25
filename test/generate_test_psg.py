#!/usr/bin/env python3
"""Generate a test PSG file with recognizable patterns.

Creates a ~5 second PSG with:
- Channel A: ascending scale (C4-C5)
- Channel B: bass drone (low C)
- Channel C: arpeggios
- Noise: periodic drum hits every 25 frames
"""

import struct
from pathlib import Path

# AY clock = 1773400 Hz.  Tone period = clock / (16 * freq)
# Note frequencies (Hz) for octave 4
NOTES = {
    'C4': 262, 'D4': 294, 'E4': 330, 'F4': 349,
    'G4': 392, 'A4': 440, 'B4': 494, 'C5': 523,
}
BASS = 131  # C3

AY_CLOCK = 1773400

def freq_to_period(freq):
    return int(AY_CLOCK / (16 * freq))

def write_psg(filename, frames_data):
    """Write PSG file from list of (register, value) pairs per frame."""
    out = bytearray()
    # Header: "PSG" + 0x1A + version=10 + freq=50 + 10 bytes padding
    out.extend(b'PSG\x1a')
    out.append(10)   # version
    out.append(50)   # frequency (50 Hz PAL)
    out.extend(b'\x00' * 10)  # padding

    for frame_regs in frames_data:
        out.append(0xFF)  # frame marker
        for reg, val in frame_regs:
            out.append(reg & 0x0F)
            out.append(val & 0xFF)

    out.append(0xFD)  # end marker

    Path(filename).write_bytes(out)
    print(f"Wrote {filename}: {len(frames_data)} frames, {len(out)} bytes")


def main():
    scale = list(NOTES.values())
    bass_period = freq_to_period(BASS)
    total_frames = 250  # 5 seconds

    frames = []
    for f in range(total_frames):
        regs = []

        # Channel A: ascending scale, changes every ~30 frames
        note_idx = (f // 30) % len(scale)
        a_period = freq_to_period(scale[note_idx])
        regs.append((0, a_period & 0xFF))       # R0: tone A low
        regs.append((1, (a_period >> 8) & 0x0F)) # R1: tone A high

        # Channel B: bass drone
        regs.append((2, bass_period & 0xFF))
        regs.append((3, (bass_period >> 8) & 0x0F))

        # Channel C: arpeggio (cycle through 3 notes every 4 frames)
        arp_notes = [scale[0], scale[2], scale[4]]  # C-E-G triad
        c_freq = arp_notes[((f % 12) // 4)]
        c_period = freq_to_period(c_freq)
        regs.append((4, c_period & 0xFF))
        regs.append((5, (c_period >> 8) & 0x0F))

        # Mixer: all tones on, noise off by default
        mixer = 0b00111000  # noise off for all, tone on for all
        is_drum = (f % 25 == 0) and f > 0
        if is_drum:
            mixer = 0b00110000  # enable noise on channel A
            regs.append((6, 5))  # noise period = 5 (snare-ish)

        regs.append((7, mixer))

        # Volumes
        vol_a = 12
        vol_b = 8
        vol_c = 10

        # Drum: volume spike on A
        if is_drum:
            vol_a = 15
        # Fade drum over 4 frames
        elif f % 25 < 4 and f > 0:
            vol_a = 15 - (f % 25) * 2

        regs.append((8, vol_a))   # R8: vol A
        regs.append((9, vol_b))   # R9: vol B
        regs.append((10, vol_c))  # R10: vol C

        # Envelope (not used, but set period)
        regs.append((11, 0))
        regs.append((12, 0))
        regs.append((13, 0xFF))  # 0xFF = don't change envelope shape

        frames.append(regs)

    Path("test").mkdir(exist_ok=True)
    write_psg("test/test_music.psg", frames)


if __name__ == "__main__":
    main()
