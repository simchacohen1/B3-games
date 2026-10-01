/**
 * MERGE THIS FILE INTO YOUR EXISTING Firebase Functions project.
 * It preserves the existing Student Rewards username + PIN login while the
 * website itself is hosted on GitHub Pages.
 *
 * Requires dependencies already used by the B3 project:
 *   firebase-admin
 *   firebase-functions
 *
 * Deploy after merging:
 *   firebase deploy --only functions:studentRewardsLogin,functions:studentRewardsRedeem
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();
const SR_ROOT = "studentRewards";
const DAY_MS = 24*60*60*1000;
function timeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n=Number(value); if (Number.isFinite(n) && n>0) return n;
  const p=Date.parse(String(value||"")); return Number.isFinite(p)?p:0;
}
function cooldownText(until) {
  const mins=Math.max(1,Math.ceil(Math.max(0,timeMs(until)-Date.now())/60000));
  const days=Math.floor(mins/1440), hours=Math.floor((mins%1440)/60);
  if(days>=7){const weeks=Math.floor(days/7),rem=days%7;return `${weeks} week${weeks===1?"":"s"}${rem?`, ${rem} day${rem===1?"":"s"}`:""}`;}
  if(days>=1)return `${days} day${days===1?"":"s"}${hours?`, ${hours} hour${hours===1?"":"s"}`:""}`;
  if(hours>=1)return `${hours} hour${hours===1?"":"s"}`;
  return `${mins} min`;
}

function cors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).send(""); return true; }
  return false;
}
function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}
async function siteEnabled() {
  const snap = await rtdb.ref(`${SR_ROOT}/settings/studentWebsiteEnabled`).get();
  return String(snap.val()) !== "false";
}
function safeEqual(a,b){
  try { const A=Buffer.from(String(a),"utf8"),B=Buffer.from(String(b),"utf8"); return A.length===B.length && crypto.timingSafeEqual(A,B); }
  catch { return false; }
}

const B3_REWARD_NAME_BY_ID = {
  chaim_chaikin: "Chaim Chaikin",
  mayer_chaim_chaikin: "Chaim Chaikin",
  yossi_gourarie: "Yossi Gourarie",
  sholom_huebner: "Sholom Huebner",
  sholom_dovber_huebner: "Sholom Huebner",
  moshe_lapine: "Moshe Lapine",
  kehos_notik: "Kehos Notik",
  yisroel_oirechman: "Yisroel Oirechman",
  moshe_raichman: "Moshe Raichman",
  moshe_tuvia_raichman: "Moshe Raichman",
  avrohom_rosenfeld: "Avrohom Rosenfeld",
  levi_rozmarin: "Levi Rozmarin",
  arik_traxler: "Arik Traxler",
  ari_greenberg: "Ari Greenberg",
  zev_rosenfeld: "Zev Rosenfeld",
  levi_schtroks: "Levi Schtroks",
  yisroel_aryeh_simmonds: "Yisroel Aryeh Simmonds",
  leibel_vogel: "Leibel Vogel",
  leib_wolf: "Leib Wolf"
};
const B3_ET = new Set(["chaim_chaikin","mayer_chaim_chaikin","yossi_gourarie","sholom_huebner","sholom_dovber_huebner","moshe_lapine","kehos_notik","yisroel_oirechman","moshe_raichman","moshe_tuvia_raichman","avrohom_rosenfeld","levi_rozmarin","arik_traxler"]);
const B3_WT = new Set(["ari_greenberg","zev_rosenfeld","levi_schtroks","yisroel_aryeh_simmonds","leibel_vogel","leib_wolf"]);
function slugifyName(value){return String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");}
function normalizeName(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"");}
function rosterClass(id){return B3_ET.has(id)?"et":B3_WT.has(id)?"wt":"";}
async function rewardStudentForB3(b3StudentId, allowedName, enteredName){
  const targetName=B3_REWARD_NAME_BY_ID[b3StudentId] || allowedName || enteredName;
  const target=normalizeName(targetName);
  const snap=await rtdb.ref(`${SR_ROOT}/students`).get();
  const rows=snap.val()||{};
  for(const [id,s] of Object.entries(rows)){
    if(s && s.active!==false && normalizeName(s.name)===target) return {studentId:String(id),student:s};
  }
  return null;
}

exports.studentRewardsLogin = onRequest(
  { cors: true, region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    if (cors(req,res)) return;
    if (req.method !== "POST") return res.status(405).json({error:"Use POST"});
    try {
      if (!await siteEnabled()) return res.status(423).json({error:"Student Website Temporarily Unavailable"});

      // New unified B3 Games login: full name + the same class PIN used everywhere else.
      const enteredName=String(req.body?.name || "").trim();
      const suppliedB3Id=String(req.body?.b3StudentId || "").trim().toLowerCase();
      const pin=String(req.body?.pin || "").trim();
      if(enteredName || suppliedB3Id){
        const b3StudentId=suppliedB3Id || slugifyName(enteredName);
        if(!b3StudentId || !pin) return res.status(400).json({error:"Enter your full name and Class PIN."});
        const [pinSnap,allowedSnap]=await Promise.all([
          rtdb.ref("posukPractice/settings/classPin").get(),
          rtdb.ref(`posukPractice/allowedStudents/${b3StudentId}`).get()
        ]);
        const realPin=String(pinSnap.val() ?? "").trim();
        if(realPin && !safeEqual(realPin,pin)) return res.status(401).json({error:"The Class PIN is incorrect."});
        if(!allowedSnap.exists()) return res.status(401).json({error:"Your name is not on the B3 student list."});
        const allowed=allowedSnap.val()||{};
        const match=await rewardStudentForB3(b3StudentId, String(allowed.name||""), enteredName);
        if(!match) return res.status(404).json({error:"Your Student Rewards account could not be matched. Ask Rabbi Cohen."});
        const classId=(allowed.classId==="et"||allowed.classId==="wt")?allowed.classId:rosterClass(b3StudentId);
        const uid=`sr_${sha256(match.studentId).slice(0,28)}`;
        const customToken=await admin.auth().createCustomToken(uid,{
          studentRewardsStudentId:match.studentId,
          studentRewardsRole:"student",
          b3StudentId,
          b3StudentName:String(allowed.name||enteredName||match.student.name||"Student"),
          b3ClassId:classId||""
        });
        return res.status(200).json({ok:true,customToken,studentId:match.studentId,b3StudentId,b3StudentName:String(allowed.name||enteredName||match.student.name||"Student"),classId:classId||""});
      }

      // Backward-compatible old Student Rewards username/PIN login.
      const username=String(req.body?.username || "").trim().toLowerCase();
      if(!username || !pin) return res.status(400).json({error:"Enter your full name and Class PIN."});
      const key=sha256(username);
      const authSnap=await rtdb.ref(`${SR_ROOT}/privateAuth/byUsername/${key}`).get();
      const authRow=authSnap.val();
      if(!authRow || !authRow.studentId || !authRow.pinHash || !safeEqual(authRow.pinHash,sha256(pin))) return res.status(401).json({error:"The username or PIN is incorrect."});
      const studentId=String(authRow.studentId);
      const studentSnap=await rtdb.ref(`${SR_ROOT}/students/${studentId}`).get();
      const student=studentSnap.val();
      if(!student || student.active===false) return res.status(403).json({error:"This student account is not active."});
      const uid=`sr_${sha256(studentId).slice(0,28)}`;
      const customToken=await admin.auth().createCustomToken(uid,{studentRewardsStudentId:studentId,studentRewardsRole:"student"});
      return res.status(200).json({ok:true,customToken,studentId});
    } catch (err) {
      console.error("studentRewardsLogin",err);
      return res.status(500).json({error:"Could not sign in right now."});
    }
  }
);

exports.studentRewardsRedeem = onRequest(
  { cors: true, region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    if (cors(req,res)) return;
    if (req.method !== "POST") return res.status(405).json({error:"Use POST"});
    try {
      if (!await siteEnabled()) return res.status(423).json({error:"Student Website Temporarily Unavailable"});
      const header = String(req.headers.authorization || "");
      if (!header.startsWith("Bearer ")) return res.status(401).json({error:"Please sign in again."});
      const decoded = await admin.auth().verifyIdToken(header.slice(7));
      const studentId = decoded.studentRewardsStudentId;
      if (!studentId || decoded.studentRewardsRole !== "student") return res.status(403).json({error:"Student sign-in required."});
      const rewardId = String(req.body?.rewardId || "");
      const rewardSnap = await rtdb.ref(`${SR_ROOT}/rewards/${rewardId}`).get();
      const reward = rewardSnap.val();
      if (!reward || reward.active === false) return res.status(404).json({error:"That reward is unavailable."});
      if (reward.available === false) return res.status(409).json({error:"That reward is closed right now."});
      const cooldownUntil=timeMs(reward.cooldownUntil);
      if (cooldownUntil>Date.now()) return res.status(409).json({error:`That reward will be available again in ${cooldownText(cooldownUntil)}.`});
      const cost = Number(reward.cost || 0);
      const qty = Number(reward.quantity ?? -1);
      if (qty === 0) return res.status(409).json({error:"That reward is unavailable right now."});

      const balanceRef = rtdb.ref(`${SR_ROOT}/students/${studentId}/rewardBalance`);
      let insufficient = false;
      const balanceTx = await balanceRef.transaction(current => {
        const balance = Number(current || 0);
        if (balance < cost) { insufficient = true; return; }
        return balance - cost;
      });
      if (!balanceTx.committed) {
        return res.status(409).json({error: insufficient ? "You do not have enough points yet." : "Could not update your point balance."});
      }

      if (qty > 0) {
        let soldOut = false;
        const qtyTx = await rtdb.ref(`${SR_ROOT}/rewards/${rewardId}/quantity`).transaction(current => {
          const n = Number(current || 0);
          if (n <= 0) { soldOut = true; return; }
          return n - 1;
        });
        if (!qtyTx.committed) {
          await balanceRef.transaction(current => Number(current || 0) + cost);
          return res.status(409).json({error: soldOut ? "That reward just became unavailable." : "Could not reserve that reward."});
        }
      }

      const cooldownDays=Math.max(0,Number(reward.cooldownDays||0)),rewardRef=rtdb.ref(`${SR_ROOT}/rewards/${rewardId}`);
      let purchaseMs=Date.now(),blockedUntil=0;
      if(cooldownDays>0){
        const cdTx=await rewardRef.transaction(current=>{
          if(!current || current.active===false || current.available===false) return;
          const existingUntil=timeMs(current.cooldownUntil);
          if(existingUntil>Date.now()){blockedUntil=existingUntil;return;}
          purchaseMs=Date.now();
          return {...current,lastRedeemedAt:purchaseMs,cooldownUntil:purchaseMs+cooldownDays*DAY_MS};
        });
        if(!cdTx.committed){
          if(qty>0)await rtdb.ref(`${SR_ROOT}/rewards/${rewardId}/quantity`).transaction(current=>Number(current||0)+1).catch(()=>{});
          await balanceRef.transaction(current => Number(current || 0) + cost);
          return res.status(409).json({error:blockedUntil?`That reward will be available again in ${cooldownText(blockedUntil)}.`:"That reward is unavailable right now."});
        }
      }else{
        await rewardRef.update({lastRedeemedAt:purchaseMs,cooldownUntil:null});
      }

      const requestRef = rtdb.ref(`${SR_ROOT}/redemptionsByStudent/${studentId}`).push();
      const requestedAt = new Date(purchaseMs).toISOString();
      await requestRef.set({
        id: requestRef.key,
        studentId,
        rewardId,
        cost,
        status: "pending",
        requestedAt
      });
      return res.status(200).json({ok:true,balance:Number(balanceTx.snapshot.val()||0),requestId:requestRef.key});
    } catch (err) {
      console.error("studentRewardsRedeem", err);
      return res.status(500).json({error:"Could not request that reward right now."});
    }
  }
);
