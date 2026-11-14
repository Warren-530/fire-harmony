#!/bin/bash
# contact sheet of recorded scenes: sheet.sh <out.png> <frames per scene> <scene.mp4>...
FF=$(~/nasa_work/fire-harmony/.venv/bin/python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
out=$1; k=$2; shift 2
tmp=$(mktemp -d)
i=0
for v in "$@"; do
  d=$($FF -hide_banner -i "$v" 2>&1 | grep -oE "Duration: [0-9:.]+" | awk -F'[: ]' '{print $3*3600+$4*60+$5}')
  for j in $(seq 0 $((k-1))); do
    t=$(awk -v d="$d" -v j="$j" -v k="$k" 'BEGIN{printf "%.2f", (j+0.5)*d/k}')
    $FF -hide_banner -loglevel error -y -ss "$t" -i "$v" -frames:v 1 -vf "scale=480:-1,drawtext=text='$(basename "$v" .mp4) $t':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6" "$tmp/$(printf %04d $i).png"
    i=$((i+1))
  done
done
$FF -hide_banner -loglevel error -y -framerate 1 -i "$tmp/%04d.png" -vf "tile=${k}x$(( (i + k - 1) / k ))" -frames:v 1 "$out"
rm -r "$tmp"
