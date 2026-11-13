#!/usr/bin/env bash
# Builds the synthetic audio set used to check the instant silence check of Chazara AI Practice.
# Needs ffmpeg and espeak-ng. Synthetic voices only: this checks that silence and very short
# clips are stopped and everything with sound is sent on — NOT transcription quality for children.
#   bash scripts/chazara-ai-make-signal-set.sh <empty-output-dir>
#   node scripts/chazara-ai-audio-eval.cjs <output-dir>/manifest.json --silence-only
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
ffmpeg $q -i en_explain.wav -af "atrim=0:1" short1.wav
ffmpeg $q -i full.wav -af "volume=0.08" speech_whisper.wav
ffmpeg $q -i full.wav -af "volume=30" speech_clipped.wav
ffmpeg $q -f lavfi -i "anoisesrc=d=14:c=pink:a=0.25" -ar 48000 noise_loud.wav
for f in full speech_softnoise speech_midnoise speech_loudnoise silence room_quiet short1 speech_whisper speech_clipped noise_loud; do
  ffmpeg $q -i "$f.wav" -c:a libopus -b:a 32k -ac 1 "$f.webm"   # what Chrome's recorder sends
done
cat > manifest.json <<'JSON'
{ "cases": [
  {"name":"synthetic-voice-hebrew+english-clean","files":["full.webm"],"expect":"pass"},
  {"name":"synthetic-voice-soft-background","files":["speech_softnoise.webm"],"expect":"pass"},
  {"name":"synthetic-voice-moderate-background","files":["speech_midnoise.webm"],"expect":"pass"},
  {"name":"synthetic-voice-loud-background","files":["speech_loudnoise.webm"],"expect":"pass"},
  {"name":"very-quiet-voice","files":["speech_whisper.webm"],"expect":"pass"},
  {"name":"distorted-clipped-voice","files":["speech_clipped.webm"],"expect":"pass"},
  {"name":"loud-noise-only (transcription step decides)","files":["noise_loud.webm"],"expect":"pass"},
  {"name":"digital-silence","files":["silence.webm"],"expect":"unclear"},
  {"name":"quiet-room-no-speech","files":["room_quiet.webm"],"expect":"unclear"},
  {"name":"one-second-clip","files":["short1.webm"],"expect":"unclear"},
  {"name":"multi-pasuk-one-silent","files":["full.webm","silence.webm"],"expect":"unclear"}
]}
JSON
echo "Done: $D/manifest.json"
