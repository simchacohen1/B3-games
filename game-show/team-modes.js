/* Game Show team and multiple-choice round behavior.
 * UI helpers are opt-in through the teacher's independent mode switches.
 * Team assignment is balanced deterministically from the live roster.
 */
(function () {
  "use strict";
  const isTeacher = /teacher\.html$/i.test(location.pathname);
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
  function questionAt(data) {
    return Array.isArray(window.questions) ? window.questions[Number(data?.qIndex)||0] : null;
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
        '<div id="teamModeSummary" class="status-line" aria-live="polite"></div>';
      buzzerCard.insertAdjacentElement("afterend",card);
      const save=()=>gameRef.update({
        teamMode:document.getElementById("teamModeToggle").checked,
        multipleChoice:document.getElementById("multipleChoiceToggle").checked
      }).catch(()=>{document.getElementById("teamModeSummary").textContent="Could not save game modes.";});
      document.getElementById("teamModeToggle").addEventListener("change",save);
      document.getElementById("multipleChoiceToggle").addEventListener("change",save);
    }

    // Extend the existing question editor without changing legacy questions.
    const originalCreate=window.createQuestionRow;
    const originalSave=window.saveEditor;
    window.createQuestionRow=function(q,ans,choices,correctIndex){
      const row=originalCreate(q||"",ans||"");
      const list=Array.isArray(choices)?choices:[];
      const label=document.createElement("label");label.textContent="Answer choices (one per line)";
      const area=document.createElement("textarea");area.className="row-choices";area.value=list.join("\n");area.placeholder="Choice 1\nChoice 2\nChoice 3\nChoice 4";
      const correctLabel=document.createElement("label");correctLabel.textContent="Correct choice number";
      const correct=document.createElement("input");correct.type="number";correct.min="1";correct.max="8";correct.className="row-correct";correct.value=list.length?(Number(correctIndex)||0)+1:"";
      row.append(label,area,correctLabel,correct);
      return row;
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

    // The teacher opens a round only after assigning the fair rotating contestants.
    window.startQuestion=function(){
      ensureAudioAwake();
      const data=window.lastGameData||{};
      const qIndex=Number(data.qIndex)||0, q=window.questions?.[qIndex];
      if(!q){document.getElementById("soundStatus").textContent="Add a question before starting the round.";return;}
      const teamMode=!!document.getElementById("teamModeToggle")?.checked;
      const mc=!!document.getElementById("multipleChoiceToggle")?.checked;
      if(mc&&(!q.choices?.length||!Number.isInteger(q.correctIndex))){
        document.getElementById("soundStatus").textContent="Add choices and mark the correct choice before starting.";return;
      }
      const now=serverNow(),delayOn=document.getElementById("delayToggle").checked;
      const unlockAt=delayOn?now+(parseInt(document.getElementById("delaySeconds").value)||10)*1000:now;
      const contestants=teamMode?contestantsFor(data,qIndex):null;
      if(teamMode&&(!contestants.A||!contestants.B)){
        document.getElementById("soundStatus").textContent="Team Mode needs at least two students in the game.";return;
      }
      gameRef.update({
        roundActive:true,revealed:false,buzzedBy:null,selectedPlayer:null,buzzPool:null,
        buzzUnlockAt:unlockAt,buzzOpenAt:unlockAt,teamMode,multipleChoice:mc,contestants,
        helperName:null,answerState:null,stealTeam:null,stealUsed:false
      });
    };
    const originalGo=window.goToQuestion;
    window.goToQuestion=function(index){
      originalGo(index);
      gameRef.update({helperName:null,answerState:null,stealTeam:null,stealUsed:false,contestants:null});
    };
    const originalAdjust=window.adjustSelectedScore;
    window.adjustSelectedScore=function(delta){
      const data=window.lastGameData||{};
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
      const data=window.lastData||{};
      if(!data.teamMode){originalBuzz();return;}
      if(!data.roundActive||!data.contestants||![data.contestants.A,data.contestants.B].includes(myName))return;
      if(data.stealTeam&&teamFor(myName,data)!==data.stealTeam)return;
      if(data.buzzedBy||!myName)return;
      gameRef.transaction(current=>{
        if(!current||current.roundActive!==true||current.buzzedBy||
           !current.contestants||![current.contestants.A,current.contestants.B].includes(myName)||
           (current.stealTeam&&teamFor(myName,current)!==current.stealTeam)||
           (current.buzzerDelayOn&&serverNow()<(current.buzzUnlockAt||0)))return;
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
      const q=questionAt(window.lastData);
      if(!q||!Number.isInteger(q.correctIndex))return;
      gameRef.transaction(current=>{
        if(!current||current.roundActive!==true||!current.multipleChoice||current.answerState||
           Number(current.qIndex)!==Number(window.lastData?.qIndex))return;
        const team=teamFor(myName,current);
        const allowed=current.teamMode
          ?(current.helperName?current.helperName===myName:current.buzzedBy===myName)
          :current.buzzedBy===myName;
        if(!allowed)return;
        const correct=Number(index)===Number(q.correctIndex);
        if(current.teamMode){
          current.teamScores=current.teamScores||{A:0,B:0};
          current.teamScores[team]=(Number(current.teamScores[team])||0)+(correct?10:-5);
        }else{
          current.scores=current.scores||{};
          current.scores[myName]=(Number(current.scores[myName])||0)+(correct?10:-5);
        }
        current.answerState={outcome:correct?"correct":"incorrect",by:myName,team:team||null,choice:Number(index),at:Date.now()};
        if(correct){current.revealed=true;current.stealTeam=null;}
        else if(current.teamMode&&!current.stealUsed){
          current.stealTeam=team==="A"?"B":"A";current.stealUsed=true;
          current.buzzedBy=null;current.selectedPlayer=null;current.helperName=null;
        }else{current.revealed=true;current.stealTeam=null;}
        return current;
      },(err,committed)=>{if(err)document.getElementById("answerFeedback").textContent="Could not submit. Try again.";});
    }

    function updateChoices(data){
      const area=document.getElementById("answerChoiceArea");if(!area)return;
      const q=questionAt(data),team=teamFor(myName,data);
      const eligibleContestant=!!(data.contestants&&data.contestants[team]===myName);
      const isHelper=data.helperName===myName;
      const myTeamLabel=document.getElementById("myTeamLabel");
      myTeamLabel.textContent=data.teamMode?(team?"You are on Team "+team+".":"Waiting for team assignment."):"";
      const choiceActor=data.multipleChoice&&(data.teamMode?(data.helperName?isHelper:data.buzzedBy===myName):data.buzzedBy===myName);
      const shouldShow=!!(data.multipleChoice&&data.roundActive&&data.buzzedBy&&
        (choiceActor||isHelper||data.answerState));
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
      if(data.answerState){
        document.getElementById("answerFeedback").textContent=data.answerState.outcome==="correct"?"Correct! Points were added automatically.":(data.stealTeam?"Not quite. The other team may steal.":"Not quite. The answer is revealed.");
      }else if(choiceActor&&q?.choices?.length){
        document.getElementById("answerFeedback").textContent=isHelper?"You are helping. Choose an answer for your team.":"Choose an answer, or ask one teammate to help.";
        q.choices.forEach((choice,index)=>{
          const button=document.createElement("button");button.type="button";button.textContent=choice;
          button.addEventListener("click",()=>submitChoice(index));buttons.appendChild(button);
        });
      }else if(choiceActor&&!q?.choices?.length){
        document.getElementById("answerFeedback").textContent="The teacher has not added answer choices yet.";
      }else document.getElementById("answerFeedback").textContent="Waiting for the selected teammate to answer.";
    }
    const originalRender=window.renderGameSnapshot;
    window.renderGameSnapshot=function(snapshot){originalRender(snapshot);updateChoices(snapshot.val()||{});};
    gameRef.on("value",snap=>updateChoices(snap.val()||{}));
    const originalAvail=window.updateBuzzAvailability;
    window.updateBuzzAvailability=function(){
      originalAvail();
      const data=window.lastData||{};
      if(data.teamMode){
        const team=teamFor(myName,data);
        const eligible=!!(data.contestants&&data.contestants[team]===myName&&(!data.stealTeam||data.stealTeam===team));
        if(!eligible){const b=document.getElementById("buzzBtn");b.disabled=true;document.getElementById("countdown").textContent="";}
      }
    };
  }
})();
