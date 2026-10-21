/* Sefer HaMitzvos-style picture study for Halacha. Additive to existing scrapbook.
   Vector regions are filled directly; color cannot leak across a boundary. */
(function () {
  'use strict';
  var NS='http://www.w3.org/2000/svg';
  var COLORS=[['Red','#e53935'],['Orange','#fb8c00'],['Yellow','#fdd835'],['Green','#43a047'],['Blue','#1e88e5'],['Purple','#8e24aa'],['Brown','#795548'],['Pink','#f48fb1'],['White','#ffffff']];
  var DESCRIPTIONS={
    a:'Remember that Hashem is with us everywhere, and choose how to behave even when nobody is watching.',
    b:'Say Modeh Ani when you wake up and thank Hashem for returning your neshamah.',
    c:'Learn from the leopard, eagle, deer and lion to serve Hashem with courage and energy.',
    d:'Do not let laziness stop you from getting up and doing the right thing.',
    e:'Nighttime can be a special time for learning Torah.',
    a6:'Read unfamiliar pesukim carefully from a sefer.',
    a7:'Take care to say the special tefillah without adding Hashem’s Name.',
    f:'Prepare negel vasser before bedtime and learn the correct order for washing in the morning.'
  };
  var THEMES={
    'א':'book', 'ב':'water', 'ג':'garment', 'ד':'wash', 'ו':'bracha'
  };
  function elt(name,cls,txt){
    var n=document.createElement(name);
    if(cls)n.className=cls;
    if(txt!==undefined)n.textContent=txt;
    return n;
  }
  function shape(svg,tag,attrs){
    var node=document.createElementNS(NS,tag);
    Object.keys(attrs).forEach(function(k){node.setAttribute(k,attrs[k]);});
    svg.appendChild(node);return node;
  }
  function addRegion(svg,tag,attrs,part){
    attrs['data-color-part']=part;attrs.fill='#ffffff';
    attrs.stroke='#1a3445';attrs['stroke-width']='6';
    attrs['stroke-linejoin']='round';attrs['stroke-linecap']='round';
    attrs.tabindex='0';attrs.role='button';
    attrs['aria-label']='Color picture section '+part;
    return shape(svg,tag,attrs);
  }
  function drawPicture(svg,theme){
    shape(svg,'rect',{x:10,y:10,width:600,height:360,rx:23,fill:'#f5fbff',stroke:'#173d62','stroke-width':5});
    shape(svg,'rect',{x:37,y:37,width:546,height:306,rx:20,fill:'#ffffff',stroke:'#a7cbd9','stroke-width':3});
    // Every editable region is a CLOSED SVG path/shape, so fill stays inside it.
    if(theme==='book'||theme==='bracha'){
      addRegion(svg,'path',{d:'M310 118 Q243 80 130 109 L130 300 Q244 275 310 311 Z'},'left-page');
      addRegion(svg,'path',{d:'M310 118 Q376 80 490 109 L490 300 Q376 275 310 311 Z'},'right-page');
      addRegion(svg,'rect',{x:302,y:118,width:16,height:192,rx:6},'spine');
      for(var i=0;i<3;i++){
        shape(svg,'path',{d:'M160 '+(157+i*37)+' Q220 '+(139+i*37)+' 280 '+(164+i*37),fill:'none',stroke:'#344b5a','stroke-width':4});
        shape(svg,'path',{d:'M340 '+(164+i*37)+' Q400 '+(139+i*37)+' 458 '+(157+i*37),fill:'none',stroke:'#344b5a','stroke-width':4});
      }
      if(theme==='bracha'){
        addRegion(svg,'path',{d:'M290 90 Q271 57 290 45 Q310 57 290 90 Z'},'flame');
        addRegion(svg,'path',{d:'M285 93 L299 93 L306 126 L280 126 Z'},'candle');
      } else {
        addRegion(svg,'path',{d:'M82 260 L110 245 L110 106 L82 122 Z'},'bookmark');
        addRegion(svg,'circle',{cx:522,cy:84,r:29},'sun');
      }
    }else if(theme==='water'||theme==='wash'){
      addRegion(svg,'path',{d:'M175 160 L420 160 L397 300 Q295 335 196 300 Z'},'cup');
      addRegion(svg,'path',{d:'M420 184 Q516 156 512 221 Q509 277 410 254 L420 232 Q477 252 483 218 Q486 198 420 211 Z'},'handle');
      addRegion(svg,'path',{d:'M175 157 Q298 128 420 157 Q301 184 175 157 Z'},'rim');
      addRegion(svg,'path',{d:'M210 267 Q298 244 383 267 L382 291 Q297 314 212 291 Z'},'water');
      addRegion(svg,'path',{d:'M285 128 Q257 95 285 55 Q317 94 285 128 Z'},'drop-a');
      addRegion(svg,'path',{d:'M360 114 Q337 84 360 48 Q389 84 360 114 Z'},'drop-b');
      addRegion(svg,'path',{d:'M207 117 Q191 95 207 70 Q229 95 207 117 Z'},'drop-c');
      if(theme==='wash'){
        addRegion(svg,'path',{d:'M95 296 Q138 261 175 292 L167 326 Q124 339 95 318 Z'},'towel');
      }else{
        addRegion(svg,'circle',{cx:491,cy:91,r:28},'sun');
      }
    }else if(theme==='garment'){
      addRegion(svg,'path',{d:'M220 92 L271 76 Q310 115 349 76 L401 92 L482 168 L436 226 L396 198 L396 308 L224 308 L224 198 L184 226 L138 168 Z'},'shirt');
      addRegion(svg,'path',{d:'M272 80 Q311 160 350 80 L333 74 Q311 109 288 74 Z'},'neckline');
      addRegion(svg,'rect',{x:234,y:188,width:150,height:90,rx:12},'center');
      ['244','272','352','380'].forEach(function(x,j){
        shape(svg,'path',{d:'M'+x+' 307 l'+(j%2?8:-8)+' 31',stroke:'#1a3445','stroke-width':5,fill:'none'});
      });
    }else{
      addRegion(svg,'rect',{x:169,y:160,width:279,height:139,rx:20},'basin');
      addRegion(svg,'path',{d:'M227 152 Q203 121 229 90 Q259 123 227 152 Z'},'drop-a');
      addRegion(svg,'path',{d:'M318 144 Q290 108 319 65 Q355 109 318 144 Z'},'drop-b');
    }
  }
  function install(lesson,section){
    if(section.querySelector('[data-hal-sefer-study]'))return;
    var panel=elt('section','hal-sefer-study');
    panel.setAttribute('data-hal-sefer-study',lesson.id);
    var title=elt('h2','hal-sefer-title',lesson.seif+' · '+lesson.title);
    var description=elt('p','hal-sefer-description',DESCRIPTIONS[lesson.id]||lesson.objective);
    panel.append(title,description);
    var grid=elt('div','hal-sefer-layout'),art=elt('div','hal-sefer-art'),right=elt('div','hal-sefer-right');
    var picture=elt('div','hal-sefer-picture'),svg=document.createElementNS(NS,'svg');
    svg.setAttribute('viewBox','0 0 620 380');
    svg.setAttribute('role','group');svg.setAttribute('aria-label','Colorable Halacha picture');
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    var theme=THEMES[simanOfLesson(lesson)]||'book';
    drawPicture(svg,theme);
    var canvas=elt('canvas','hal-sefer-ink');
    canvas.width=620;canvas.height=380;canvas.setAttribute('aria-label','Drawing overlay');
    picture.append(svg,canvas);art.appendChild(picture);
    var status=elt('p','hal-sefer-status','Choose a color, then tap a picture section.');
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    art.appendChild(status);
    var heading=elt('h3','','🎨 Color the Picture'),colors=elt('div','hal-sefer-palette');
    right.append(heading,colors);
    var tools=elt('div','hal-sefer-buttons');
    var fill=elt('button','on','🪣 Fill sections'),brush=elt('button','','🖌 Brush'),
        eraser=elt('button','','Eraser'),undo=elt('button','','Undo'),
        clear=elt('button','','Clear'),download=elt('button','','Save PNG');
    [fill,brush,eraser,undo,clear,download].forEach(function(b){b.type='button';tools.appendChild(b);});
    right.appendChild(tools);
    var sizeLabel=elt('label','hal-sefer-brushsize','Brush size ');
    var size=document.createElement('input');size.type='range';size.min='2';size.max='24';size.value='6';
    sizeLabel.appendChild(size);right.appendChild(sizeLabel);
    var words=window.FTTHalachaVocabulary?FTTHalachaVocabulary.get(lesson.id):[];
    var vocab=elt('div','hal-sefer-vocab');
    vocab.appendChild(elt('h3','','🎯 Match the Hebrew Words'));
    vocab.appendChild(elt('p','hal-sefer-hint','Choose an English meaning, then its Hebrew word.'));
    var choices=elt('div','hal-sefer-matches');vocab.appendChild(choices);
    var feedback=elt('p','hal-sefer-feedback','');
    feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    vocab.appendChild(feedback);right.appendChild(vocab);
    grid.append(art,right);panel.appendChild(grid);
    var work=section.querySelector('.work');section.insertBefore(panel,work||null);

    var readonly=Boolean(HALACHA_TEACHER_VIEW);
    var tool='fill',color='#fdd835',selected='';
    var key='halacha_sefer_color_'+lesson.id;
    var actions=Array.isArray(S[key])?S[key].slice():[];
    var ctx=canvas.getContext('2d'),drawing=null;
    function redraw(){
      svg.querySelectorAll('[data-color-part]').forEach(function(n){n.setAttribute('fill','#ffffff');});
      ctx.clearRect(0,0,canvas.width,canvas.height);
      actions.forEach(function(a){
        if(a.tool==='fill'){
          var n=Array.prototype.find.call(svg.querySelectorAll('[data-color-part]'),function(x){return x.getAttribute('data-color-part')===a.part;});
          if(n)n.setAttribute('fill',a.color);
        }else if((a.tool==='brush'||a.tool==='eraser')&&Array.isArray(a.points)){
          ctx.save();ctx.globalCompositeOperation=a.tool==='eraser'?'destination-out':'source-over';
          ctx.strokeStyle=a.color||'#000';ctx.lineWidth=Number(a.size)||6;
          ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
          a.points.forEach(function(pt,i){if(i===0)ctx.moveTo(pt[0],pt[1]);else ctx.lineTo(pt[0],pt[1]);});
          if(a.points.length===1)ctx.lineTo(a.points[0][0]+0.1,a.points[0][1]+0.1);
          ctx.stroke();ctx.restore();
        }
      });
    }
    function commit(message){
      if(readonly)return;
      S[key]=actions.slice();save();status.textContent=message||'Saving your picture to your account…';
    }
    function chooseTool(t){
      tool=t;[fill,brush,eraser].forEach(function(b){b.classList.remove('on');});
      ({fill:fill,brush:brush,eraser:eraser})[t].classList.add('on');
      canvas.style.pointerEvents=t==='fill'?'none':'auto';
      status.textContent=t==='fill'?'Tap inside a picture section. Colors will stay within its outline.':'Draw on the picture with your finger or mouse.';
    }
    svg.querySelectorAll('[data-color-part]').forEach(function(n){
      function onColor(){
        if(readonly||tool!=='fill'||halachaCloudLoading)return;
        actions.push({tool:'fill',part:n.getAttribute('data-color-part'),color:color});
        redraw();commit('✓ Section colored. Choose another area.');
      }
      n.addEventListener('click',onColor);
      n.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();onColor();}});
    });
    COLORS.forEach(function(item){
      var b=elt('button','hal-sefer-color',item[0]);b.type='button';
      b.style.backgroundColor=item[1];b.style.color=['Yellow','Pink','White'].indexOf(item[0])>=0?'#18334d':'#fff';
      b.setAttribute('aria-label',item[0]);b.setAttribute('aria-pressed',String(item[1]===color));
      b.onclick=function(){color=item[1];colors.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});};
      colors.appendChild(b);
    });
    fill.onclick=function(){chooseTool('fill');};
    brush.onclick=function(){chooseTool('brush');};
    eraser.onclick=function(){chooseTool('eraser');};
    function point(e){var r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*620/r.width,(e.clientY-r.top)*380/r.height];}
    canvas.addEventListener('pointerdown',function(e){
      if(readonly||tool==='fill'||halachaCloudLoading)return;
      e.preventDefault();canvas.setPointerCapture(e.pointerId);
      drawing={tool:tool,color:color,size:tool==='eraser'?Math.max(12,Number(size.value)*2):Number(size.value),points:[point(e)]};
      actions.push(drawing);redraw();
    });
    canvas.addEventListener('pointermove',function(e){if(!drawing)return;drawing.points.push(point(e));redraw();});
    function finish(){if(!drawing)return;drawing=null;commit('✓ Picture saved.');}
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
    undo.onclick=function(){if(readonly||!actions.length)return;actions.pop();redraw();commit('Last coloring action undone.');};
    clear.onclick=function(){if(readonly||!actions.length||!confirm('Clear the colors on this Halacha picture?'))return;actions=[];redraw();commit('Picture cleared.');};
    download.onclick=function(){
      var copy=svg.cloneNode(true);copy.removeAttribute('role');
      copy.setAttribute('xmlns',NS);
      var raw=new XMLSerializer().serializeToString(copy),image=new Image();
      var url=URL.createObjectURL(new Blob([raw],{type:'image/svg+xml'}));
      image.onload=function(){
        var out=document.createElement('canvas');out.width=620;out.height=380;
        var x=out.getContext('2d');x.drawImage(image,0,0,620,380);x.drawImage(canvas,0,0);
        URL.revokeObjectURL(url);
        var link=document.createElement('a');link.download='halacha-'+lesson.id+'-colored.png';link.href=out.toDataURL('image/png');link.click();
      };
      image.onerror=function(){URL.revokeObjectURL(url);status.textContent='Could not create PNG. Try printing the page.';};
      image.src=url;
    };
    if(readonly){right.querySelectorAll('button').forEach(function(b){if(b!==download)b.disabled=true;});canvas.style.pointerEvents='none';}
    chooseTool('fill');redraw();

    // Match the vocabulary in the same tap/drag style as Sefer HaMitzvos.
    var matched=new Set(),english=words.slice().sort(function(){return Math.random()-.5;});
    var hebrew=words.slice().sort(function(){return Math.random()-.5;});
    var englishColumn=elt('div','hal-sefer-english'),hebrewColumn=elt('div','hal-sefer-hebrew');
    english.forEach(function(w){
      var b=elt('button','',w.english);b.type='button';b.draggable=true;
      b.dataset.word=w.id;
      b.onclick=function(){selected=w.id;englishColumn.querySelectorAll('button').forEach(function(x){x.classList.toggle('selected',x===b);});feedback.textContent='Now tap the matching Hebrew word.';};
      b.ondragstart=function(e){e.dataTransfer.setData('text/plain',w.id);};englishColumn.appendChild(b);
    });
    hebrew.forEach(function(w){
      var b=elt('button','',w.hebrew);b.type='button';b.lang='he';b.dir='rtl';b.dataset.word=w.id;
      function match(id){
        if(!id||matched.has(w.id))return;
        if(id!==w.id){feedback.textContent='Not quite. Try another word.';return;}
        matched.add(w.id);b.disabled=true;b.classList.add('good');
        englishColumn.querySelectorAll('button').forEach(function(x){if(x.dataset.word===id){x.disabled=true;x.classList.add('good');}x.classList.remove('selected');});
        selected='';feedback.textContent=matched.size===words.length?'🌟 Fantastic! All the Hebrew words are matched!':'✓ Correct! Keep going!';
      }
      b.onclick=function(){match(selected);};b.ondragover=function(e){e.preventDefault();};
      b.ondrop=function(e){e.preventDefault();match(e.dataTransfer.getData('text/plain'));};
      hebrewColumn.appendChild(b);
    });
    choices.append(englishColumn,hebrewColumn);
  }
  function scan(){
    if(typeof lessons==='undefined'||typeof S==='undefined')return;
    lessons.forEach(function(l){var section=document.getElementById(l.id);if(section)install(l,section);});
  }
  var sections=document.getElementById('sections');
  if(!sections)return;
  scan();
  new MutationObserver(scan).observe(sections,{childList:true});
})();
