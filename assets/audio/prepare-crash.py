#!/usr/bin/env python3
"""Rebuild the edited CC0 crash bank from the pinned public source media.

Original recordings stay in a temporary directory. The source URLs, SHA-256
hashes, licence pages, edits and shipped-file hashes live in crash-bank.json.
Freesound sources are its public HQ previews of CC0 originals: downloading an
original there requires login, so the manifest says exactly which derivative
we used. No fetched source media is committed.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "crash-bank.json"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def canonical_ogg(path: Path, name: str) -> None:
    """Pin ffmpeg's random Ogg stream serial and repair every page CRC."""
    data = bytearray(path.read_bytes())
    serial = hashlib.sha256(name.encode()).digest()[:4]
    offset = 0
    while offset < len(data):
        if data[offset : offset + 4] != b"OggS":
            raise ValueError(f"Invalid Ogg page in {path.name}")
        segments = data[offset + 26]
        length = 27 + segments + sum(data[offset + 27 : offset + 27 + segments])
        page = memoryview(data)[offset : offset + length]
        page[14:18] = serial
        page[22:26] = b"\0\0\0\0"
        crc = 0
        for byte in page:
            crc ^= byte << 24
            for _ in range(8):
                crc = ((crc << 1) ^ (0x04C11DB7 if crc & 0x80000000 else 0)) & 0xFFFFFFFF
        page[22:26] = crc.to_bytes(4, "little")
        offset += length
    path.write_bytes(data)


def main() -> None:
    bank = json.loads(MANIFEST.read_text())
    record = "--record" in sys.argv
    cached = Path(sys.argv[sys.argv.index("--source-dir") + 1]) if "--source-dir" in sys.argv else None
    with tempfile.TemporaryDirectory(prefix="slamdemonium-crash-") as folder:
        source_dir = Path(folder)
        for source in bank["sources"]:
            if source["license"] != "CC0-1.0":
                raise ValueError(f"Unapproved licence: {source['name']}")
            if cached:
                data = (cached / source["file"]).read_bytes()
            else:
                data = urllib.request.urlopen(source["mediaUrl"], timeout=45).read()
            if sha(data) != source["sha256"]:
                raise ValueError(f"Source changed: {source['name']}")
            (source_dir / source["file"]).write_bytes(data)
        for clip in bank["clips"]:
            source = next(item for item in bank["sources"] if item["name"] == clip["source"])
            path = source_dir / source["file"]
            duration = clip["durationSeconds"]
            fade_out = max(0.0, duration - clip["fadeOutSeconds"])
            filters = (
                f"highpass=f={clip['highpassHz']},lowpass=f={clip['lowpassHz']},"
                f"volume={clip['gainDb']}dB,"
                f"afade=t=in:st=0:d={clip['fadeInSeconds']},"
                f"afade=t=out:st={fade_out}:d={clip['fadeOutSeconds']},"
                "alimiter=limit=0.7"
            )
            common = (
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", str(clip["startSeconds"]), "-t", str(duration), "-i", str(path),
                "-af", filters, "-ac", "1", "-ar", "48000", "-map_metadata", "-1",
            )
            for extension, encoder in (
                ("ogg", ("-c:a", "libvorbis", "-q:a", "2")),
                ("mp3", ("-c:a", "libmp3lame", "-b:a", "64k")),
            ):
                output = ROOT / f"crash-{clip['name']}.{extension}"
                run(*common, *encoder, str(output))
                if extension == "ogg":
                    canonical_ogg(output, clip["name"])
                actual = {"sha256": sha(output.read_bytes()), "bytes": output.stat().st_size}
                if record:
                    clip.setdefault("outputs", {})[extension] = actual
                elif actual != clip["outputs"][extension]:
                    raise ValueError(f"Encoded output changed: {output.name}")
    if record:
        MANIFEST.write_text(json.dumps(bank, indent=2) + "\n")


if __name__ == "__main__":
    main()
