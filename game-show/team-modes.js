/* Game Show team and multiple-choice round behavior.
 * UI helpers are opt-in through the teacher's independent mode switches.
 * Team assignment is balanced deterministically from the live roster.
 */
(function () {
  "use strict";
  const isTeacher = /teacher\.html$/i.test(location.pathname);
  // Fixed colors make verbal answers unambiguous when the teacher shares the screen.
  const choiceColors = Object.freeze([
    { label: "Red", bg: "#b42332", fg: "#ffffff" },
    { label: "Blue", bg: "#2056bd", fg: "#ffffff" },
    { label: "Green", bg: "#176b48", fg: "#ffffff" },
    { label: "Yellow", bg: "#ffd842", fg: "#172638" }
  ]);
  const choiceLabel = (choice, i) => (choiceColors[i]?.label || "Choice " + (i + 1)) + ": " + String(choice);
  function spokenQuestion(q) {
    if (!q || !q.q || !Array.isArray(q.choices)) return "";
    return "Question: " + q.q + ". " + q.choices.map((choice, i) => choiceLabel(choice, i)).join(". ") + ".";
  }
  const rosterOf = data => Object.keys((data && data.scores) || {}).sort((a,b)=>a.localeCompare(b));
  function teamsFor(data) {
    const roster = rosterOf(data);
    return { A: roster.filter((_,i)=>i%2===0), B: roster.filter((_,i)=>i%2===1) };
  }
  function teamFor(name,data) {
    const teams=teamsFor(data);
    return teams.A.includes(name)?"A":teams.B.includes(name)?"B":null;
  }
  function contestantsFor(data,qIndex) {
    const teams=teamsFor(data);
    return {A:teams.A.length?teams.A[qIndex%teams.A.length]:null,
            B:teams.B.length?teams.B[qIndex%teams.B.length]:null};
  }
  function canAnswerChoice(data, name) {
    if (!data || data.roundActive !== true || data.multipleChoice !== true || (data.answerState || data.narrationLocked)) return false;
    if (data.teamMode) return data.helperName ? data.helperName === name : data.buzzedBy === name;
    return data.buzzedBy === name;
  }

  // Expose the pure helpers for regression tests and diagnostics.
    function applyChoice(current, actor, choiceIndex, correctIndex, now = Date.now()) {
    if (!canAnswerChoice(current, actor)) return undefined;
    const team = teamFor(actor, current);
    if (current.teamMode && !team) return undefined;
    const correct = Number(choiceIndex) === Number(correctIndex);
    const next = { ...current };
    if (current.teamMode) {
      next.teamScores = { ...(current.teamScores || { A: 0, B: 0 }) };
      next.teamScores[team] = (Number(next.teamScores[team]) || 0) + (correct ? 10 : -5);
    } else {
      next.scores = { ...(current.scores || {}) };
      next.scores[actor] = (Number(next.scores[actor]) || 0) + (correct ? 10 : -5);
    }
    const outcome = { outcome: correct ? "correct" : "incorrect", by: actor, team: team || null, choice: Number(choiceIndex), at: now };
    next.answerState = outcome;
    if (correct) {
      next.revealed = true;
      next.stealTeam = null;
    } else if (current.teamMode && !current.stealUsed) {
      next.lastAnswerState = outcome;
      next.answerState = null;
      next.stealTeam = team === "A" ? "B" : "A";
      next.stealUsed = true;
      next.buzzedBy = null;
      next.selectedPlayer = null;
      next.helperName = null;
    } else {
      next.revealed = true;
      next.stealTeam = null;
    }
    return next;
  }

  // Expose pure helpers for regression tests and diagnostics.
  window.GameShowTeamModeLogic = { teamsFor, teamFor, contestantsFor, canAnswerChoice, applyChoice, choiceColors, choiceLabel, spokenQuestion };
  function questionAt(data) {
    return Array.isArray(questions) ? questions[Number(data?.qIndex)||0] : null;
  }

  if (isTeacher) {
    const setup=document.querySelector("#tabSetup .setup-grid");
    const buzzerCard=[...setup.querySelectorAll(".card")].find(el=>el.querySelector("#delayToggle"));
    if (setup && buzzerCard) {
      const card=document.createElement("section");
      card.className="card";
      card.innerHTML='<h3>Game modes</h3><p class="hint">Choose each mode independently. Team contestants rotate through the class roster.</p>'+
        '<label class="setting"><span class="label"><b>Team Mode</b><span>Two balanced teams; one contestant per team each round.</span></span><span class="ctrl"><input type="checkbox" class="switch" id="teamModeToggle" aria-label="Team Mode"></span></label>'+
        '<label class="setting"><span class="label"><b>Multiple Choice</b><span>Students choose from the answers you add to each question.</span></span><span class="ctrl"><input type="checkbox" class="switch" id="multipleChoiceToggle" aria-label="Multiple Choice"></span></label>'+
        '<label class="setting"><span class="label"><b>Read question and colored choices aloud</b><span>Teacher reads Red, Blue, Green, Yellow. Buzzers stay locked until the reading ends.</span></span><span class="ctrl"><input type="checkbox" class="switch" id="readChoicesToggle" aria-label="Read question and colored choices aloud"></span></label>'+
        '<button class="btn" type="button" id="stopNarrationBtn">Stop reading and open buzzers</button>'+
        '<div id="teamModeSummary" class="status-line" aria-live="polite"></div>';
      buzzerCard.insertAdjacentElement("afterend",card);
      const save=()=>gameRef.update({
        teamMode:document.getElementById("teamModeToggle").checked,
        multipleChoice:document.getElementById("multipleChoiceToggle").checked,
        readChoices:document.getElementById("readChoicesToggle").checked
      }).catch(()=>{document.getElementById("teamModeSummary").textContent="Could not save game modes.";});
      document.getElementById("teamModeToggle").addEventListener("change",save);
      document.getElementById("multipleChoiceToggle").addEventListener("change",save);
      document.getElementById("readChoicesToggle").addEventListener("change",save);
    }

    // Extend the existing question editor without changing legacy questions.
    const originalCreate=window.createQuestionRow;
    const originalSave=window.saveEditor;
    window.createQuestionRow=function(q,ans,choices,correctIndex){
      return originalCreate(q||"",ans||"",choices,correctIndex);
    };
    window.renderEditor=function(data){
      const list=document.getElementById("editorList");list.replaceChildren();
      (data||[]).forEach(item=>list.appendChild(window.createQuestionRow(item.q,item.ans,item.choices,item.correctIndex)));
    };
    window.saveEditor=function(){
      const rows=[...document.querySelectorAll("#editorList > .editor-row")];
      const next=rows.map(row=>{
        const choices=(row.querySelector(".row-choices")?.value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        const correct=Number(row.querySelector(".row-correct")?.value);
        const item={q:row.querySelector(".row-q").value.trim(),ans:row.querySelector(".row-ans").value.trim()};
        if(choices.length){item.choices=choices;if(Number.isInteger(correct)&&correct>0&&correct<=choices.length)item.correctIndex=correct-1;}
        return item;
      }).filter(item=>item.q||item.ans);
      if(!next.length){alert("There's nothing to save - add at least one question first.");return;}
      if(document.getElementById("multipleChoiceToggle")?.checked&&next.some(q=>!q.choices?.length||!Number.isInteger(q.correctIndex))){
        alert("For Multiple Choice, add answer choices and the correct choice number to every question.");return;
      }
      setRef.set({title:ACTIVE_SET_TITLE,questions:next}).then(()=>{
        document.getElementById("soundStatus").textContent="Saved ("+next.length+" questions)";
        closeEditor();
      }).catch(err=>{document.getElementById("soundStatus").textContent="Save error: "+err.message;});
    };

    const teacherBoard = document.createElement("div");
    teacherBoard.id = "teacherColorChoices";
    teacherBoard.setAttribute("aria-label", "Multiple-choice answer colors");
    teacherBoard.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;width:100%;margin:10px auto;max-width:950px;";
    const questionCard = document.querySelector("#tabPlay .qcard");
    if (questionCard) questionCard.insertBefore(teacherBoard, questionCard.querySelector("#answer"));
    const colorsCss = choiceColors.map((c, i) => ".gs-color-choice:nth-child(" + (i + 1) + "){background:" + c.bg + ";color:" + c.fg + ";}").join("");
    const style = document.createElement("style");
    style.textContent = ".gs-color-choice{border-radius:12px;padding:12px;min-width:0;font-weight:800;font-size:clamp(15px,1.6vw,24px);overflow-wrap:anywhere;text-align:center;border:2px solid #fff8;}" + colorsCss;
    document.head.appendChild(style);
    function renderTeacherChoices(data) {
      const q = questionAt(data);
      teacherBoard.replaceChildren();
      teacherBoard.hidden = !(data.multipleChoice && q?.choices?.length);
      if (teacherBoard.hidden) return;
      q.choices.forEach((answer, i) => {
        const cell = document.createElement("div");
        cell.className = "gs-color-choice";
        cell.textContent = choiceLabel(answer, i);
        teacherBoard.appendChild(cell);
      });
    }

    let currentSpeech = null;
    let narrationTimeout = null;
    function cancelSpeech() {
      if (narrationTimeout) clearTimeout(narrationTimeout);
      narrationTimeout = null;
      currentSpeech = null;
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    }
    function releaseNarration(token) {
      if (!token) return;
      if (narrationTimeout) clearTimeout(narrationTimeout);
      narrationTimeout = null;
      currentSpeech = null;
      const delay = document.getElementById("delayToggle")?.checked
        ? (Number(document.getElementById("delaySeconds")?.value) || 10) * 1000 : 0;
      gameRef.transaction(current => {
        if (!current || current.roundToken !== token || !current.narrationLocked) return;
        const unlockAt = serverNow() + delay;
        current.narrationLocked = false;
        current.buzzUnlockAt = unlockAt;
        current.buzzOpenAt = unlockAt;
        return current;
      }, (err, committed) => {
        if (err) document.getElementById("soundStatus").textContent = "Could not open buzzers after reading. Use the stop-reading button.";
        else if (committed) document.getElementById("soundStatus").textContent = delay
          ? "Reading complete. Buzzer countdown started." : "Reading complete. Buzzers open!";
      });
    }
    function speakAndRelease(q, token) {
      if (!token) return;
      const status = document.getElementById("soundStatus");
      const content = spokenQuestion(q);
      if (!content || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        status.textContent = "Speech is not available in this browser. Opening the buzzers.";
        releaseNarration(token);
        return;
      }
      cancelSpeech();
      try {
        const utterance = new SpeechSynthesisUtterance(content);
        utterance.lang = "en-US";
        utterance.rate = 0.88;
        currentSpeech = utterance;
        utterance.onend = () => { if (currentSpeech === utterance) releaseNarration(token); };
        utterance.onerror = () => {
          if (currentSpeech !== utterance) return;
          status.textContent = "Audio could not finish. Opening buzzers.";
          releaseNarration(token);
        };
        status.textContent = "Reading question and Red, Blue, Green, Yellow. Buzzers locked.";
        narrationTimeout = setTimeout(() => {
          if (currentSpeech !== utterance) return;
          cancelSpeech();
          status.textContent = "Reading timed out; buzzers will open.";
          releaseNarration(token);
        }, 90000);
        window.speechSynthesis.speak(utterance);
      } catch (_) {
        status.textContent = "Audio could not start. Opening buzzers.";
        releaseNarration(token);
      }
    }
    document.getElementById("stopNarrationBtn")?.addEventListener("click", () => {
      cancelSpeech();
      const token = lastGameData?.roundToken;
      releaseNarration(token);
    });

    // The teacher opens a round only after assigning the fair rotating contestants.
    window.startQuestion=function(options={}){
      ensureAudioAwake();
      const data=lastGameData||{};
      const qIndex=Number.isInteger(options.qIndex)?options.qIndex:(Number(data.qIndex)||0), q=questions?.[qIndex];
      if(!q){document.getElementById("soundStatus").textContent="Add a question before starting the round.";return;}
      const teamMode=!!document.getElementById("teamModeToggle")?.checked;
      const mc=!!document.getElementById("multipleChoiceToggle")?.checked;
      const shouldStart = options.startImmediately !== false;
      const narrate = shouldStart && mc && !!document.getElementById("readChoicesToggle")?.checked;
      const roundToken = serverNow() + ":" + qIndex + ":" + (Number(data.teamRoundCount)||0);
      if(mc&&(!q.choices?.length||!Number.isInteger(q.correctIndex))){
        document.getElementById("soundStatus").textContent="Add choices and mark the correct choice before starting.";return;
      }
      const now=serverNow(),delayOn=document.getElementById("delayToggle").checked;
      const unlockAt=delayOn?now+(parseInt(document.getElementById("delaySeconds").value)||10)*1000:now;
      const rotation=Number(data.teamRoundCount)||0;
      const contestants=teamMode?contestantsFor(data,rotation):null;
      if(teamMode&&(!contestants.A||!contestants.B)){
        document.getElementById("soundStatus").textContent="Team Mode needs at least two students in the game.";return;
      }
      cancelSpeech();
      gameRef.update({
        qIndex,showStarted:options.showStarted === true ? true : !!data.showStarted,
        roundActive:shouldStart,revealed:false,buzzedBy:null,selectedPlayer:null,buzzPool:null,
        buzzUnlockAt:narrate ? 0 : (shouldStart ? unlockAt : 0),
        buzzOpenAt:narrate ? 0 : (shouldStart ? unlockAt : 0),
        narrationLocked:narrate,roundToken,readChoices:!!document.getElementById("readChoicesToggle")?.checked,
        teamMode,multipleChoice:mc,contestants:shouldStart?contestants:null,
        teamRoundCount:teamMode&&shouldStart?rotation+1:rotation,
        helperName:null,answerState:null,lastAnswerState:null,stealTeam:null,stealUsed:false
      }).then(() => {
        if (narrate) speakAndRelease(q, roundToken);
      }).catch(err => {
        document.getElementById("soundStatus").textContent = "Could not start round: " + err.message;
      });
    };
    // Do not open the next buzzer for even a moment before narration starts.
    window.startGameShow=function(){
      window.startQuestion({showStarted:true});
    };
    window.goToQuestion=function(index){
      if (document.getElementById("jumpMenu")) document.getElementById("jumpMenu").open=false;
      window.startQuestion({qIndex:index,startImmediately:!!lastGameData?.showStarted});
    };
    const originalAdjust=window.adjustSelectedScore;
    window.adjustSelectedScore=function(delta){
      const data=lastGameData||{};
      if(!data.teamMode){originalAdjust(delta);return;}
      const selected=data.selectedPlayer;
      const team=teamFor(selected,data);
      if(!team){alert("Select a contestant on a team first.");return;}
      const amount=delta>0?10:-5;
      gameRef.child("teamScores/"+team).transaction(n=>(Number(n)||0)+amount);
      document.getElementById("soundStatus").textContent=team+" gets "+(amount>0?"+":"")+amount+" points.";
    };
    gameRef.on("value",snap=>{
      const data=snap.val()||{};
      const team=document.getElementById("teamModeToggle");
      const mc=document.getElementById("multipleChoiceToggle");
      if(team)team.checked=!!data.teamMode;if(mc)mc.checked=!!data.multipleChoice;
      const reader=document.getElementById("readChoicesToggle");
      if(reader)reader.checked=!!data.readChoices;
      renderTeacherChoices(data);
      const summary=document.getElementById("teamModeSummary");
      if(summary){
        if(data.teamMode){
          const teams=teamsFor(data);
          summary.textContent="Team A ("+(data.teamScores?.A||0)+"): "+(teams.A.join(", ")||"waiting")+
            " · Team B ("+(data.teamScores?.B||0)+"): "+(teams.B.join(", ")||"waiting");
          if(data.contestants)summary.textContent+=" · This round: "+(data.contestants.A||"—")+" vs "+(data.contestants.B||"—");
        }else summary.textContent="";
      }
    });
  } else {
    const panel=document.querySelector("#gameArea .panel");
    if(panel){
      const area=document.createElement("section");
      area.id="answerChoiceArea";area.className="answer-choice-area";area.hidden=true;
      area.innerHTML='<div class="team-label" id="myTeamLabel"></div><div id="helperPicker" hidden><label for="helperSelect">Choose one teammate to help</label><select id="helperSelect"></select><button type="button" id="askHelperBtn">Ask this teammate</button></div><div id="choiceButtons"></div><div id="answerFeedback" aria-live="polite"></div>';
      const style=document.createElement("style");
      style.textContent="#answerChoiceArea{margin-top:16px;padding:14px;border:2px solid #7ec8ff;border-radius:16px;background:#09203c}#answerChoiceArea[hidden],[hidden]{display:none!important}#answerChoiceArea button,#answerChoiceArea select{font:700 16px Arial,sans-serif;margin:5px;padding:10px 14px;border-radius:10px;cursor:pointer}#choiceButtons{display:grid;gap:8px}#choiceButtons button{width:100%;text-align:left;background:#f4f9ff;color:#10243d;border:2px solid #7ec8ff}.team-label{font-weight:800;margin-bottom:8px}#answerFeedback{font-weight:800;margin-top:8px}";
      document.head.appendChild(style);panel.appendChild(area);
      document.getElementById("askHelperBtn").addEventListener("click",()=>{
        const helper=document.getElementById("helperSelect").value;
        gameRef.transaction(current=>{
          if(!current||!current.teamMode||!current.multipleChoice||current.roundActive!==true||
             current.buzzedBy!==myName||!helper||teamFor(helper,current)!==teamFor(myName,current)||
             helper===myName||current.answerState)return;
          current.helperName=helper;return current;
        });
      });
    }
    const originalBuzz=window.buzzIn;
    window.buzzIn=function(){
      const data=lastData||{};
      if(!data.teamMode){originalBuzz();return;}
      if(!data.roundActive||!data.contestants||![data.contestants.A,data.contestants.B].includes(myName))return;
      if(data.stealTeam&&teamFor(myName,data)!==data.stealTeam)return;
      if(data.buzzedBy||!myName)return;
      gameRef.transaction(current=>{
        if(!current||current.roundActive!==true||current.buzzedBy||
           !current.contestants||![current.contestants.A,current.contestants.B].includes(myName)||
           (current.stealTeam&&teamFor(myName,current)!==current.stealTeam)||
           (current.narrationLocked || serverNow()<(current.buzzUnlockAt||0)))return;
        const round=String(current.buzzOpenAt||0)+":"+(current.qIndex||0);
        if(current.lastWinnerRound!==round){
          current.lastWinnerStreak=current.lastWinner===myName?(current.lastWinnerStreak||0)+1:1;
          current.lastWinner=myName;current.lastWinnerRound=round;
        }
        current.buzzedBy=myName;current.selectedPlayer=myName;current.helperName=null;
        return current;
      },(err,committed)=>{if(!err&&committed)playBuzzSound();});
    };

    function submitChoice(index){
      const q=questionAt(lastData);
      if(!q||!Number.isInteger(q.correctIndex))return;
      gameRef.transaction(current=>{
        if(Number(current?.qIndex)!==Number(lastData?.qIndex))return;
        return applyChoice(current,myName,index,q.correctIndex);
      },(err,committed)=>{if(err)document.getElementById("answerFeedback").textContent="Could not submit. Try again.";});
    }

    function updateChoices(data){
      const area=document.getElementById("answerChoiceArea");if(!area)return;
      const q=questionAt(data),team=teamFor(myName,data);
      const eligibleContestant=!!(data.contestants&&data.contestants[team]===myName);
      const isHelper=data.helperName===myName;
      const myTeamLabel=document.getElementById("myTeamLabel");
      myTeamLabel.textContent=data.teamMode?(team?"You are on Team "+team+".":"Waiting for team assignment."):"";
      const choiceActor=canAnswerChoice(data,myName);
      const shouldShow=!!(data.multipleChoice&&data.roundActive&&q?.choices?.length);
      area.hidden=!shouldShow;
      if(!shouldShow)return;
      const picker=document.getElementById("helperPicker");
      picker.hidden=!(data.teamMode&&data.multipleChoice&&data.buzzedBy===myName&&!data.helperName&&!data.answerState);
      const select=document.getElementById("helperSelect");
      if(picker.hidden===false){
        const teamRoster=teamsFor(data)[team]||[];
        select.replaceChildren(...teamRoster.filter(n=>n!==myName).map(name=>{const o=document.createElement("option");o.value=name;o.textContent=name;return o;}));
        document.getElementById("askHelperBtn").disabled=!select.options.length;
      }
      const buttons=document.getElementById("choiceButtons");buttons.replaceChildren();
      q.choices.forEach((choice,index)=>{
        const button=document.createElement("button");
        button.type="button";
        button.textContent=choiceLabel(choice,index);
        const color=choiceColors[index];
        if(color){button.style.background=color.bg;button.style.color=color.fg;button.style.borderColor=color.fg;}
        button.style.fontWeight="900";
        button.disabled=!choiceActor;
        button.setAttribute("aria-label",choiceLabel(choice,index));
        button.addEventListener("click",()=>submitChoice(index));
        buttons.appendChild(button);
      });
      document.getElementById("answerFeedback").textContent=data.answerState
        ? (data.answerState.outcome==="correct"?"Correct! Points were added automatically.":"Not quite. The answer is revealed.")
        : data.narrationLocked ? "Listen to the question and colors before buzzing."
        : choiceActor ? (isHelper?"You are helping. Choose an answer for your team.":data.stealTeam?"The other team missed. Choose an answer to steal.":"Choose an answer, or ask one teammate to help.")
        : data.buzzedBy ? "Waiting for the selected player to answer." : "Listen, then buzz in when the buzzer opens.";
    }
    const originalRender=window.renderGameSnapshot;
    window.renderGameSnapshot=function(snapshot){originalRender(snapshot);updateChoices(snapshot.val()||{});};
    gameRef.on("value",snap=>updateChoices(snap.val()||{}));
    const originalAvail=window.updateBuzzAvailability;
    window.updateBuzzAvailability=function(){
      originalAvail();
      const data=lastData||{};
      if (data.narrationLocked) {
        const b=document.getElementById("buzzBtn");
        b.disabled=true;
        document.getElementById("countdown").textContent="Listen to the question and colors…";
      }
      if(data.teamMode){
        const team=teamFor(myName,data);
        const eligible=!!(data.contestants&&data.contestants[team]===myName&&(!data.stealTeam||data.stealTeam===team));
        if(!eligible){const b=document.getElementById("buzzBtn");b.disabled=true;document.getElementById("countdown").textContent="";}
      }
    };
  }
})();
