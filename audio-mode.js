/* Fun Torah Tools Audio Mode — shared, free browser speech.
 * Opt-in by student, remembers choice across activities. Does not call paid TTS.
 * This is a narrated learning aid, not a screen reader or a replacement for one.
 */
(function(root){
  "use strict";
  if(root.FTTAudio) return;
  const ID_KEY="fttAudioMode:20261011:";
  const PREFER=[
    "Microsoft Guy Online (Natural)","Microsoft Guy",
    "Microsoft David","Microsoft Mark","Microsoft Christopher",
    "Daniel","Alex","Fred","Google UK English Male"
  ];
  const MALE_HINT=/\b(guy|david|mark|christopher|daniel|alex|fred|james|george|ryan|thomas|oliver|male)\b/i;
  const FEMALE_HINT=/\b(aria|jenny|ana|samantha|karen|zira|hazel|susan|female)\b/i;
  let voices=[],button=null,replayButton=null,lastContext="",lastContent="",timer=null,previousStudentId="";
  const currentId=()=>{
    try{return sessionStorage.getItem("b3Games_studentId")||
      sessionStorage.getItem("posukPractice_studentId")||"device";}catch(_){return "device";}
  };
  const key=()=>ID_KEY+currentId();
  const enabled=()=>{try{return localStorage.getItem(key())==="on";}catch(_){return false;}};
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
    return english.find(v=>MALE_HINT.test(v.name))||
      english.find(v=>!FEMALE_HINT.test(v.name)&&/natural|neural|enhanced|premium/i.test(v.name))||
      english.find(v=>!FEMALE_HINT.test(v.name))||english[0]||null;
  }
  function cleanText(value){
    return String(value||"").replace(/\s+/g," ").replace(/[🔊🎙🎉⭐✅]/gu,"").trim().slice(0,700);
  }
  function stop(){try{root.speechSynthesis?.cancel();}catch(_){}}
  function speak(value,opts={}){
    if(!opts.force&&!enabled())return false;
    if(!root.speechSynthesis||!root.SpeechSynthesisUtterance)return false;
    const text=cleanText(value);
    if(!text)return false;
    try{
      stop();
      const u=new SpeechSynthesisUtterance(text);
      u.lang="en-US";u.rate=0.9;u.pitch=1;
      const voice=bestVoice();if(voice)u.voice=voice;
      root.speechSynthesis.speak(u);
      return true;
    }catch(e){console.warn("Audio Mode unavailable",e);return false;}
  }
  const $=(selector)=>document.querySelector(selector);
  function visible(el){
    if(!el||el.closest("[hidden],.hidden,[aria-hidden='true']"))return false;
    return !!(el.getClientRects().length&&getComputedStyle(el).visibility!=="hidden"&&getComputedStyle(el).display!=="none");
  }
  function getContext(){
    const url=location.pathname;
    if(/\/shorashim\//i.test(url)){
      if(!visible($("#studentView")))return null;
      const screen=$("#studentView .screen.active");
      const id=screen?.id||"studentHome";
      if(id==="learnScreen")return ["shorashim-learn","Choose the next Hebrew word. Read its English meaning and create your own flashcard. Save it when you are ready."];
      if(id==="reviewScreen")return ["shorashim-review","Look at the Hebrew word and try to remember its meaning. Turn over the card to check. I will read the English meaning when you flip it."];
      if(id==="gamesScreen"){
        const stage=$("#gameStage");
        const title=visible(stage)?cleanText(stage.querySelector(".game-head h3")?.textContent):"";
        if(title.includes("Target Shoot"))return ["shorashim-shoot","Read the Hebrew word, then aim at the moving English meaning that matches it."];
        if(title.includes("Whack-a-Word"))return ["shorashim-whack","Watch for the English meaning of the Hebrew word. Tap the matching word as it appears."];
        if(title.includes("Word Race"))return ["shorashim-race","Choose the correct English meaning for the Hebrew word before the timer finishes."];
        if(title.includes("Match"))return ["shorashim-match","Find the matching Hebrew and English words. Listen to each English meaning if you need help."];
        return ["shorashim-games","Choose a practice game. Each game will tell you what to do."];
      }
      if(id==="galleryScreen")return ["shorashim-gallery","These are the flashcards you have made. Choose a card to see it again."];
      return ["shorashim-home","Welcome to Shorashim. Learn a new Hebrew word, review your flashcards, or play a practice game."];
    }
    if(/\/record_pesukim\//i.test(url)){
      if(visible($("#translationPanel")))return ["posuk-translate","Say the English meaning of each highlighted Hebrew piece. Follow the instructions to record your answer."];
      if(visible($("#comprehensionPanel")))return ["posuk-understand","Listen to the question and answer in your own words. The feedback will tell you how you did."];
      if(visible($("#hebrewPanel")))return ["posuk-read","Read the Hebrew pasuk clearly, then record your reading."];
      return ["posuk-home","Choose a pasuk to practice. You can read, translate, and explain what it means."];
    }
    if(/\/weekly-quiz\/practice\.html/i.test(url)){
      if(visible($("#quizCard")))return ["quiz-practice-question","Listen to the question and the choices. Choose an answer, then check it."];
      if(visible($("#resultCard")))return ["quiz-practice-result","Great work finishing the practice quiz. You can review your score or try again."];
      return ["quiz-practice-start","Choose the pesukim and practice type. Then start a practice quiz."];
    }
    if(/\/weekly-quiz\//i.test(url)){
      if(visible($("#quizCard")))return ["quiz-question","Listen to the question and answers. Choose the answer you think is correct."];
      return ["quiz-home","Welcome to Weekly Quiz. Follow your teacher's instructions, or choose a practice activity."];
    }
    if(/\/rashi-letters\//i.test(url))return ["rashi","Practice recognizing Rashi letters. Read the letters and choose the matching answer."];
    if(/\/yiddish\//i.test(url))return ["yiddish","Practice your Yiddish words. Listen to the instructions in each activity and try your best."];
    if(/\/halacha\//i.test(url))return ["halacha","Read the lesson, then complete the activity or question on this page."];
    if(/\/chazara\//i.test(url))return ["chazara","Choose the pasuk you learned and record your chazara."];
    if(/\/class-gallery\//i.test(url))return ["gallery","Explore your class gallery. Choose an activity or an item to open it."];
    if(/\/student-rewards\//i.test(url))return ["rewards","Check your points and rewards. Choose something to learn more about it."];
    if(/\/game-show\//i.test(url))return ["gameshow","Listen for the question. Choose your answer when you are ready."];
    if(/\/gematria\//i.test(url))return ["gematria","Practice the number value of each Hebrew letter."];
    if(url==="/"||/\/index\.html$/i.test(url))return ["home","Welcome to Fun Torah Tools. Choose an activity to begin learning."];
    return ["activity","Listen to the instructions on this page. Choose an activity to begin."];
  }
  function currentLearningText(){
    const path=location.pathname;
    if(/\/shorashim\//i.test(path)){
      const screen=$("#studentView .screen.active")?.id;
      if(screen==="reviewScreen"){
        const e=$("#reviewEnglish");
        if(visible(e))return ["review-meaning:"+$("#reviewCounter")?.textContent+":"+e.textContent, "The English meaning is "+e.textContent];
      }
      if(screen==="learnScreen"){
        // Read only the currently selected card's English meaning, not every item in the list.
        const label=$("#editorTitle");
        if(visible(label)&&label.textContent.includes(" — ")){
          const text=label.textContent.split(" — ").slice(1).join(" — ").trim();
          if(text)return ["learn-word:"+text,"The English meaning is "+text];
        }
      }
    }
    if(/\/weekly-quiz\/practice\.html/i.test(path)&&visible($("#quizCard"))){
      const q=cleanText($("#question")?.textContent);
      if(q){
        const options=Array.from(document.querySelectorAll("#answers .answer")).map(e=>cleanText(e.textContent)).filter(Boolean);
        return ["practice-question:"+q,"Question: "+q+". "+(options.length?"Choices: "+options.join(". "):"")];
      }
    }
    if(/\/weekly-quiz\/index\.html/i.test(path)&&visible($("#quizCard"))){
      const q=cleanText($("#question")?.textContent);
      if(q)return ["weekly-question:"+q,"Question: "+q];
    }
    return null;
  }
  function refreshButton(){
    if(!button)return;
    const on=enabled();
    button.textContent=on?"🔊 Audio: On":"🔇 Audio: Off";
    button.setAttribute("aria-pressed",String(on));
    button.title=on?"Turn off spoken instructions":"Turn on spoken instructions";
    button.style.background=on?"#14532d":"#1f2937";
    if(replayButton)replayButton.hidden=!on;
  }
  function setEnabled(on){
    const value=!!on;
    try{localStorage.setItem(key(),value?"on":"off");}catch(_){}
    lastContext="";lastContent="";
    refreshButton();
    if(!value){stop();return;}
    const context=getContext();
    speak(context?.[1]||"Audio Mode is on. I will read instructions and English learning words.",{force:true});
    if(context)lastContext=context[0];
  }
  function replay(){
    const context=getContext();
    if(context)speak(context[1],{force:true});
  }
  function tick(){
    // The sign-in page can switch students without a full reload.
    const activeId=currentId();
    if(activeId!==previousStudentId){
      previousStudentId=activeId;lastContext="";lastContent="";
      refreshButton();
      if(!enabled())stop();
    }
    if(!enabled()||document.hidden)return;
    const context=getContext();
    if(context&&context[0]!==lastContext){
      lastContext=context[0];lastContent="";
      speak(context[1]);
      return;
    }
    const current=currentLearningText();
    if(current&&current[0]!==lastContent){
      lastContent=current[0];speak(current[1]);
    }else if(!current)lastContent="";
  }
  function init(){
    if(document.getElementById("ftt-audio-mode"))return;
    const wrap=document.createElement("div");
    wrap.id="ftt-audio-mode";
    wrap.style.cssText="position:fixed;right:10px;bottom:10px;z-index:2147483100;display:flex;align-items:center;gap:5px;font-family:Arial,sans-serif";
    button=document.createElement("button");
    button.type="button";
    button.style.cssText="border:2px solid #fff;color:white;border-radius:999px;padding:11px 14px;font:700 14px Arial,sans-serif;cursor:pointer;box-shadow:0 3px 12px #0005;min-height:44px";
    button.setAttribute("aria-label","Turn Audio Mode on or off");
    button.addEventListener("click",()=>setEnabled(!enabled()));
    replayButton=document.createElement("button");
    replayButton.type="button";replayButton.textContent="↻";
    replayButton.setAttribute("aria-label","Hear the instructions again");
    replayButton.title="Hear instructions again";
    replayButton.style.cssText="border:2px solid #fff;background:#fff;color:#1f2937;border-radius:999px;width:44px;height:44px;font-size:24px;font-weight:bold;cursor:pointer;box-shadow:0 3px 12px #0005";
    replayButton.addEventListener("click",replay);
    wrap.append(replayButton,button);
    document.body.appendChild(wrap);
    refreshButton();
    root.addEventListener("storage",e=>{if(e.key&&e.key.startsWith(ID_KEY)){refreshButton();if(!enabled())stop();}});
    root.addEventListener("pagehide",stop);
    // Speech normally requires a user gesture on some mobile browsers.
    document.addEventListener("pointerdown",()=>{if(enabled())refreshVoices();},{passive:true});
    timer=setInterval(tick,900);
    tick();
  }
  root.FTTAudio={enabled,setEnabled,speak,stop,replay,bestVoice};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})(window);
