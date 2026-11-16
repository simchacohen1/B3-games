/* Fun Torah Tools spoken words: for the Listen buttons inside activities only.
 * The site-wide audio on/off button, its replay button, and the instructions it read aloud as a student moved around
 * the site are gone. What stays is free browser speech that an activity's own Listen button asks for with
 * FTTAudio.speak(text,{force:true}). This file shows nothing, watches nothing and never speaks by itself.
 * It never makes a paid text-to-speech request.
 */
(function(root){
  "use strict";
  if(root.FTTAudio) return;
  const PREFER=[
    "Microsoft Guy Online (Natural)","Microsoft Guy",
    "Microsoft David","Microsoft Mark","Microsoft Christopher",
    "Daniel","Alex","Fred","Google UK English Male"
  ];
  const MALE_HINT=/\b(guy|david|mark|christopher|daniel|alex|fred|james|george|ryan|thomas|oliver|male)\b/i;
  const FEMALE_HINT=/\b(aria|jenny|ana|samantha|karen|zira|hazel|susan|female)\b/i;
  let voices=[];
  // Earlier versions saved the on/off choice and where the Audio button sat: clear them from this browser.
  try{
    for(const name of Object.keys(localStorage)){
      if(name.indexOf("fttAudioMode")===0)localStorage.removeItem(name);
    }
  }catch(_){}
  function refreshVoices(){
    if(!root.speechSynthesis)return;
    try{voices=root.speechSynthesis.getVoices()||[];}catch(_){}
  }
  refreshVoices();
  if(root.speechSynthesis&&root.speechSynthesis.addEventListener){
    root.speechSynthesis.addEventListener("voiceschanged",refreshVoices);
  }
  function bestVoice(){
    if(!voices.length)refreshVoices();
    const english=voices.filter(v=>/^en(?:-|_|\b)/i.test(v.lang||""));
    for(const preference of PREFER){
      const match=english.find(v=>v.name===preference || v.name.startsWith(preference+" -"));
      if(match)return match;
    }
    return english.find(v=>MALE_HINT.test(v.name)&&!FEMALE_HINT.test(v.name))||null;
  }
  function cleanText(value){
    return String(value||"").replace(/\s+/g," ").replace(/[🔊🎙🎉⭐✅]/gu,"").trim().slice(0,700);
  }
  function stop(){try{root.speechSynthesis?.cancel();}catch(_){}}
  // Speaks only when a Listen button asks for it (opts.force). Without that it does nothing.
  function speak(value,opts={}){
    if(!opts.force)return false;
    if(!root.speechSynthesis||!root.SpeechSynthesisUtterance)return false;
    const text=cleanText(value);
    if(!text)return false;
    try{
      stop();
      const u=new SpeechSynthesisUtterance(text);
      u.lang="en-US";u.rate=0.9;u.pitch=1;
      const voice=bestVoice();
      if(!voice){stop();console.info("Listen: no identified male English voice available on this device");return false;}
      u.voice=voice;
      root.speechSynthesis.speak(u);
      return true;
    }catch(e){console.warn("Listen unavailable",e);return false;}
  }
  root.addEventListener("pagehide",stop);
  // Kept so activities that ask still get an answer: there is no site-wide Audio mode any more.
  root.FTTAudio={enabled:()=>false,setEnabled(){},speak,stop,replay(){},bestVoice};
})(window);
