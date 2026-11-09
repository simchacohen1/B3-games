#!/usr/bin/env bash
# Builds the synthetic audio set used to check step 1 (audio validity) of Chazara AI Practice.
# Needs ffmpeg and espeak-ng. Synthetic voices only: this checks silence/noise/short/clipping
# detection on real decoded audio files, NOT speech-recognition accuracy for children.
#   bash scripts/chazara-ai-make-signal-set.sh <empty-output-dir>
#   node scripts/chazara-ai-audio-eval.cjs <output-dir>/manifest.json --signal-only
set -euo pipefail
D="${1:?output directory}"; mkdir -p "$D"; cd "$D"
q="-loglevel error -y"
espeak-ng -v he -p 75 -s 120 -w he_read.wav "וַיֵּרָא אֵלָיו השם בְּאֵלֹנֵי מַמְרֵא וְהוּא יֹשֵׁב פֶּתַח הָאֹהֶל כְּחֹם הַיּוֹם"
espeak-ng -v en-us -p 80 -s 140 -w en_explain.wav "Hashem appeared to Avraham in the plains of Mamre, while he was sitting at the entrance of the tent, in the heat of the day."
ffmpeg $q -i he_read.wav -i en_explain.wav -filter_complex "[0][1]concat=n=2:v=0:a=1,aresample=48000" full.wav
ffmpeg $q -f lavfi -i "anoisesrc=d=40:c=pink:a=0.02" -ar 48000 n_soft.wav
ffmpeg $q -f lavfi -i "anoisesrc=d=40:c=pink:a=0.06" -ar 48000 n_mid.wav
ffmpeg $q -f lavfi -i "anoisesrc=d=40:c=pink:a=0.25" -ar 48000 n_loud.wav
ffmpeg $q -i full.wav -i n_soft.wav -filter_complex "amix=inputs=2:duration=first:normalize=0" speech_softnoise.wav
ffmpeg $q -i full.wav -i n_mid.wav -filter_complex "[0]volume=0.6[a];[a][1]amix=inputs=2:duration=first:normalize=0" speech_midnoise.wav
ffmpeg $q -i full.wav -i n_loud.wav -filter_complex "[0]volume=0.35[a];[a][1]amix=inputs=2:duration=first:normalize=0" speech_loudnoise.wav
ffmpeg $q -f lavfi -i "anullsrc=r=48000:cl=mono" -t 10 silence.wav
ffmpeg $q -f lavfi -i "anoisesrc=d=10:c=white:a=0.0005" room_quiet.wav
ffmpeg $q -i en_explain.wav -af "atrim=0:1,apad=whole_dur=8" short.wav
ffmpeg $q -i full.wav -af "volume=0.08" speech_whisper.wav
ffmpeg $q -i full.wav -af "volume=30" speech_clipped.wav
ffmpeg $q -f lavfi -i "anoisesrc=d=14:c=pink:a=0.25" -ar 48000 noise_loud.wav
for f in full speech_softnoise speech_midnoise speech_loudnoise silence room_quiet short speech_whisper speech_clipped noise_loud; do
  ffmpeg $q -i "$f.wav" -c:a libopus -b:a 32k -ac 1 "$f.webm"   # what Chrome's recorder sends
done
cat > manifest.json <<'JSON'
{ "items": {}, "cases": [
  {"name":"synthetic-voice-hebrew+english-clean","files":["full.webm"],"expect":"ok"},
  {"name":"synthetic-voice-soft-background","files":["speech_softnoise.webm"],"expect":"ok"},
  {"name":"synthetic-voice-moderate-background","files":["speech_midnoise.webm"],"expect":"ok"},
  {"name":"synthetic-voice-loud-background","files":["speech_loudnoise.webm"],"expect":"noisy"},
  {"name":"digital-silence","files":["silence.webm"],"expect":"silent"},
  {"name":"quiet-room-no-speech","files":["room_quiet.webm"],"expect":"silent"},
  {"name":"one-second-then-nothing","files":["short.webm"],"expect":"too_short"},
  {"name":"very-quiet-voice","files":["speech_whisper.webm"],"expect":"ok"},
  {"name":"distorted-clipped-voice","files":["speech_clipped.webm"],"expect":"noisy"},
  {"name":"loud-noise-only","files":["noise_loud.webm"],"expect":"noisy"}
]}
JSON
echo "Done: $D/manifest.json"
