/* Quiz Party's original looping jingle and optional cloud announcer.
 * Only teacher playback is audible in screen shares. Does not record audio.
 */
(function (root) {
  "use strict";
  const TTS_URL = "https://us-central1-b3-games.cloudfunctions.net/synthesizeSpeech";
  let ctx = null, loop = null, gain = null, enabled = false, volume = 0.16;
  let currentAudio = null, currentSpeech = null, pending = null, sequence = 0;
  let voiceStyle = "cloud";
  const cache = new Map();
  function getContext() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  function setVolume(value) {
    volume = Math.max(0, Math.min(0.35, Number(value) || 0));
    if (gain && ctx) gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
  }
  // A short, original eight-beat melody in C major. No borrowed Kahoot music.
  const melody = [523.25,659.25,783.99,659.25,880,783.99,659.25,523.25,
    587.33,698.46,880,698.46,783.99,659.25,587.33,392];
  function scheduleMusic() {
    if (!enabled || !ctx || !gain) return;
    const start = ctx.currentTime + 0.04;
    melody.forEach((f,i) => {
      const at = start + i * 0.19, osc = ctx.createOscillator(), env = ctx.createGain();
      osc.type = i%4 === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(f,at);
      env.gain.setValueAtTime(0.0001,at);
      env.gain.exponentialRampToValueAtTime(0.21,at+0.017);
      env.gain.exponentialRampToValueAtTime(0.0001,at+0.14);
      osc.connect(env);env.connect(gain);osc.start(at);osc.stop(at+0.15);
    });
  }
  function music(on) {
    enabled = !!on;
    if (loop) clearInterval(loop);
    loop = null;
    if (!enabled) {
      if (gain && ctx) gain.gain.setTargetAtTime(0,ctx.currentTime,0.04);
      return;
    }
    try {
      const audio = getContext();
      if (!gain) { gain = audio.createGain();gain.connect(audio.destination); }
      gain.gain.setValueAtTime(volume,audio.currentTime);
      scheduleMusic();
      loop = setInterval(scheduleMusic, 16 * 190);
    } catch (_) { enabled = false; }
  }
  function duck(on) {
    if (!ctx || !gain) return;
    gain.gain.setTargetAtTime(enabled ? (on ? volume * 0.12 : volume) : 0,ctx.currentTime,0.06);
  }
  function stopSpeech() {
    sequence++;
    if (pending) { pending.abort();pending=null; }
    if (currentAudio) { currentAudio.pause();currentAudio.onended=null;currentAudio.onerror=null;currentAudio=null; }
    if (currentSpeech && root.speechSynthesis) { root.speechSynthesis.cancel();currentSpeech=null; }
    duck(false);
  }
  function sayBrowser(text,token) {
    return new Promise(resolve => {
      if (token !== sequence || !root.speechSynthesis || !root.SpeechSynthesisUtterance) return resolve(false);
      const utterance = new root.SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";utterance.rate = 1.03;utterance.pitch = 1.05;
      const voices = root.speechSynthesis.getVoices?.()||[];
      utterance.voice = voices.find(v=>/Microsoft Guy|Microsoft David|Google UK English Male|Daniel/i.test(v.name))
        || voices.find(v=>/^en(-|_)/i.test(v.lang)) || null;
      currentSpeech=utterance;
      utterance.onend=()=>{if(token===sequence){currentSpeech=null;resolve(true);}else resolve(false);};
      utterance.onerror=()=>{if(token===sequence)currentSpeech=null;resolve(false);};
      try { root.speechSynthesis.cancel();root.speechSynthesis.speak(utterance); }
      catch (_) { currentSpeech=null;resolve(false); }
    });
  }
  async function speak(text) {
    stopSpeech();
    const token=sequence;
    duck(true);
    try {
      if (voiceStyle !== "browser" && root.B3PaidApi && root.Audio) {
        let data=cache.get(text);
        if (!data) {
          const controller=new AbortController();pending=controller;
          const response=await root.B3PaidApi.fetch(TTS_URL,{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({text:String(text).slice(0,2800)}),signal:controller.signal
          });
          pending=null;
          if(!response.ok)throw new Error("Cloud announcer unavailable");
          const payload=await response.json();
          if(!payload.audioContent)throw new Error("No audio received");
          data="data:audio/mpeg;base64,"+payload.audioContent;
          if(cache.size>35)cache.delete(cache.keys().next().value);
          cache.set(text,data);
        }
        if(token!==sequence)return false;
        const audio=new root.Audio(data); currentAudio=audio;
        const played=new Promise(resolve=>{
          audio.onended=()=>resolve(true);
          audio.onerror=()=>resolve(false);
        });
        await audio.play();
        const result=await played;
        if(token!==sequence)return false;
        currentAudio=null;
        return result || await sayBrowser(text,token);
      }
      return await sayBrowser(text,token);
    } catch (_) {
      if(token!==sequence)return false;
      return await sayBrowser(text,token);
    } finally {
      if (token === sequence) duck(false);
    }
  }
  function setVoice(mode){voiceStyle=mode==="browser"?"browser":"cloud";}
  root.GameShowPartyAudio=Object.freeze({
    music,speak,stopSpeech,setVolume,setVoice,duck,
    get musicEnabled(){return enabled;}
  });
})(window);
