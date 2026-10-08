window.B3TeacherAccountReady=new Promise(resolve=>{
const deadline=Date.now()+10000;
const wait=()=>{if(window.B3SiteSettings)window.B3SiteSettings.onAuthStateChanged((user,authorized)=>resolve({user,authorized}));else if(Date.now()<deadline)setTimeout(wait,100);else resolve({authorized:false});};
wait();setTimeout(()=>resolve({authorized:false}),10000);
});