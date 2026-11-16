'use strict';
// The site-wide "Audio: On/Off" button, its replay button and the instructions it read aloud as a student moved around
// are gone. The Listen buttons inside activities (Posuk Practice, quizzes) still speak when pressed.
// The worksheet page uses the same drawing toolbar as the whiteboards (Select, no Hand).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function load(opts={}){
  const spoken=[],cancelled=[],added=[],storage={fttAudioMode123:'on',fttAudioModePos:'{"x":1,"y":2}',other:'keep'};
  class Utterance{constructor(text){this.text=text}}
  const window={speechSynthesis:{getVoices:()=>opts.voices||[{name:'Microsoft Guy Online (Natural)',lang:'en-US'}],addEventListener(){},speak(u){spoken.push(u.text)},cancel(){cancelled.push(1)}},SpeechSynthesisUtterance:Utterance,addEventListener(type){added.push(type)}};
  const context={window,localStorage:{getItem:k=>storage[k]??null,removeItem:k=>{delete storage[k]},setItem(){}, key:i=>Object.keys(storage)[i],get length(){return Object.keys(storage).length}},
    Object,document:{createElement(){throw Error('the audio script must not build any page elements')},body:{appendChild(){throw Error('no buttons')}},addEventListener(){throw Error('the audio script must not watch the page')}},
    setInterval(){throw Error('the audio script must not run a timer')},setTimeout(){throw Error('no timers')},console,SpeechSynthesisUtterance:Utterance};
  // localStorage is enumerated with Object.keys: give it plain keys like a real Storage.
  Object.assign(context.localStorage,storage);
  vm.runInNewContext(read('audio-mode.js'),context);
  return{window,spoken,cancelled,added,storage,context};
}

test('there is no Audio button, replay button, timer or page watching any more',()=>{
  const source=read('audio-mode.js');
  for(const gone of ['Audio: On','Audio: Off','ftt-audio-mode','replayButton','setInterval','getContext','currentLearningText','createElement','Turn Audio Mode'])
    assert.equal(source.includes(gone),false,gone+' is removed');
  const {window}=load();
  assert.equal(typeof window.FTTAudio.speak,'function');
  assert.equal(window.FTTAudio.enabled(),false);
});

test('a Listen button still speaks (force), and nothing speaks by itself',()=>{
  const {window,spoken}=load();
  assert.equal(window.FTTAudio.speak('Say this'),false,'without a Listen press it never speaks');
  assert.equal(window.FTTAudio.speak('Say this',{force:false}),false);
  assert.equal(window.FTTAudio.speak('Say  this \n now',{force:true}),true);
  assert.deepEqual(spoken,['Say this now']);
  window.FTTAudio.setEnabled(true);
  assert.equal(window.FTTAudio.enabled(),false,'there is no site-wide audio mode to switch on');
  assert.equal(window.FTTAudio.speak('Hello'),false);
  // No suitable voice: it says no, quietly.
  assert.equal(load({voices:[{name:'Zira',lang:'en-US'}]}).window.FTTAudio.speak('x',{force:true}),false);
});

test('the old saved Audio choice and button position are cleared from the browser',()=>{
  const {storage}=load();
  assert.equal('fttAudioMode123' in storage,false);assert.equal('fttAudioModePos' in storage,false);
  assert.equal(storage.other,'keep');
});

test('every page still gets the small speech helper for Listen buttons, with a new version; the Listen buttons are untouched',()=>{
  assert.match(read('game-gate.js'),/audio-mode\.js\?v=20261116-no-audio-button/);
  assert.match(read('index.html'),/audio-mode\.js\?v=20261116-no-audio-button/);
  for(const page of ['record_pesukim/student.html','record-mishnayos/student.html','weekly-quiz/index.html','weekly-quiz/practice.html'])
    assert.match(read(page),/window\.FTTAudio\.speak\(text,\{force:true\}\)/,page+' Listen still speaks');
});

test('the worksheet page uses the whiteboard toolbar: Select with the mouse icon, no Hand, no Pointer, only working tools',()=>{
  const mine=read('class-pointer-prototype/my-files.js');
  assert.match(mine,/tools:\['select','highlight','text','shape','eraser','pen'\],hideUnused:true/);
  assert.match(mine,/toolLabels:\{select:\['🖱️','Select'/);
  assert.match(mine,/id:'worksheet'[^\n]*defaultTool:'pen'/);
  // The same tool list as the teacher's view of a student whiteboard.
  assert.match(read('class-pointer-prototype/student-boards.js'),/tools:\['select','highlight','text','shape','eraser','pen'\],hideUnused:true/);
  assert.match(mine,/addEventListener\('wheel'/,'the wheel still scrolls a zoomed page');
  assert.match(read('class-pointer-prototype/my-files.html'),/my-files\.js\?v=20261116-drawperm1/);
});
