// Quick sign-in links for FICTIONAL TEST STUDENTS only (issue #619).
//
// A link looks like  https://funtorahtools.com/#ftt-test=<token>
// The token is the test student's name and passcode, encoded. It sits after
// the "#", so the browser never sends it to any server or hosting log, and the
// home page removes it from the address bar straight away. Sign-in still goes
// through the normal server passcode check, so a link gives no more access
// than typing that name and passcode. The home page refuses the link unless
// every class the student is in is a test class, so it cannot be used for a
// real student. Build links with: node scripts/make-test-login-link.cjs
(function(root){
  "use strict";
  var PREFIX="ftt-test=";

  function toBase64Url(text){
    var b64=typeof Buffer!=="undefined"?Buffer.from(text,"utf8").toString("base64")
      :btoa(unescape(encodeURIComponent(text)));
    return b64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  function fromBase64Url(token){
    var b64=String(token).replace(/-/g,"+").replace(/_/g,"/");
    while(b64.length%4)b64+="=";
    return typeof Buffer!=="undefined"?Buffer.from(b64,"base64").toString("utf8")
      :decodeURIComponent(escape(atob(b64)));
  }

  function encode(name,passcode){
    name=String(name||"").trim();passcode=String(passcode||"").trim();
    if(!name||!passcode)throw new Error("Name and passcode are both required.");
    return toBase64Url(JSON.stringify({v:1,n:name,p:passcode}));
  }

  // Returns {name,passcode} from a location.hash, or null if there is no valid token.
  function readHash(hash){
    var raw=String(hash||"").replace(/^#/,"");
    if(raw.indexOf(PREFIX)!==0)return null;
    var token=raw.slice(PREFIX.length);
    if(!/^[A-Za-z0-9_-]{8,600}$/.test(token))return null;
    try{
      var data=JSON.parse(fromBase64Url(token));
      var name=String(data&&data.n||"").trim(),passcode=String(data&&data.p||"").trim();
      if(data.v!==1||!name||!passcode||name.length>100||passcode.length>100)return null;
      return {name:name,passcode:passcode};
    }catch(e){return null;}
  }

  function isTestClass(c){
    return Boolean(c)&&(/test/i.test(String(c.id||""))||/test/i.test(String(c.name||"")));
  }
  // Every class the student can open must be a test class.
  function onlyTestClasses(classChoices,classId){
    var list=Array.isArray(classChoices)?classChoices.filter(Boolean):[];
    if(!list.length)return isTestClass({id:classId});
    return list.every(isTestClass);
  }

  function link(siteUrl,name,passcode){
    var base=String(siteUrl||"https://funtorahtools.com/").replace(/#.*$/,"");
    if(!/\/$/.test(base)&&!/\.html$/.test(base))base+="/";
    return base+"#"+PREFIX+encode(name,passcode);
  }

  var api={encode:encode,readHash:readHash,isTestClass:isTestClass,onlyTestClasses:onlyTestClasses,link:link};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  else root.FTTTestLoginLink=api;
})(typeof window!=="undefined"?window:this);
