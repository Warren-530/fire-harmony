"""Word timings of the processed voice, for subtitles that follow the speaker: faster-whisper (small.en, on the CPU).
Usage: <python with faster-whisper> video/word_times.py <ffmpeg> <out.json> <scene.wav>...   -> {id: [[start, end], ...]}"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

ff, out, files = sys.argv[1], sys.argv[2], sys.argv[3:]
model = WhisperModel("small.en", device="cpu", compute_type="int8")
times = {}
for f in files:
    pcm = subprocess.run([ff, "-v", "error", "-i", f, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    segs, _ = model.transcribe(np.frombuffer(pcm, np.float32).copy(), beam_size=5, word_timestamps=True)
    times[Path(f).stem.removesuffix("_x")] = [[round(w.start, 3), round(w.end, 3)] for s in segs for w in s.words]
Path(out).write_text(json.dumps(times))
