"""Edit the recorded scenes (app/scripts/video_scenes.mjs) into the videos.

  silent  each scene fitted to the length of its words (or of the recorded voice), joined, the web address on the
          last scene: <file>_silent.mp4, no sound
  guide   the same with the script on screen and the scene number, to read along when recording the voice
  voice   the team's recorded voice (video/voice/<video>/<id>.<m4a|mp3|wav|...>, one file per scene, or one file
          <video>.<ext> with a pause of about two seconds between scenes): measured, cleaned, laid under the
          scenes, subtitles from the script burned in and written beside as .srt: <file>.mp4
  script  the script for the team (Markdown), with the time of each scene in the silent video

Usage: .venv/bin/python video/edit.py <demo|final> <silent|guide|voice|script> [out dir]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

REPO = Path(__file__).resolve().parents[1]
FF = imageio_ffmpeg.get_ffmpeg_exe()
FONTS = REPO / "app" / "public" / "fonts"
WORK = Path.home() / "nasa_work" / "tmp" / "video2"
FPS = 30
FILES = {"demo": "Fire_Harmony_demo_30s", "final": "Fire_Harmony_final"}
URL = "warren-530.github.io/fire-harmony"
GAP = {"demo": 0.25, "final": 0.45}
VOICE_CH = "c1"     # the channel of the voice files to use (c1: the right one, the near microphone of our phone)
AUDIO = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4")


def run(args: list[str]) -> str:
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"failed: {' '.join(map(str, args))[:400]}\n{r.stderr[-2000:]}")
    return r.stderr


def duration(path: Path) -> float:
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", run([FF, "-hide_banner", "-i", path, "-f", "null", "-t", "0", "-"]))
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def spec(video: str) -> dict:
    """{speed, max, scenes: [{id, say, seconds}]} from app/scripts/video_scenes.mjs."""
    out = subprocess.run(["node", str(REPO / "app" / "scripts" / "video_scenes.mjs"), "--script"], capture_output=True,
                         text=True, check=True, cwd=REPO / "app").stdout
    return json.loads(out)[video]


def scenes(video: str) -> list[dict]:
    return spec(video)["scenes"]


def phrases(text: str) -> list[str]:
    """Subtitle lines: sentences, and long sentences cut at a comma or colon (about 80 characters a line at most)."""
    out = []
    for sent in re.split(r"(?<=[.?!])\s+", text.strip()):
        while len(sent) > 84:
            cut = max(sent.rfind(", ", 0, 84), sent.rfind(": ", 0, 84))
            if cut < 30:
                break
            out.append(sent[:cut + 1].strip())
            sent = sent[cut + 1:].strip()
        if sent:
            out.append(sent)
    return out


def stamp(t: float, sep: str = ",") -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}".replace(".", sep)


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def fit(src: Path, goal: float, out: Path, *, end: bool = False, label: str | None = None) -> float:
    """One scene at exactly `goal` seconds: sped up a little when the actions took longer, the last frame held when
    they took less. On the last scene the web address fades in."""
    have = duration(src)
    vf = []
    if have > goal + 0.03:
        speed = have / goal
        if speed > 1.6:
            print(f"  {src.stem}: actions take {have:.1f} s for {goal:.1f} s of words (x{speed:.2f})")
        vf.append(f"setpts=PTS/{speed:.5f}")
    elif have < goal - 0.03:
        vf.append(f"tpad=stop_mode=clone:stop_duration={goal - have:.3f}")
    vf.append(f"fps={FPS},scale=1920:1080:flags=lanczos:out_range=tv,format=yuv420p")   # standard (TV) range for every player
    if end:
        a = max(goal - 2.2, 0.3)
        vf.append(f"drawtext=fontfile='{FONTS / 'Inter-SemiBold.ttf'}':text='{esc(URL)}':fontsize=40:fontcolor=0x1d1d1b:"
                  f"x=(w-tw)/2:y=h-150:box=1:boxcolor=white@0.94:boxborderw=22:"
                  f"alpha='if(lt(t,{a:.2f}),0,min(1,(t-{a:.2f})/0.35))'")
    if label:
        vf.append(f"drawtext=fontfile='{FONTS / 'Inter-Medium.ttf'}':text='{esc(label)}':fontsize=26:fontcolor=white:"
                  f"x=28:y=24:box=1:boxcolor=0xe75623@0.92:boxborderw=10")
    run([FF, "-y", "-hide_banner", "-i", src, "-vf", ",".join(vf), "-t", f"{goal:.3f}", "-an", "-c:v", "libx264",
         "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS), out])
    return duration(out)


def join(clips: list[Path], out: Path, *, srt: Path | None = None, audio: Path | None = None, fade_out: float = 0.5) -> None:
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{c}'\n" for c in clips))
    total = sum(duration(c) for c in clips)
    vf = [f"fade=t=out:st={max(total - fade_out, 0):.2f}:d={fade_out}"]
    if srt:
        style = ("FontName=Inter,FontSize=15,PrimaryColour=&H00FFFFFF,BackColour=&H14000000,BorderStyle=4,Outline=0,"
                 "Shadow=0,MarginV=26,MarginL=60,MarginR=60")
        vf.insert(0, f"subtitles='{srt}':fontsdir='{FONTS}':force_style='{style}'")
    args = [FF, "-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", listing]
    if audio:
        args += ["-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    else:
        args += ["-an"]
    args += ["-vf", ",".join(vf), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-color_range", "tv",
             "-movflags", "+faststart", out]
    run(args)
    listing.unlink()


def subtitles(plan: list[tuple[dict, float, float]], out: Path, speech: dict[str, float] | None = None,
              words: dict[str, list[list[float]]] | None = None) -> Path:
    """One cue per phrase. With the word timings of the voice, each phrase shows from its first word to its last
    (its words found by their place in the scene's line); without them, the phrases share the spoken time by length."""
    cues = []
    for sc, start, length in plan:
        if not sc["say"]:
            continue
        lines = phrases(sc["say"])
        at0 = start + 0.12          # where the scene's voice begins in the track
        w = (words or {}).get(sc["id"])
        if w:
            n = sum(len(x.split()) for x in lines)
            k = 0
            for j, line in enumerate(lines):
                a = w[min(round(k * len(w) / n), len(w) - 1)][0]
                k += len(line.split())
                b = w[min(max(round(k * len(w) / n) - 1, 0), len(w) - 1)][1]
                nxt = w[min(round(k * len(w) / n), len(w) - 1)][0] if j < len(lines) - 1 else b + 0.5
                cues.append((at0 + max(a - 0.08, 0), at0 + max(min(b + 0.35, nxt - 0.12), a + 0.6), line))   # ends before the next shows
            continue
        talk = (speech or {}).get(sc["id"], max(length - 0.5, 0.5))
        at, total = at0, sum(len(x) for x in lines)
        for line in lines:
            span = talk * len(line) / total
            cues.append((at, at + span, line))
            at += span
    out.write_text("".join(f"{i}\n{stamp(a)} --> {stamp(b)}\n{t}\n\n" for i, (a, b, t) in enumerate(cues, 1)))
    return out


# --- the team's voice ---------------------------------------------------------------------------------------------
def voice_parts(video: str, ids: list[str]) -> dict[str, Path]:
    """The recorded voice, one cleaned WAV per scene: from one file per scene, or one file cut at its pauses."""
    vdir = REPO / "video" / "voice" / video
    parts = WORK / video / "voice"
    parts.mkdir(parents=True, exist_ok=True)
    # the phone's near microphone only (the right channel: about 5 dB cleaner than the left, and no comb filter from
    # mixing two microphones), gentle noise reduction that follows the room, a soft de-esser and compressor, and the
    # silence before and after the words trimmed to a short natural breath
    clean = f"pan=mono|c0={VOICE_CH},highpass=f=75,lowpass=f=15000,afftdn=nr=12:nf=-46:tn=1,deesser=i=0.25," \
            "acompressor=threshold=-24dB:ratio=2.2:attack=12:release=180:knee=6," \
            "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.10," \
            "areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.16,areverse"
    per = {i: next((p for p in sorted(vdir.glob(f"{i}.*")) if p.suffix.lower() in AUDIO), None) for i in ids}
    if all(per.values()):
        src = per
    else:
        one = next((p for p in sorted(vdir.glob(f"{video}.*")) if p.suffix.lower() in AUDIO), None) or \
            next((p for p in sorted(vdir.glob("*")) if p.suffix.lower() in AUDIO), None)
        if not one:
            raise SystemExit(f"no voice files in {vdir} (one per scene, {ids[0]}.m4a ..., or one file)")
        log = run([FF, "-hide_banner", "-i", one, "-af", "silencedetect=noise=-38dB:d=1.2", "-f", "null", "-"])
        starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
        ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
        total = duration(one)
        cuts = [0.0] + [(s + e) / 2 for s, e in zip(starts, ends) if 0.5 < s and e < total - 0.5] + [total]
        if len(cuts) - 1 != len(ids):
            raise SystemExit(f"{one.name}: found {len(cuts) - 1} parts at its pauses, the script has {len(ids)} scenes; "
                             "leave a pause of about two seconds between scenes and none inside one, or send one file per scene")
        src = {}
        for i, (a, b) in zip(ids, zip(cuts, cuts[1:])):
            cut = parts / f"{i}_raw.wav"
            run([FF, "-y", "-hide_banner", "-i", one, "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-ac", "1", "-ar", "48000", cut])
            src[i] = cut
    out = {}
    for i, p in src.items():
        c = parts / f"{i}_clean.wav"
        run([FF, "-y", "-hide_banner", "-i", p, "-af", clean, "-ac", "1", "-ar", "48000", c])
        out[i] = level(c, parts / f"{i}.wav")
        c.unlink()
    return out


def loudness(path: Path) -> float:
    """Integrated loudness (LUFS, EBU R128)."""
    log = run([FF, "-hide_banner", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"])
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1])


def level(src: Path, out: Path, target: float = -19.0) -> Path:
    """One scene at the loudness of every other (a fixed gain, so the voice keeps its own dynamics), a limiter for the
    peaks, and fades of a few milliseconds so no scene starts or ends with a click."""
    gain = target - loudness(src)
    d = duration(src)
    run([FF, "-y", "-hide_banner", "-i", src, "-af",
         f"volume={gain:.2f}dB,alimiter=limit=0.80:attack=3:release=60:level=disabled,"
         f"afade=t=in:d=0.02,afade=t=out:st={max(d - 0.06, 0):.3f}:d=0.06", "-ar", "48000", out])
    return out


def speed_up(parts: dict[str, Path], speed: float) -> dict[str, Path]:
    """The voice a little faster, same pitch (atempo)."""
    if speed <= 1.001:
        return parts
    out = {}
    for i, p in parts.items():
        w = p.with_name(f"{i}_x.wav")
        run([FF, "-y", "-hide_banner", "-i", p, "-af", f"atempo={speed:.4f}", "-ar", "48000", w])
        out[i] = w
    return out


def main() -> None:
    video, mode = sys.argv[1], sys.argv[2]
    out_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else WORK / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    plan_sc = scenes(video)
    src_dir = WORK / video
    name = FILES[video]

    if mode == "script":
        print(script_md())
        return

    sp = spec(video)
    speed = sp["speed"]
    speech: dict[str, float] = {}
    words: dict[str, list[list[float]]] = {}
    voice: dict[str, Path] = {}
    if mode == "voice":
        # as fast as needed to fit the limit, never more than 1.2 times (a natural voice); 1 if it fits as spoken
        raw = voice_parts(video, [s["id"] for s in plan_sc])
        gap = GAP[video]                # the pause between two scenes' lines (each line keeps a short breath too)
        natural = sum(duration(p) + gap for p in raw.values())
        room = sp["max"] - 0.6          # a little under the limit, for the fade and the players' rounding
        speed = min(max(natural / room, 1.0), 1.2)
        if natural / speed > room + 0.01:
            print(f"  the voice takes {natural:.0f} s; even at x1.2 it is {natural / 1.2:.0f} s, over {sp['max']} s: cut a line")
        voice = speed_up(raw, speed)
        speech = {i: duration(p) for i, p in voice.items()}
        words = {}
        asr = Path.home() / "nasa_work" / "tools" / "asr" / "bin" / "python"
        if asr.exists():                # subtitles timed to the words (else shared by length)
            wt = WORK / video / "voice" / "words.json"
            run([asr, "-I", REPO / "video" / "word_times.py", FF, wt, *voice.values()])
            words = json.loads(wt.read_text())
        vdir = REPO / "video" / "voice" / video
        for i, sec in speech.items():   # the scene lengths follow the voice from now on (and when re-recorded)
            (vdir / f"{i}.json").write_text(json.dumps({"seconds": round(sec + gap / speed, 2)}))
        plan_sc = scenes(video)
        print(f"  voice {natural:.1f} s as spoken, played at x{speed:.2f}")
        speed = 1.0                     # the voice lengths already include the speed

    tmp = src_dir / "fit"
    tmp.mkdir(exist_ok=True)
    clips, plan, t = [], [], 0.0
    for k, sc in enumerate(plan_sc, 1):
        label = f"{k}" if mode == "guide" else None
        c = tmp / f"{sc['id']}.mp4"
        got = fit(src_dir / f"{sc['id']}.mp4", sc["seconds"] / speed, c, end=(k == len(plan_sc)), label=label)
        clips.append(c)
        plan.append((sc, t, got))
        t += got
    print(f"{video}: {len(clips)} scenes, {t:.1f} s")

    if mode == "silent":
        join(clips, out_dir / f"{name}_silent.mp4")
    elif mode == "guide":
        join(clips, out_dir / f"{name}_guide.mp4", srt=subtitles(plan, tmp / "guide.srt"))
    elif mode == "voice":
        # the voice of each scene starts with its scene, one mono track, loudness for the web
        track = tmp / "voice.wav"
        inputs, mix = [], []
        for n, (sc, start, _) in enumerate(plan):
            p = voice.get(sc["id"])
            if p and p.exists():
                inputs += ["-i", p]
                mix.append(f"[{len(mix)}:a]adelay={int((start + 0.12) * 1000)}:all=1[a{len(mix)}]")
        labels = "".join(f"[a{i}]" for i in range(len(mix)))
        raw = tmp / "voice_raw.wav"
        tone = f"anoisesrc=color=pink:amplitude=1:sample_rate=48000:duration={t:.3f},lowpass=f=3500,highpass=f=120,volume=-66dB[tone]"
        run([FF, "-y", "-hide_banner", *inputs, "-filter_complex",
             ";".join(mix) + f";{tone};{labels}[tone]amix=inputs={len(mix) + 1}:normalize=0,apad,atrim=0:{t:.3f}[out]",
             "-map", "[out]", "-ac", "1", "-ar", "48000", raw])
        gain = -16.0 - loudness(raw)
        run([FF, "-y", "-hide_banner", "-i", raw, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.84:attack=3:release=60:level=disabled",
             "-ar", "48000", track])
        raw.unlink()
        srt = subtitles(plan, out_dir / f"{name}.srt", speech, words)
        join(clips, out_dir / f"{name}.mp4", srt=srt, audio=track)
    final = next(out_dir.glob(f"{name}{'' if mode == 'voice' else '_' + mode}.mp4"))
    print(f"{final}: {duration(final):.1f} s, {final.stat().st_size / 1e6:.1f} MB")


SHOWS = {
    "d1": "The project page: Fire Harmony, the team, the button to open the app.",
    "d2": "Methods: world hotspots per year; the naive record jumps in 2012, the harmonized one does not.",
    "d3": "Methods: the model, from MODIS alone, follows VIIRS year by year.",
    "d4": "Explorer: typing Central Kalimantan, the map flies there, the burning calendar, then the Why tab.",
    "d5": "A quick tour: the outlook, the Dashboard, Rankings, Haze, the Ask panel and the Data page.",
    "d6": "The project page again; the web address appears.",
    "f01": "The project page: title, team, the burning calendar picture, the Open the web app button.",
    "f02": "Methods: world hotspots per year. The cursor runs along the years; the naive line jumps in 2012.",
    "f03": "Explorer, world: map settings switch the record to Raw (the 2012 jump on the timeline), then back to Harmonized.",
    "f04": "Methods: the key numbers (640.6 million hotspots, five satellites).",
    "f05": "Methods: VIIRS sees the weak fires; MODIS misses most of them.",
    "f06": "Methods: the hour of each pass; the MODIS orbits drift after 2021.",
    "f07": "Methods: the exchange rate map and the night fire chart.",
    "f08": "Methods: one record on one scale; the years each satellite covers.",
    "f09": "Methods: the model beats one exchange rate; the model follows VIIRS from MODIS alone.",
    "f10": "Methods: the static heat mask, tested on 2024 and 2025.",
    "f11": "Methods, How we know it works: the seam test, burned area, the 90% ranges.",
    "f12": "Methods: the outlook's skill and calibration card.",
    "f13": "Methods: how trends are tested; places where fire fell against places where it rose.",
    "f14": "Methods: the trends of a record from MODIS alone against the harmonized ones.",
    "f15": "Explorer: the world map, then Play: the months move.",
    "f16": "Typing Central Kalimantan; the map flies to Borneo; the numbers: 13.8 times normal.",
    "f17": "The full burning calendar; the cursor points at Sep 2015, Oct 2006, Oct 2026.",
    "f18": "Period tab: August to October 2019, its numbers, the download menu.",
    "f19": "Why tab: rain, El Nino and what the weather points to.",
    "f20": "Outlook tab: 80% chance of above normal fire in November.",
    "f21": "Map settings: 3D on, then the trend view.",
    "f22": "Drawing a box on the map; the numbers follow the new area.",
    "f23": "Dashboard: scrolling through its sections.",
    "f24": "Rankings: Rising fastest, the rows.",
    "f25": "Haze page for Kuala Lumpur.",
    "f26": "The app on a phone: the sheet slides up, the Why tab.",
    "f27": "Ask: the question typed, the assistant looks up the numbers, the answer with links to open the places.",
    "f28": "Data page: the downloads.",
    "f29": "Corrientes, Argentina, February 2022, on the calendar.",
    "f30": "Argentina on the map, February 2022.",
    "f31": "The project page; the web address appears.",
}


def script_md() -> str:
    out = ["# Fire Harmony: video scripts for our voice", "",
           "Two videos, made as silent screen recordings of the live app (light theme). We record our voice; then the",
           "videos are fitted to it: each scene gets as long as its words take, so read at a relaxed, natural pace.", "",
           "## How to record", "",
           "- A quiet room, the phone about 20 cm from the mouth, no music. Any voice memo app is fine (m4a, mp3, wav).",
           "- Best: **one file per scene**, named with its number: `d1.m4a`, `d2.m4a` ... and `f01.m4a`, `f02.m4a` ...",
           "  Also fine: one file per video, with a pause of about two seconds between scenes (and no long pause inside one).",
           "- Say it in your own words if a sentence feels stiff; keep the numbers. Tell me what you changed, so the",
           "  subtitles match.",
           "- You can share the lines between the two of us: for example one voice for the method, the other for the app.",
           "- To get the feel of the timing, play the **guide** video (it shows these lines on screen) while reading.",
           "- Read at a natural, slightly brisk pace (about 150 words a minute). The finished video is sped up a little",
           "  (voice too, same pitch, at most 1.2 times) to fit 30 seconds and 5 minutes, so do not rush.",
           "- The times below are for the silent drafts; after the voice is in, they follow the voice.", ""]
    for video, title in (("demo", "30 second demo"), ("final", "Final video (3 to 5 minutes)")):
        sp = spec(video)
        sc, speed = sp["scenes"], sp["speed"]
        total = sum(s["seconds"] for s in sc)
        words = sum(len(s["say"].split()) for s in sc)
        out += [f"## {title}: {words} words, about {total:.0f} s as spoken, {total / speed:.0f} s at x{speed:.2f} (limit {sp['max']} s)", ""]
        t = 0.0
        for s in sc:
            d = s["seconds"] / speed
            out += [f"**{s['id']}** · {stamp(t, '.')[3:8]} to {stamp(t + d, '.')[3:8]} · *{SHOWS.get(s['id'], '')}*", "",
                    f"> {s['say']}", ""]
            t += d
    return "\n".join(out)


if __name__ == "__main__":
    main()
