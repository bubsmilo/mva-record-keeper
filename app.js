
(() => {
'use strict';

const KEY='mva-record-keeper-v1';
const APP_VERSION='2.8.9';
document.title=`MVA Record Keeper v${APP_VERSION}`;

const ATTACHMENT_DB='mva-record-keeper-attachments';
const ATTACHMENT_STORE='files';
const ATTACHMENT_PREFIX='idb:';
let attachmentCache={};

function openAttachmentDB(){
 return new Promise((resolve,reject)=>{
   if(!('indexedDB' in window)){reject(new Error('This browser does not support IndexedDB.'));return}
   const req=indexedDB.open(ATTACHMENT_DB,1);
   req.onupgradeneeded=()=>{
     const db=req.result;
     if(!db.objectStoreNames.contains(ATTACHMENT_STORE))db.createObjectStore(ATTACHMENT_STORE,{keyPath:'id'});
   };
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||new Error('Could not open attachment storage.'));
 });
}
async function putAttachmentData(data,id=''){
 const cleanId=id||uid();
 const ref=cleanId.startsWith(ATTACHMENT_PREFIX)?cleanId:ATTACHMENT_PREFIX+cleanId;
 const db=await openAttachmentDB();
 await new Promise((resolve,reject)=>{
   const tx=db.transaction(ATTACHMENT_STORE,'readwrite');
   tx.objectStore(ATTACHMENT_STORE).put({id:ref,data,updatedAt:new Date().toISOString()});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
 db.close();
 attachmentCache[ref]=data;
 return ref;
}
async function deleteAttachmentRef(ref){
 if(!String(ref||'').startsWith(ATTACHMENT_PREFIX))return;
 const db=await openAttachmentDB();
 await new Promise((resolve,reject)=>{
   const tx=db.transaction(ATTACHMENT_STORE,'readwrite');
   tx.objectStore(ATTACHMENT_STORE).delete(ref);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
 db.close();delete attachmentCache[ref];
}
async function clearAttachmentDB(){
 const db=await openAttachmentDB();
 await new Promise((resolve,reject)=>{
   const tx=db.transaction(ATTACHMENT_STORE,'readwrite');
   tx.objectStore(ATTACHMENT_STORE).clear();
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
 db.close();attachmentCache={};
}
async function loadAttachmentCache(){
 const db=await openAttachmentDB();
 const rows=await new Promise((resolve,reject)=>{
   const tx=db.transaction(ATTACHMENT_STORE,'readonly');
   const req=tx.objectStore(ATTACHMENT_STORE).getAll();
   req.onsuccess=()=>resolve(req.result||[]);
   req.onerror=()=>reject(req.error);
 });
 db.close();
 attachmentCache={};
 rows.forEach(r=>{if(r?.id&&r?.data)attachmentCache[r.id]=r.data});
 return rows.length;
}
function attachmentSrc(value=''){
 const text=String(value||'');
 return text.startsWith(ATTACHMENT_PREFIX)?(attachmentCache[text]||''):text;
}
function isStoredAttachment(value=''){return String(value||'').startsWith(ATTACHMENT_PREFIX)}
function isEmbeddedAttachment(value=''){return String(value||'').startsWith('data:image/')||String(value||'').startsWith('data:application/pdf')}
function allAttachmentRefsFromState(){
 const refs=new Set(),add=v=>{if(isStoredAttachment(v))refs.add(v)};
 (state.journal||[]).forEach(x=>(x.photos||[]).forEach(add));
 (state.injuryLogs||[]).forEach(x=>(x.photos||[]).forEach(add));
 (state.receipts||[]).forEach(x=>add(x.photo));
 (state.missedActivities||[]).forEach(x=>(x.photos||[]).forEach(add));
 (state.physioPrescriptions||[]).forEach(x=>(x.photos||[]).forEach(add));
 (state.physioVisits||[]).forEach(x=>(x.photos||[]).forEach(add));
 (state.physioExercises||[]).forEach(x=>{add(x.thumbnail);(x.photos||[]).forEach(add)});
 (state.physioDocuments||[]).forEach(x=>(x.photos||[]).forEach(add));
 return refs;
}
async function migrateOneAttachment(value){
 if(!value||isStoredAttachment(value)||!isEmbeddedAttachment(value))return value;
 return await putAttachmentData(value);
}
async function migrateAttachmentArray(arr=[]){
 const out=[];
 for(const value of arr||[])out.push(await migrateOneAttachment(value));
 return out;
}
async function migrateLegacyAttachments(){
 let migrated=0;
 const beforeCount=allAttachmentRefsFromState().size;
 for(const x of state.journal||[]){const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length}
 for(const x of state.injuryLogs||[]){const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length}
 for(const x of state.receipts||[]){const old=x.photo||'';x.photo=await migrateOneAttachment(old);if(x.photo!==old)migrated++}
 for(const x of state.missedActivities||[]){const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length}
 for(const x of state.physioPrescriptions||[]){const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length}
 for(const x of state.physioVisits||[]){const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length}
 for(const x of state.physioExercises||[]){
   const oldThumb=x.thumbnail||'';x.thumbnail=await migrateOneAttachment(oldThumb);if(x.thumbnail!==oldThumb)migrated++;
   const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length;
 }
 for(const x of state.physioDocuments||[]){const old=(x.photos||[]);x.photos=await migrateAttachmentArray(old);migrated+=x.photos.filter((v,i)=>v!==old[i]).length}
 if(migrated){
   state.attachmentStorageVersion=1;
   state.dataVersion=Math.max(Number(state.dataVersion||0),4);
   if(!save())throw new Error('The migrated attachment references could not be saved to local storage.');
 }
 return {migrated,totalRefs:allAttachmentRefsFromState().size,beforeCount};
}
async function garbageCollectAttachments(){
 const used=allAttachmentRefsFromState();
 const db=await openAttachmentDB();
 const rows=await new Promise((resolve,reject)=>{
   const tx=db.transaction(ATTACHMENT_STORE,'readonly');
   const req=tx.objectStore(ATTACHMENT_STORE).getAllKeys();
   req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
 });
 db.close();
 for(const ref of rows)if(!used.has(ref))await deleteAttachmentRef(ref);
}

const today=()=>new Date().toISOString().slice(0,10);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=(v='')=>String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money=n=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(Number(n||0));
const fmt=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-CA',{year:'numeric',month:'short',day:'numeric'}):'';
const localDateTimeValue=(d=new Date())=>{
 const pad=n=>String(n).padStart(2,'0');
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDateTime=v=>v?new Date(v).toLocaleString('en-CA',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
const localDateKey=v=>{if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const medicationIntervalMs=frequency=>{
 const text=String(frequency||'').trim().toLowerCase();
 const named={
   'once daily':24,'twice daily':12,'three times daily':8,'four times daily':6,
   '1 time daily':24,'2 times daily':12,'3 times daily':8,'4 times daily':6
 };
 if(named[text])return named[text]*60*60*1000;
 if(text.includes('as needed')||text.includes('prn'))return 0;
 let match=text.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs)\b/);
 if(match)return Number(match[1])*60*60*1000;
 match=text.match(/\bq\s*(\d+(?:\.\d+)?)\s*h\b/);
 if(match)return Number(match[1])*60*60*1000;
 match=text.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins)\b/);
 if(match)return Number(match[1])*60*1000;
 match=text.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(day|days)\b/);
 if(match)return Number(match[1])*24*60*60*1000;
 return 0;
};
const parseClockTime=value=>{
 const text=String(value||'').trim();
 if(!text)return '';
 let match=text.match(/^(\d{1,2}):(\d{2})$/);
 if(match){const h=Number(match[1]),m=Number(match[2]);return h<24&&m<60?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:''}
 match=text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
 if(!match)return '';
 let h=Number(match[1]),m=Number(match[2]||0);const ap=match[3].toLowerCase();
 if(h<1||h>12||m>59)return '';
 if(ap==='pm'&&h!==12)h+=12;if(ap==='am'&&h===12)h=0;
 return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};
const nextClockOccurrence=(time,now=new Date())=>{
 if(!time)return null;
 const [h,m]=time.split(':').map(Number);
 if(!Number.isFinite(h)||!Number.isFinite(m))return null;
 const next=new Date(now);next.setHours(h,m,0,0);
 if(next.getTime()<now.getTime())next.setDate(next.getDate()+1);
 return next;
};
const medicationTiming=(med,allDoses,now=new Date())=>{
 const taken=allDoses
   .filter(d=>d.medicationId===med.id&&d.status==='Taken'&&d.dateTime&&!Number.isNaN(new Date(d.dateTime).getTime()))
   .sort((a,b)=>new Date(b.dateTime)-new Date(a.dateTime));
 const last=taken[0]||null;
 const interval=medicationIntervalMs(med.frequency||med.schedule);
 let next=null,start=null;
 if(last&&interval){start=new Date(last.dateTime);next=new Date(start.getTime()+interval)}
 else if(!last&&interval&&med.firstDoseTime){next=nextClockOccurrence(med.firstDoseTime,now);start=new Date(next.getTime()-interval)}
 const remaining=next?next.getTime()-now.getTime():null;
 let statusText='No schedule',statusClass='medNeutral';
 if(next){
   const abs=Math.abs(remaining),hours=Math.floor(abs/3600000),mins=Math.max(0,Math.ceil((abs%3600000)/60000));
   const duration=hours?`${hours}h ${mins}m`:`${mins}m`;
   if(remaining<=-60000){statusText=`Overdue by ${duration}`;statusClass='medOverdue'}
   else if(remaining<=60000){statusText='Due now';statusClass='medDueNow'}
   else if(remaining<=30*60000){statusText=`Due in ${duration}`;statusClass='medDueSoon'}
   else{statusText=`Due in ${duration}`;statusClass='medOnTime'}
 }
 const progress=next&&start&&next>start?Math.min(100,Math.max(0,((now-start)/(next-start))*100)):0;
 return {last,next,start,remaining,statusText,statusClass,progress};
};
const daysBetween=(a,b)=>Math.max(0,Math.floor((new Date(b)-new Date(a))/(86400000)));

const defaults={
  profile:{accidentDate:today(),name:'',lawyer:'',claimNumber:''},
  quickInfo:{
    insurer:'',policyNumber:'',adjusterName:'',adjusterPhone:'',adjusterEmail:'',
    physioClinic:'',physiotherapist:'',physioPhone:'',physioEmail:'',physioAddress:'',physioSchedule:'',
    lawyerFirm:'',lawyerAssistant:'',lawyerPhone:'',lawyerEmail:'',lawyerFileNumber:'',lawyerAddress:'',
    greenShieldPlanName:'',greenShieldPlanNumber:'',greenShieldSecondaryPlanName:'',greenShieldSecondaryPlanNumber:'',
    employer:'',benefitsProvider:'',benefitsGroupPlanNumber:'',employeeIdNumber:'',portfolioId:'',
    benefitsContactName:'',benefitsContactPhone:'',benefitsContactEmail:'',
    familyDoctor:'',familyDoctorPhone:'',familyDoctorEmail:'',clinicName:'',clinicAddress:'',
    pharmacy:'',pharmacyPhone:'',pharmacyAddress:'',importantNotes:'',
    otherHealthcareProviders:[]
  },
  reportSettings:{includePhotos:true,includeMedicationHistory:true,autoPrint:true},
  physioSettings:{startTime:'09:00',endTime:'18:00'},
  journal:[], injuries:[], injuryLogs:[], medications:[], doses:[], medicationEvents:[], receipts:[], appointments:[], missedActivities:[],
  physioPrescriptions:[], physioVisits:[], physioExercises:[], physioExerciseLogs:[], physioDocuments:[],
  tasks:[], questions:[], notes:[], timeline:[]
};
let state=load();
state.profile={...defaults.profile,...(state.profile||{})};
state.quickInfo={...defaults.quickInfo,...(state.quickInfo||{})};
state.quickInfo.otherHealthcareProviders=Array.isArray(state.quickInfo.otherHealthcareProviders)?state.quickInfo.otherHealthcareProviders:[];
state.reportSettings={...defaults.reportSettings,...(state.reportSettings||{})};
state.physioSettings={...defaults.physioSettings,...(state.physioSettings||{})};
function migrateMedicationData(){
 let changed=false;
 state.medications=(state.medications||[]).map(m=>{
   const copy={...m};
   if(!copy.frequency&&copy.schedule){copy.frequency=copy.schedule;changed=true}
   if(!copy.firstDoseTime){
     const source=copy.usualTimes||copy.times||'';
     const first=String(source).split(',')[0];
     const parsed=parseClockTime(first);
     if(parsed){copy.firstDoseTime=parsed;changed=true}
   }
   if(copy.active===undefined&&copy.status){copy.active=copy.status!=='Inactive';changed=true}
   return copy;
 });
 state.medicationEvents=state.medicationEvents||[];
 state.doses=(state.doses||[]).map(d=>{
   const copy={...d};
   const med=state.medications.find(m=>m.id===copy.medicationId);
   if(copy.medicationNameSnapshot===undefined){copy.medicationNameSnapshot=med?.name||'Medication';changed=true}
   if(copy.doseSnapshot===undefined){copy.doseSnapshot=med?.dose||'';changed=true}
   if(copy.frequencySnapshot===undefined){copy.frequencySnapshot=med?.frequency||med?.schedule||'';copy.legacySnapshot=true;changed=true}
   if(copy.note===undefined){copy.note='';changed=true}
   return copy;
 });
 if(!state.dataVersion||state.dataVersion<3){state.dataVersion=3;changed=true}
 if(changed)save();
}
migrateMedicationData();
let page='dashboard';
let modal=null;
let tab='all';

function load(){try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return structuredClone(defaults)}}
function save(){
 try{
   localStorage.setItem(KEY,JSON.stringify(state));
   return true;
 }catch(err){
   console.error('MVA Record Keeper save failed',err);
   alert('The app could not save this change. Your browser storage may be full. Large photos or PDFs can use a lot of space. Try removing an unneeded large attachment or exporting a backup before trying again.');
   return false;
 }
}
function setState(mut){mut(state);save();render()}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.append(el);setTimeout(()=>el.remove(),2200)}
function nav(p){page=p;modal=null;render();window.scrollTo(0,0)}

function appShell(content,title,subtitle=''){
  const items=[
    ['dashboard','🏠','Dashboard'],['journal','📖','Journal'],['injuries','🦴','Injuries'],['medications','💊','Medications'],
    ['physio','🧘','Physiotherapy'],['receipts','🧾','Receipts'],['missedActivities','🎟️','Missed Activities'],['appointments','🩺','Appointments'],['timeline','🕒','Timeline'],
    ['tasks','✅','Tasks'],['notes','📝','Notes & Questions'],['reports','📄','Reports'],['settings','⚙️','Settings']
  ];
  return `<div class="app">
    <aside class="sidebar">
      <div class="brand"><img src="./mva-logo-192.png"><div><strong>MVA Record Keeper</strong><small>Your recovery, organized</small></div></div>
      <nav class="nav">${items.map(i=>`<button data-nav="${i[0]}" class="${page===i[0]?'active':''}"><span>${i[1]}</span>${i[2]}</button>`).join('')}</nav>
      <div class="sidebarFoot">Private data stored on this device.</div>
    </aside>
    <main class="main globalBlueShell">
      <header class="topbar globalMvaTopbar">
        <div class="globalMvaBrand">
          <img src="./mva-logo-32.png" width="36" height="36" alt="MVA Record Keeper">
          <div class="globalMvaBrandWords"><strong>MVA</strong><span>RECORD KEEPER</span></div>
        </div>
        <div class="globalMvaPageTitle"><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>
      </header>
      <div class="globalWhiteContent">${content}</div>
    </main>
    <nav class="bottomNav">${[items[0],items[1],items[2],items[3],['more','•••','More']].map(i=>{
      const morePages=['quickinfo','physio','receipts','missedActivities','appointments','timeline','tasks','notes','reports','settings'];
      const active=i[0]==='more'?morePages.includes(page):page===i[0];
      return `<button data-nav="${i[0]}" class="${active?'active':''}"><span>${i[1]}</span>${i[2]}</button>`;
    }).join('')}</nav>
    ${modal||''}
  </div>`;
}

function dashboard(){
 const upcomingPhysio=[...(state.physioVisits||[])]
   .filter(v=>v.status!=='Completed'&&v.status!=='Cancelled'&&v.date>=today())
   .sort((a,b)=>`${a.date||''}${a.time||''}`.localeCompare(`${b.date||''}${b.time||''}`))[0];

 const upcomingMedical=[...(state.appointments||[])]
   .filter(a=>{
     if(a.physioVisitId)return false;
     if(a.status==='Completed'||a.status==='Cancelled')return false;
     if(!a.date||a.date<today())return false;
     const kind=String(a.appointmentKind||a.type||'').toLowerCase();
     return kind!=='insurance';
   })
   .sort((a,b)=>`${a.date||''}${a.time||''}`.localeCompare(`${b.date||''}${b.time||''}`))[0];

 const recentJournal=[...(state.journal||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
 const activeMeds=(state.medications||[]).filter(m=>m.active!==false);
 const openTasks=(state.tasks||[]).filter(t=>!t.done);
 const recentInjuryLogs=[...(state.injuryLogs||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,3);

 const appointmentCard=(kind,item,icon,emptyText,nav)=>{
   if(!item)return `<section class="card dashboardAppointmentCard ${kind}">
     <div class="dashboardAppointmentHead"><span>${icon}</span><div><small>UPCOMING</small><h3>${kind==='physio'?'Next Physio Appointment':'Next Medical Appointment'}</h3></div></div>
     <div class="dashboardAppointmentEmpty">${emptyText}</div>
     <button class="btn secondary" data-nav="${nav}">View ${kind==='physio'?'Physio':'Appointments'}</button>
   </section>`;
   const provider=kind==='physio'
     ? (item.therapist||state.quickInfo.physiotherapist||'Physiotherapy')
     : (item.provider||item.professionalType||item.reason||'Medical appointment');
   const location=kind==='physio'
     ? (item.clinic||state.quickInfo.physioClinic||'')
     : (item.location||'');
   const reason=kind==='physio'?(item.focus||'Physiotherapy'):(item.reason||'');
   return `<section class="card dashboardAppointmentCard ${kind}">
     <div class="dashboardAppointmentHead"><span>${icon}</span><div><small>UPCOMING</small><h3>${kind==='physio'?'Next Physio Appointment':'Next Medical Appointment'}</h3></div></div>
     <div class="dashboardAppointmentDate"><strong>${fmt(item.date)}</strong>${item.time?`<span>${esc(item.time)}</span>`:''}</div>
     <div class="dashboardAppointmentDetails"><strong>${esc(provider)}</strong>${reason?`<span>${esc(reason)}</span>`:''}${location?`<small>${esc(location)}</small>`:''}</div>
     <button class="btn secondary" data-nav="${nav}">View ${kind==='physio'?'Physio':'Appointments'}</button>
   </section>`;
 };

 return appShell(`
   <section class="dashboardQuickSection dashboardQuickSectionCompact">
     <div class="dashboardQuickGrid compactDashboardQuickGrid">
       <button class="dashboardQuickCard compactDashboardQuickCard" data-add="journal">
         <span class="dashboardQuickIcon">📖</span><strong>Daily Log</strong>
       </button>
       <button class="dashboardQuickCard compactDashboardQuickCard" data-nav="medications">
         <span class="dashboardQuickIcon">💊</span><strong>Medication</strong>
       </button>
       <button class="dashboardQuickCard compactDashboardQuickCard" data-nav="physio">
         <span class="dashboardQuickIcon">🧘</span><strong>Physio</strong>
       </button>
       <button class="dashboardQuickCard compactDashboardQuickCard" data-nav="quickinfo">
         <span class="dashboardQuickIcon">📇</span><strong>Quick Info</strong>
       </button>
       <button class="dashboardQuickCard compactDashboardQuickCard" data-nav="notes">
         <span class="dashboardQuickIcon">📝</span><strong>Notes</strong>
       </button>
       <button class="dashboardQuickCard compactDashboardQuickCard" data-nav="missedActivities">
         <span class="dashboardQuickIcon">🎟️</span><strong>Missed</strong>
       </button>
     </div>
   </section>

   <section class="dashboardAppointmentsGrid">
     ${[
       {kind:'medical',item:upcomingMedical,icon:'🩺',empty:'No upcoming medical appointment',nav:'appointments'},
       {kind:'physio',item:upcomingPhysio,icon:'🧘',empty:'No upcoming physio appointment',nav:'physio'}
     ].sort((a,b)=>{
       const ak=a.item?`${a.item.date||'9999-12-31'}T${a.item.time||'23:59'}`:'9999-12-31T23:59';
       const bk=b.item?`${b.item.date||'9999-12-31'}T${b.item.time||'23:59'}`:'9999-12-31T23:59';
       return ak.localeCompare(bk);
     }).map(x=>appointmentCard(x.kind,x.item,x.icon,x.empty,x.nav)).join('')}
   </section>

   <section class="grid grid3 dashboardStatusGrid">
     <article class="card">
       <div class="muted small">Latest Daily Log</div>
       <div class="dashboardStatusValue">${recentJournal?fmt(recentJournal.date):'None yet'}</div>
       <button class="textButton" data-nav="journal">View daily logs →</button>
     </article>
     <article class="card">
       <div class="muted small">Active Medications</div>
       <div class="dashboardStatusValue">${activeMeds.length}</div>
       <button class="textButton" data-nav="medications">Open medications →</button>
     </article>
     <article class="card">
       <div class="muted small">Open Tasks</div>
       <div class="dashboardStatusValue">${openTasks.length}</div>
       <button class="textButton" data-nav="tasks">View tasks →</button>
     </article>
   </section>

   ${recentInjuryLogs.length?`<section class="card dashboardRecent">
     <div class="toolbar"><div><h2>Recent Injury Updates</h2><p class="muted small">Your latest recorded injury changes.</p></div><button class="btn secondary" data-nav="injuries">View Injuries</button></div>
     <div class="dashboardRecentList">${recentInjuryLogs.map(l=>{
       const inj=(state.injuries||[]).find(i=>i.id===l.injuryId);
       return `<div><strong>${esc(inj?.name||'Injury')}</strong><span>${fmt(l.date)}${l.pain!==''&&l.pain!=null?` · Pain ${esc(l.pain)}/10`:''}${l.change?` · ${esc(l.change)}`:''}</span></div>`;
     }).join('')}</div>
   </section>`:''}
 `,'Dashboard','Your MVA record at a glance.');
}
function latestInjuryLog(injuryId){
 return [...state.injuryLogs].filter(x=>x.injuryId===injuryId).sort((a,b)=>(b.date+b.id).localeCompare(a.date+a.id))[0];
}
function painOptions(value=''){
 return `<option value="">Pain score</option>${Array.from({length:11},(_,n)=>`<option value="${n}" ${String(value)===String(n)?'selected':''}>${n}/10</option>`).join('')}`;
}

function optionButtons(name,value,options){
 return `<input type="hidden" name="${name}" value="${esc(value||'')}"><div class="symptomChoices">${options.map(v=>`<button type="button" class="symptomChoice ${value===v?'selected':''}" data-symptom-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
}

function previousInjuryLog(injuryId,currentDate=today()){
 return [...(state.injuryLogs||[])]
   .filter(l=>l.injuryId===injuryId&&l.date&&l.date<currentDate)
   .sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0]||null;
}
function previousInjuryStrip(injury,currentDate=today()){
 const prev=previousInjuryLog(injury.id,currentDate);
 if(!prev)return `<div class="previousInjuryStrip emptyPrevious"><span>Previous entry</span><strong>No earlier entry</strong></div>`;
 const details=[
   prev.pain!==''&&prev.pain!=null?`Pain ${esc(prev.pain)}/10`:'',
   prev.change?esc(prev.change):'',
   injury.trackSwelling&&prev.swelling?`Swelling: ${esc(prev.swelling)}`:'',
   injury.trackStiffness&&prev.stiffness?`Stiffness: ${esc(prev.stiffness)}`:'',
   injury.trackRangeOfMotion&&prev.rangeOfMotion?`ROM: ${esc(prev.rangeOfMotion)}`:''
 ].filter(Boolean);
 return `<div class="previousInjuryStrip">
   <div class="previousInjuryHead"><span>Previous entry · ${fmt(prev.date)}</span><strong>${details.slice(0,2).join(' · ')||'Recorded'}</strong></div>
   ${details.length>2?`<div class="previousInjuryMetrics">${details.slice(2).map(x=>`<span>${x}</span>`).join('')}</div>`:''}
   ${prev.notes?`<p>${esc(prev.notes)}</p>`:''}
 </div>`;
}

function journal(){
 const sorted=[...state.journal].sort((a,b)=>(b.date+b.id).localeCompare(a.date+a.id));
 const active=state.injuries;
 return appShell(`
 <form class="dailyLogForm compactJournalForm" id="dailyLogForm" data-edit-id="">
  <div class="compactJournalTop">
    <div class="compactJournalTopTitle">
      <h2 id="dailyLogHeading">Daily Log</h2>
      <p>Record how your day went and update your injuries</p>
    </div>
    <div class="compactJournalTopControls">
      <label class="compactJournalDate" for="dailyDate"><span>📅</span><input id="dailyDate" name="date" type="date" value="${today()}"></label>
      <button class="btn primary compactJournalSave saveDailyBtn">Save</button>
    </div>
  </div>

  <section class="card compactJournalNoteCard">
    <div class="compactJournalNoteHead">
      <label for="dailyNotes">How was your day?</label>
      <span class="muted small">Daily overview</span>
    </div>
    <textarea id="dailyNotes" name="notes" rows="4" placeholder="Example: Took a shower and dressed myself for the first time. I still could not brush my hair."></textarea>
  </section>

  <div class="compactJournalInjuryHeading">
    <div>
      <h3>My Injuries</h3>
      <p>Tap an injury to update it</p>
    </div>
    <button type="button" class="compactJournalAddInjury" data-add="injury">+ Add Injury</button>
  </div>

  ${active.length?`<div class="dailyInjuryList compactJournalInjuryList">${active.map(i=>dailyInjuryEditor(i)).join('')}</div>`:`<div class="empty">Add your injuries once, then they will all appear here in every daily log.</div>`}
 </form>
 <div class="toolbar" style="margin-top:20px"><h2 style="margin:0">Previous daily logs</h2><span class="pill">${sorted.length} entries</span></div>
 <div class="list">${sorted.length?sorted.map(j=>{const logs=state.injuryLogs.filter(x=>x.date===j.date);return `<article class="card">
  <div class="toolbar"><div><h3>${fmt(j.date)}</h3></div><div class="actions"><button class="iconBtn" data-edit-daily="${j.id}">Edit daily log</button><button class="iconBtn" data-delete="journal" data-id="${j.id}">Delete</button></div></div>
  <p>${esc(j.notes||'').replace(/\n/g,'<br>')}</p>
  ${(()=>{const dayDoses=(state.doses||[]).filter(d=>localDateKey(d.dateTime)===j.date&&d.status==='Taken').sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));return dayDoses.length?`<div class="dailyMedicationSummary"><strong>Medication taken</strong>${dayDoses.map(d=>`<span>✓ ${esc(d.medicationNameSnapshot||state.medications.find(m=>m.id===d.medicationId)?.name||'Medication')} · ${new Date(d.dateTime).toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'})}${d.doseSnapshot?' · '+esc(d.doseSnapshot):''}</span>`).join('')}</div>`:''})()}
  ${logs.length?`<div class="injurySummary">${logs.map(l=>{const i=state.injuries.find(x=>x.id===l.injuryId);const extras=[l.swelling&&`Swelling: ${esc(l.swelling)}`,l.stiffness&&`Stiffness: ${esc(l.stiffness)}`,l.rangeOfMotion&&`Range of motion: ${esc(l.rangeOfMotion)}`].filter(Boolean);return `<div><strong>${esc(i?.name||'Injury')}</strong>${l.pain!==''&&l.pain!=null?` <span class="pill">${l.pain}/10</span>`:''}${l.change?` · ${esc(l.change)}`:''}${extras.length?`<div class="symptomSummary small">${extras.join(' · ')}</div>`:''}${l.notes?`<div class="small muted">${esc(l.notes)}</div>`:''}${l.photos?.length?`<div class="photoGrid" style="margin-top:8px">${l.photos.map((p,ix)=>attachmentPreview(p,{label:`Injury attachment ${ix+1}`,remove:`<button type="button" class="removePhotoBtn" data-remove-saved-photo="${l.id}:${ix}" aria-label="Remove attachment">×</button>`})).join('')}</div>`:''}</div>`}).join('')}</div>`:''}
 </article>`}).join(''):`<div class="empty">Add your first daily log.</div>`}</div>`,'Daily Log','Record your day and keep every injury separate.');
}

function dailyInjuryEditor(i,log={}){
 const currentDate=document.getElementById('dailyDate')?.value||today();
 const prev=previousInjuryLog(i.id,currentDate);
 const hasCurrentLog=!!(log&&Object.keys(log).length);
 const displayLog=hasCurrentLog?log:{
   pain:prev?.pain??'',
   change:prev?'Same':'',
   swelling:prev?.swelling||'',
   stiffness:prev?.stiffness||'',
   rangeOfMotion:prev?.rangeOfMotion||'',
   lockingCatching:prev?.lockingCatching||prev?.locking||'',
   notes:'',
   photos:[]
 };
 const photos=displayLog.photos||[], pain=displayLog.pain??'', change=displayLog.change||'';
 const symptomFields=[
   i.trackSwelling?`<div class="field symptomField"><label>Swelling</label>${optionButtons(`injury_${i.id}_swelling`,displayLog.swelling||'', ['None','Slight','Moderate','Severe'])}</div>`:'',
   i.trackStiffness?`<div class="field symptomField"><label>Stiffness</label>${optionButtons(`injury_${i.id}_stiffness`,displayLog.stiffness||'', ['None','Slight','Moderate','Severe'])}</div>`:'',
   i.trackRangeOfMotion?`<div class="field symptomField rangeField"><label>Range of motion</label>${optionButtons(`injury_${i.id}_rangeOfMotion`,displayLog.rangeOfMotion||'', ['Full','Slightly limited','Moderately limited','Very limited','Unable'])}</div>`:''
 ].join('');
 const hasSavedData=hasCurrentLog;
 return `<section class="dailyInjuryCard journalMockInjuryCard ${hasSavedData?'is-expanded':''}" data-injury-id="${i.id}">
   <div class="dailyInjuryName journalMockInjuryHead">
     <div class="injuryIcon">🦴</div>
     <div class="injuryTitleBlock">
       <strong>${esc(i.name)}</strong>
       <span class="journalCollapsedSnapshot">${prev?`${prev.pain!==''&&prev.pain!=null?`Previous ${esc(prev.pain)}/10`:'Previous entry'}${prev.change?` · ${esc(prev.change)}`:''}`:(i.description?esc(i.description):'No previous entry')}</span>
     </div>
     <span class="updatedToday">${hasSavedData?'Today saved':(prev?'Carried forward':'Update')}</span>
     <button type="button" class="injuryExpandBtn" data-toggle-injury aria-expanded="${hasSavedData?'true':'false'}" aria-label="${hasSavedData?'Collapse':'Expand'} ${esc(i.name)}">${hasSavedData?'−':'+'}</button>
   </div>
   <div class="dailyInjuryBody">
    ${previousInjuryStrip(i,currentDate)}
    <div class="dailyInjuryFields">
     <div class="field painField"><label>Pain (0–10)</label><input type="hidden" name="injury_${i.id}_pain" value="${esc(pain)}"><div class="painScale">${Array.from({length:11},(_,n)=>`<button type="button" class="painChoice ${String(pain)===String(n)?'selected':''}" data-pain="${n}">${n}</button>`).join('')}</div></div>
     <div class="field changeField"><label>Compared with previous entry</label><input type="hidden" name="injury_${i.id}_change" value="${esc(change)}"><div class="changeChoices">${[['Better','↑'],['Same','='],['Worse','↓']].map(([v,icon])=>`<button type="button" class="changeChoice ${v.toLowerCase()} ${change===v?'selected':''}" data-change="${v}"><span>${icon}</span>${v}${v==='Same'&&prev?.pain!==''&&prev?.pain!=null?` · ${esc(prev.pain)}/10`:''}</button>`).join('')}</div></div>
     ${symptomFields?`<div class="symptomFields">${symptomFields}</div>`:''}
     <div class="field injuryNoteField"><label>Quick note <span>(optional)</span></label><div class="noteWithPhoto"><textarea name="injury_${i.id}_notes" placeholder="What changed or affected this injury today?">${esc(displayLog.notes||'')}</textarea><label class="cameraBtn" title="Add photo">📷<input type="file" name="injury_${i.id}_photos" accept="image/*,application/pdf"></label></div><div class="photoGrid savedPhotoGrid" data-saved-photos="${i.id}">${photos.map((p,ix)=>attachmentPreview(p,{label:`Injury attachment ${ix+1}`,remove:`<button type="button" class="removePhotoBtn" data-remove-edit-photo="${i.id}:${ix}" aria-label="Remove attachment">×</button>`})).join('')}</div></div>
    </div>
   </div>
 </section>`;
}
function editDailyLog(id){
 const entry=state.journal.find(x=>x.id===id); if(!entry)return;
 const form=document.getElementById('dailyLogForm'); if(!form)return;
 form.dataset.editId=id;
 form.elements.date.value=entry.date;
 form.elements.notes.value=entry.notes||'';
 document.getElementById('dailyLogHeading').textContent='Edit daily log';
 state.injuries.forEach(i=>{
   const log=state.injuryLogs.find(x=>x.injuryId===i.id&&x.date===entry.date)||{};
   const card=form.querySelector(`[data-injury-id="${i.id}"]`); if(!card)return;
   card.querySelector(`[name="injury_${i.id}_pain"]`).value=log.pain??'';
   card.querySelectorAll('.painChoice').forEach(b=>b.classList.toggle('selected',String(b.dataset.pain)===String(log.pain??'')));
   card.querySelector(`[name="injury_${i.id}_change"]`).value=log.change||'';
   card.querySelectorAll('.changeChoice').forEach(b=>b.classList.toggle('selected',b.dataset.change===(log.change||'')));
   card.querySelector(`[name="injury_${i.id}_notes"]`).value=log.notes||'';
   ['swelling','stiffness','rangeOfMotion'].forEach(key=>{
     const input=card.querySelector(`[name="injury_${i.id}_${key}"]`);
     if(!input)return;
     input.value=log[key]||'';
     input.closest('.symptomField')?.querySelectorAll('.symptomChoice').forEach(b=>b.classList.toggle('selected',b.dataset.symptomValue===(log[key]||'')));
   });
   card.dataset.logId=log.id||'';
   card.dataset.photos=JSON.stringify(log.photos||[]);
   const grid=card.querySelector('[data-saved-photos]');
   grid.innerHTML=(log.photos||[]).map((p,ix)=>attachmentPreview(p,{label:`Injury attachment ${ix+1}`,remove:`<button type="button" class="removePhotoBtn" data-remove-edit-photo="${i.id}:${ix}" aria-label="Remove attachment">×</button>`})).join('');
 });
 form.scrollIntoView({behavior:'smooth',block:'start'});
 bindDailyPhotoRemoval();
}

async function saveDailyLog(form){
 const fd=new FormData(form), date=String(fd.get('date')||today()), notes=String(fd.get('notes')||'').trim();
 const editId=form.dataset.editId||'';
 let journalEntry=editId?state.journal.find(x=>x.id===editId):state.journal.find(x=>x.date===date);
 if(journalEntry){
   const oldDate=journalEntry.date;
   journalEntry.date=date; journalEntry.notes=notes;
   if(oldDate!==date) state.injuryLogs.filter(x=>x.date===oldDate).forEach(x=>x.date=date);
 } else {
   journalEntry={id:uid(),date,notes,photos:[]}; state.journal.push(journalEntry);
 }

 for(const i of state.injuries){
   const pain=String(fd.get(`injury_${i.id}_pain`)??'');
   const change=String(fd.get(`injury_${i.id}_change`)??'');
   const injuryNotes=String(fd.get(`injury_${i.id}_notes`)??'').trim();
   const swelling=String(fd.get(`injury_${i.id}_swelling`)??'');
   const stiffness=String(fd.get(`injury_${i.id}_stiffness`)??'');
   const rangeOfMotion=String(fd.get(`injury_${i.id}_rangeOfMotion`)??'');
   const card=form.querySelector(`[data-injury-id="${i.id}"]`);
   const existingId=card?.dataset.logId||'';
   let existing=existingId?state.injuryLogs.find(x=>x.id===existingId):state.injuryLogs.find(x=>x.injuryId===i.id&&x.date===date);
   let photos=[];
   try{photos=JSON.parse(card?.dataset.photos||'[]')}catch{}
   const input=form.elements[`injury_${i.id}_photos`];
   if(input?.files?.length) photos.push(...await filesToAttachmentRefs(input));
   const hasData=pain!==''||!!change||!!injuryNotes||!!swelling||!!stiffness||!!rangeOfMotion||photos.length>0;
   if(!hasData){ if(existing) state.injuryLogs=state.injuryLogs.filter(x=>x.id!==existing.id); continue; }
   const log={id:existing?.id||uid(),injuryId:i.id,date,pain:pain===''?'':Math.max(0,Math.min(10,Number(pain))),change,swelling,stiffness,rangeOfMotion,notes:injuryNotes,photos};
   if(existing)Object.assign(existing,log);else state.injuryLogs.push(log);
 }
 save();render();toast('Daily log saved');
}

function bindDailyPhotoRemoval(){
 document.querySelectorAll('[data-remove-edit-photo]').forEach(b=>b.onclick=()=>{
   const [injuryId,indexText]=b.dataset.removeEditPhoto.split(':');
   const card=document.querySelector(`[data-injury-id="${injuryId}"]`); if(!card)return;
   let photos=[];try{photos=JSON.parse(card.dataset.photos||'[]')}catch{}
   photos.splice(Number(indexText),1); card.dataset.photos=JSON.stringify(photos);
   const grid=card.querySelector('[data-saved-photos]');
   grid.innerHTML=photos.map((p,ix)=>attachmentPreview(p,{label:`Injury attachment ${ix+1}`,remove:`<button type="button" class="removePhotoBtn" data-remove-edit-photo="${injuryId}:${ix}" aria-label="Remove attachment">×</button>`})).join('');
   bindDailyPhotoRemoval();
 });
 document.querySelectorAll('[data-remove-saved-photo]').forEach(b=>b.onclick=()=>{
   const [logId,indexText]=b.dataset.removeSavedPhoto.split(':'); const log=state.injuryLogs.find(x=>x.id===logId); if(!log)return;
   const removed=(log.photos||[])[Number(indexText)];log.photos=(log.photos||[]).filter((_,ix)=>ix!==Number(indexText));save();if(isStoredAttachment(removed))deleteAttachmentRef(removed).catch(()=>{});render();toast('Attachment removed');
 });
}

function injuries(){
 const items=[...(state.injuries||[])];
 const palette=['injuryRed','injuryBlue','injuryPurple','injuryTeal','injuryOrange','injuryGreen'];
 const latestFor=(injuryId)=>{
   const logs=(state.injuryLogs||[]).filter(l=>l.injuryId===injuryId).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
   return logs[0]||null;
 };
 const historyFor=(injuryId)=>[...(state.injuryLogs||[])].filter(l=>l.injuryId===injuryId).sort((a,b)=>(b.date||'').localeCompare(a.date||''));

 return appShell(`
 <div class="toolbar injuryPageTop">
   <div><h2 style="margin:0">My Injuries</h2><p class="muted small">Tap an injury to update it quickly. Expand for full history and details.</p></div>
   <button class="btn secondary" data-add="injury">+ Add Injury</button>
 </div>

 <div class="injuryMockupList">${items.length?items.map((i,index)=>{
   const latest=latestFor(i.id);
   const history=historyFor(i.id);
   const tone=palette[index%palette.length];
   const pain=latest&&latest.pain!==''&&latest.pain!=null?Number(latest.pain):0;
   return `<article class="injuryMockupCard ${tone} ${i.active===false?'injuryArchived':''}" data-injury-card="${i.id}">
     <div class="injuryMockupHeader">
       <div class="injuryMockupIdentity">
         <div class="injuryMockupIcon">🦴</div>
         <div>
           <h3>${esc(i.name)}</h3>
           ${i.description?`<p>${esc(i.description)}</p>`:''}
         </div>
       </div>
       <div class="injuryMockupUpdated">
         <span>${latest?.date?'Updated':'No update'}</span>
         <strong>${latest?.date?fmt(latest.date):'—'}</strong>
       </div>
       <button type="button" class="injuryHeaderToggle" data-toggle-injury-card aria-expanded="false">+</button>
     </div>

     <div class="injuryQuickUpdate">
       <div class="injuryPainBlock">
         <div class="injuryFieldLabel">Pain (0–10)</div>
         <div class="injuryPainButtons">
           ${Array.from({length:11},(_,n)=>`<button type="button" class="injuryPainBtn ${pain===n?'selected':''}" data-quick-injury-pain="${i.id}:${n}">${n}</button>`).join('')}
         </div>
       </div>

       <div class="injuryChangeBlock">
         <div class="injuryFieldLabel">Compared to previous update</div>
         <div class="injuryChangeButtons">
           <button type="button" class="${latest?.change==='Better'?'selected':''} better" data-quick-injury-change="${i.id}:Better">↑ Better</button>
           <button type="button" class="${latest?.change==='Same'?'selected':''} same" data-quick-injury-change="${i.id}:Same">= Same</button>
           <button type="button" class="${latest?.change==='Worse'?'selected':''} worse" data-quick-injury-change="${i.id}:Worse">↓ Worse</button>
         </div>
       </div>

       <div class="injuryQuickNoteBlock">
         <div class="injuryFieldLabel">Quick Note <span>(optional)</span></div>
         <div class="injuryQuickNoteBox">
           <textarea data-quick-injury-note="${i.id}" rows="2" placeholder="Add a quick note...">${esc(latest?.notes||'')}</textarea>
           <button type="button" class="injuryQuickSaveBtn" data-save-quick-injury="${i.id}">Save</button>
         </div>
       </div>

       <div class="injuryQuickFooter">
         <button class="injuryEditDetailsBtn" data-edit="injury" data-id="${i.id}">✎ Edit Details</button>
       </div>
     </div>

     <div class="injuryExpandable">
       <div class="injuryExpandableInner">
         <div class="injuryHistoryHead"><strong>History</strong><span>${history.length} entr${history.length===1?'y':'ies'}</span></div>
         ${history.length?`<div class="injuryHistoryList">${history.map(l=>{
           const extras=[
             l.swelling&&`Swelling: ${esc(l.swelling)}`,
             l.stiffness&&`Stiffness: ${esc(l.stiffness)}`,
             l.rangeOfMotion&&`Range of motion: ${esc(l.rangeOfMotion)}`
           ].filter(Boolean);
           return `<section class="injuryDayEntry">
             <div class="injuryDayHead">
               <div><strong>${fmt(l.date)}</strong>${l.change?`<span class="injuryTrend ${String(l.change).toLowerCase()}">${esc(l.change)}</span>`:''}</div>
               <div class="injuryDayPain">${l.pain!==''&&l.pain!=null?`Pain ${esc(l.pain)}/10`:'Pain not recorded'}</div>
             </div>
             ${extras.length?`<div class="injuryMetricsGrid">${extras.map(x=>`<div>${x}</div>`).join('')}</div>`:''}
             ${l.notes?`<div class="injuryNotesBlock"><span>Notes</span><p>${esc(l.notes).replace(/\n/g,'<br>')}</p></div>`:''}
             ${l.photos?.length?`<div class="photoGrid injuryAttachments">${l.photos.map((p,ix)=>attachmentPreview(p,{label:`Injury attachment ${ix+1}`,remove:`<button type="button" class="removePhotoBtn" data-remove-saved-photo="${l.id}:${ix}" aria-label="Remove attachment">×</button>`})).join('')}</div>`:''}
             <div class="actions injuryEntryActions"><button class="iconBtn" data-edit="injuryLog" data-id="${l.id}">Edit Entry</button></div>
           </section>`;
         }).join('')}</div>`:`<div class="empty compactEmpty">No updates recorded for this injury yet.</div>`}
         <div class="actions injuryDeleteActions"><button class="iconBtn" data-delete="injury" data-id="${i.id}">Delete Injury</button></div>
       </div>
     </div>
   </article>`;
 }).join(''):`<div class="empty">No injuries added yet.</div>`}</div>
 `,'Injuries','Track pain, changes, notes and recovery for each injury.');
}
function injuryCard(i){
 const logs=[...state.injuryLogs].filter(x=>x.injuryId===i.id).sort((a,b)=>b.date.localeCompare(a.date));
 return `<section class="card"><div class="toolbar"><div><h3>${esc(i.name)}</h3><div class="rowMeta">${esc(i.description||'')}</div></div><div class="actions"><button class="btn primary" data-log-injury="${i.id}">+ Update</button><button class="iconBtn" data-edit="injury" data-id="${i.id}">Edit</button><button class="iconBtn" data-delete="injury" data-id="${i.id}">Delete</button></div></div>
 ${logs.length?`<div class="injuryHistory">${logs.map(l=>`<div class="historyRow"><div><strong>${fmt(l.date)}</strong>${l.notes?`<div class="small">${esc(l.notes)}</div>`:''}</div><div class="historyScore"><span class="painBadge">${l.pain}/10</span>${l.change?`<span class="small muted">${esc(l.change)}</span>`:''}<button class="iconBtn" data-edit="injuryLog" data-id="${l.id}">Edit</button><button class="iconBtn" data-delete="injuryLog" data-id="${l.id}">Delete</button></div></div>`).join('')}</div>`:`<div class="empty">No updates recorded for this injury.</div>`}</section>`;
}

function doseSnapshot(med,status='Taken',dateTime=new Date().toISOString(),overrides={}){
 return {
   id:overrides.id||uid(),medicationId:med.id,status,dateTime,
   medicationNameSnapshot:overrides.medicationNameSnapshot??med.name??'Medication',
   doseSnapshot:overrides.doseSnapshot??med.dose??'',
   frequencySnapshot:overrides.frequencySnapshot??med.frequency??med.schedule??'',
   note:overrides.note??''
 };
}
function medicationEventText(e){
 if(e.eventType==='Created')return 'Medication added';
 if(e.eventType==='Completed')return `Marked completed${e.reason?`: ${e.reason}`:''}`;
 if(e.eventType==='Reactivated')return 'Medication reactivated';
 if(e.eventType==='Changed')return `${e.field} changed from “${e.from||'Not entered'}” to “${e.to||'Not entered'}”`;
 return e.eventType||'Medication update';
}

const MEDICATION_COLOR_CLASSES=['medColor0','medColor1','medColor2','medColor3','medColor4','medColor5','medColor6','medColor7'];
function medicationColorClass(medicationId,name=''){
 const meds=[...(state.medications||[])];
 let ix=meds.findIndex(m=>m.id===medicationId);
 if(ix<0&&name){
   const clean=String(name).trim().toLowerCase();
   ix=meds.findIndex(m=>String(m.name||'').trim().toLowerCase()===clean);
 }
 if(ix<0){
   let hash=0;const text=String(medicationId||name||'Medication');
   for(let i=0;i<text.length;i++)hash=((hash<<5)-hash)+text.charCodeAt(i);
   ix=Math.abs(hash);
 }
 return MEDICATION_COLOR_CLASSES[ix%MEDICATION_COLOR_CLASSES.length];
}
function medicationColorDot(medicationId,name=''){
 return `<span class="medicationColorDot ${medicationColorClass(medicationId,name)}" aria-hidden="true"></span>`;
}

function doseHistoryRow(d,showMedication=false){
 const med=state.medications.find(x=>x.id===d.medicationId);
 const name=d.medicationNameSnapshot||med?.name||'Medication';
 return `<div class="doseHistoryRow detailedDoseRow medicationHistoryColored ${medicationColorClass(d.medicationId,name)}"><div>${showMedication?`<div class="medicationHistoryName">${medicationColorDot(d.medicationId,name)}<strong>${esc(name)}</strong></div>`:`<strong class="${d.status==='Missed'?'missedDose':'takenDose'}">${esc(d.status)}</strong>`}<span>${showMedication?`${esc(d.status)} · `:''}${fmtDateTime(d.dateTime)}</span><div class="doseSnapshotLine">${d.doseSnapshot?`<span><b>Dose:</b> ${esc(d.doseSnapshot)}</span>`:''}${d.frequencySnapshot?`<span><b>Frequency:</b> ${esc(d.frequencySnapshot)}</span>`:''}</div>${d.note?`<small>${esc(d.note)}</small>`:''}${d.legacySnapshot?`<small class="muted">Older imported record — details use the best information available.</small>`:''}</div><div class="doseRowActions"><button class="iconBtn" type="button" data-edit="dose" data-id="${d.id}">Edit</button><button class="doseDeleteBtn" type="button" data-delete-dose="${d.id}" aria-label="Delete dose record">×</button></div></div>`;
}

function medicationHistoryByDayHtml(records=[]){
 const groups=new Map();
 records.forEach(d=>{
   const day=localDateKey(d.dateTime)||'Unknown';
   if(!groups.has(day))groups.set(day,[]);
   groups.get(day).push(d);
 });
 return [...groups.entries()].map(([day,items])=>{
   items.sort((a,b)=>new Date(a.dateTime||0)-new Date(b.dateTime||0));
   const taken=items.filter(d=>d.status==='Taken').length;
   const missed=items.filter(d=>d.status==='Missed').length;
   return `<section class="medicationDayGroup">
     <div class="medicationDayHeader">
       <div>
         <strong>${day==='Unknown'?'Unknown date':fmt(day)}</strong>
         <span>${items.length} record${items.length===1?'':'s'}</span>
       </div>
       <div class="medicationDayHeaderRight">
         <div class="medicationDayCounts">
           <span class="dayTakenCount">✓ ${taken} taken</span>
           ${missed?`<span class="dayMissedCount">× ${missed} missed</span>`:''}
         </div>
         ${day!=='Unknown'?`<button type="button" class="medicationDayAddBtn" data-add-dose-day="${esc(day)}" aria-label="Add medication record for ${esc(fmt(day))}">+</button>`:''}
       </div>
     </div>
     <div class="doseHistory medicationDayRows">${items.map(d=>doseHistoryRow(d,true)).join('')}</div>
   </section>`;
 }).join('');
}

function medications(){
 const now=new Date();
 const history=[...(state.doses||[])].filter(d=>d.dateTime).sort((a,b)=>new Date(b.dateTime)-new Date(a.dateTime));
 const activeMeds=(state.medications||[]).filter(m=>m.active!==false);
 const completedMeds=(state.medications||[]).filter(m=>m.active===false);
 const sortMeds=list=>[...list].sort((a,b)=>{const at=medicationTiming(a,history,now),bt=medicationTiming(b,history,now);const av=at.next?at.next.getTime():Number.MAX_SAFE_INTEGER,bv=bt.next?bt.next.getTime():Number.MAX_SAFE_INTEGER;return av-bv||String(a.name||'').localeCompare(String(b.name||''))});
 const meds=[...sortMeds(activeMeds),...completedMeds.sort((a,b)=>String(b.completedDate||'').localeCompare(String(a.completedDate||'')))];
 const attention=sortMeds(activeMeds).filter(m=>{const t=medicationTiming(m,history,now);return t.next&&t.remaining<=30*60000});
 return appShell(`
 <div class="toolbar"><div><span class="pill">${activeMeds.length} active · ${completedMeds.length} completed</span></div><div class="toolbarRight"><button class="btn secondary" type="button" data-fix-medication-names>Fix Historical Names</button><button class="btn primary" data-add="medication">+ Add medication</button></div></div>
 ${attention.length?`<section class="card medicationAttention"><h2>Needs attention</h2><div class="attentionList">${attention.map(m=>{const t=medicationTiming(m,history,now);return `<div><div><strong>💊 ${esc(m.name)}</strong><span class="${t.statusClass}">${esc(t.statusText)}</span></div><button class="btn primary compactTaken" type="button" data-dose-now="${m.id}" data-status="Taken">✓ Taken now</button></div>`}).join('')}</div></section>`:''}
 <div class="medicationGrid">${meds.length?meds.map(m=>{
   const allMedicationDoses=history.filter(d=>d.medicationId===m.id);
   const doses=allMedicationDoses.slice(0,10);
   const events=[...(state.medicationEvents||[])].filter(e=>e.medicationId===m.id).sort((a,b)=>new Date(b.dateTime)-new Date(a.dateTime));
   const timing=medicationTiming(m,history,now);
   const nextDueText=timing.next?fmtDateTime(timing.next.toISOString()):(medicationIntervalMs(m.frequency||m.schedule)?'Set first dose time':'As needed');
   const lastTakenText=timing.last?fmtDateTime(timing.last.dateTime):'No dose recorded';
   return `<section class="card medicationCard ${m.active===false?'inactiveMedication':''}" data-medication-card="${m.id}">
    <div class="medicationCollapsedHeader"><div class="medicationIcon">💊</div><div class="medicationHeaderInfo">
      <div class="medicationTitleRow"><div><h3 class="medicationCardTitle">${medicationColorDot(m.id,m.name)}${esc(m.name)}</h3><div class="medDose">${esc(m.dose||'Dose not entered')} · ${esc(m.frequency||m.schedule||'Frequency not entered')}</div>${m.active===false?`<span class="completedMedicationTag">Completed${m.completedDate?' · '+fmt(m.completedDate):''}</span>`:''}</div><button type="button" class="medicationExpandBtn" data-toggle-medication aria-expanded="false">+</button></div>
      <div class="medicationQuickSummary"><div><span>Last taken</span><strong>${lastTakenText}</strong></div><div><span>Next due</span><strong>${m.active===false?'Completed':nextDueText}</strong>${m.active!==false?`<small class="medTimingStatus ${timing.statusClass}">${esc(timing.statusText)}</small>`:''}</div></div>
      ${timing.next&&m.active!==false?`<div class="doseProgress ${timing.remaining<=0?'overdue':''}"><span style="width:${timing.progress.toFixed(1)}%"></span></div>`:''}
      ${m.active!==false?`<button class="btn primary medicationTakenNow" type="button" data-dose-now="${m.id}" data-status="Taken">✓ Taken now</button>`:''}
    </div></div>
    <div class="medicationExpandableBody"><div class="medicationExpandableInner">
      <div class="toolbar medicationHead"><div></div><div class="actions"><button class="iconBtn" data-edit="medication" data-id="${m.id}">Edit</button><button class="iconBtn" data-delete="medication" data-id="${m.id}">Delete</button></div></div>
      ${m.completedReason?`<div class="inactiveBanner"><strong>Completion note:</strong> ${esc(m.completedReason)}</div>`:''}
      ${m.notes?`<p class="small medNotes">${esc(m.notes)}</p>`:''}
      <div class="customDoseLog"><h4>Add a missed or older record</h4><div class="field"><label>Date</label><input type="date" data-dose-date="${m.id}" value="${today()}"></div><div class="field"><label>Time</label><input type="time" data-dose-clock="${m.id}" value="${localDateTimeValue().slice(11,16)}"></div><div class="field"><label>Status</label><select data-dose-status="${m.id}"><option>Taken</option><option>Missed</option></select></div><div class="field"><label>Dose at that time</label><input data-dose-amount="${m.id}" value="${esc(m.dose||'')}"></div><div class="field"><label>Frequency at that time</label><input data-dose-frequency="${m.id}" value="${esc(m.frequency||m.schedule||'')}"></div><div class="field span2"><label>Note (optional)</label><textarea data-dose-note="${m.id}" placeholder="Only add a note when needed."></textarea></div><button class="btn secondary span2" type="button" data-log-dose="${m.id}">Add to history</button></div>
      <div class="medHistoryHead"><strong>Dose history</strong><span>${allMedicationDoses.length} records</span></div>${doses.length?`<div class="doseHistory">${doses.map(d=>doseHistoryRow(d)).join('')}</div>`:`<div class="empty compactEmpty">No doses recorded yet.</div>`}
      ${events.length?`<div class="medHistoryHead"><strong>Medication changes</strong><span>${events.length} changes</span></div><div class="medicationChangeLog">${events.map(e=>`<div><strong>${fmtDateTime(e.dateTime)}</strong><span>${esc(medicationEventText(e))}</span></div>`).join('')}</div>`:''}
    </div></div>
   </section>`;
 }).join(''):`<div class="empty">Add your medications to start tracking doses and exact times.</div>`}</div>
 ${activeMeds.length>=2?`<details class="card multiMedicationLog"><summary class="multiMedicationSummary"><span><strong>Log two medications together</strong><small>Add older doses taken at the same time</small></span><span class="multiMedicationChevron">+</span></summary><div class="multiMedicationContent"><p class="muted small">Use one date and time for medications taken together. Each record keeps its own dose and frequency.</p><div class="multiMedicationShared"><div class="field"><label>Date</label><input type="date" id="multiDoseDate" value="${today()}"></div><div class="field"><label>Time</label><input type="time" id="multiDoseTime" value="${localDateTimeValue().slice(11,16)}"></div><div class="field"><label>Status</label><select id="multiDoseStatus"><option>Taken</option><option>Missed</option></select></div></div><div class="multiMedicationRows">${[1,2].map((row,i)=>`<div class="multiMedicationRow"><div class="field"><label>Medication ${row}</label><select data-multi-med="${row}"><option value="">Choose medication</option>${activeMeds.map((m,index)=>`<option value="${m.id}" ${index===i?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label>Dose at that time</label><input data-multi-dose="${row}" value="${esc(activeMeds[i]?.dose||'')}"></div><div class="field"><label>Frequency at that time</label><input data-multi-frequency="${row}" value="${esc(activeMeds[i]?.frequency||activeMeds[i]?.schedule||'')}"></div><div class="field"><label>Note (optional)</label><input data-multi-note="${row}" placeholder="Optional"></div></div>`).join('')}</div><button class="btn secondary wide" type="button" id="logTwoMedications">Add both to history</button></div></details>`:''}
 ${history.length?`<section class="card allDoseHistory"><div class="toolbar"><div><h2>All medication history</h2><p class="muted small">Grouped by day so you can quickly see how many doses were taken or missed.</p></div></div><div class="medicationDayGroups">${medicationHistoryByDayHtml(history.slice(0,120))}</div></section>`:''}
 `,'Medications','Track actual dose times while preserving changes to dose and frequency over time.');
}


function physioProviderChoices(selected=''){
 const providers=[];
 const add=(name,type='')=>{
   const clean=String(name||'').trim();
   if(!clean)return;
   if(!providers.some(p=>p.name.toLowerCase()===clean.toLowerCase()))providers.push({name:clean,type:String(type||'').trim()});
 };
 add(state.quickInfo.familyDoctor,'Family Doctor');
 add(state.quickInfo.physiotherapist,'Physiotherapist');
 (state.quickInfo.otherHealthcareProviders||[]).forEach(p=>add(p.name,p.specialty||'Healthcare Provider'));
 if(selected&&!providers.some(p=>p.name.toLowerCase()===String(selected).trim().toLowerCase()))add(selected,'Previously entered');
 return providers;
}
function physioProviderSelect(selected=''){
 const providers=physioProviderChoices(selected);
 return `<div class="field"><label>Prescribed / referred by</label><select name="prescribedBy"><option value="">Select provider</option>${providers.map(p=>`<option value="${esc(p.name)}" ${p.name===selected?'selected':''}>${esc(p.name)}${p.type?` — ${esc(p.type)}`:''}</option>`).join('')}</select><div class="providerSelectHint">This list comes from Quick Info → Family Doctor, Physiotherapist, and Additional Healthcare Professionals.</div></div>`;
}
function physioPhotoGallery(photos=[]){
 return photos?.length?`<div class="physioPhotoGrid">${photos.map((p,ix)=>isPdfAttachment(p)
   ? `<a class="physioPdfButton" href="${attachmentSrc(p)}" target="_blank" rel="noopener" aria-label="Open attached PDF ${ix+1}"><span>PDF</span><small>Open document</small></a>`
   : `<button type="button" class="physioPhotoButton" data-view-photo="${esc(p)}" aria-label="View attached photo ${ix+1}"><img src="${attachmentSrc(p)}" alt="Attached document or photo"></button>`
 ).join('')}</div>`:'';
}


function exerciseTimesPerDay(exercise){
 const direct=Number(exercise.timesPerDay);
 if(Number.isFinite(direct)&&direct>0)return Math.round(direct);
 const text=String(exercise.frequency||'').toLowerCase();
 let m=text.match(/(\d+)\s*(?:x|times?)\s*(?:per|a)?\s*day/);
 if(m)return Math.max(1,Number(m[1]));
 m=text.match(/(\d+)\s*(?:daily|\/day)/);
 if(m)return Math.max(1,Number(m[1]));
 if(text.includes('once daily'))return 1;
 if(text.includes('twice daily'))return 2;
 if(text.includes('three times daily'))return 3;
 if(text.includes('four times daily'))return 4;
 return 0;
}
function exerciseDoneToday(exerciseId){
 const key=localDateKey(new Date().toISOString());
 return (state.physioExerciseLogs||[]).filter(l=>l.exerciseId===exerciseId&&l.status==='Done'&&localDateKey(l.dateTime)===key).length;
}

function physioClockDate(time,base=new Date()){
 const [h,m]=String(time||'').split(':').map(Number);
 if(!Number.isFinite(h)||!Number.isFinite(m))return null;
 const d=new Date(base);d.setHours(h,m,0,0);return d;
}
function formatClock(date){return date?date.toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'}):''}
function physioExerciseTiming(exercise,now=new Date()){
 const target=exerciseTimesPerDay(exercise),done=exerciseDoneToday(exercise.id);
 const start=physioClockDate(state.physioSettings.startTime,now),end=physioClockDate(state.physioSettings.endTime,now);
 if(!target||!start||!end||end<=start)return {target,done,statusText:'Set daily window',statusClass:'medNeutral',next:null,slots:[]};
 const slots=[];
 if(target===1)slots.push(start);
 else{
   const step=(end.getTime()-start.getTime())/(target-1);
   for(let i=0;i<target;i++)slots.push(new Date(start.getTime()+step*i));
 }
 if(done>=target)return {target,done,statusText:'Complete for today',statusClass:'physioComplete',next:null,slots};
 const next=slots[Math.min(done,slots.length-1)];
 const remaining=next.getTime()-now.getTime();
 const abs=Math.abs(remaining),hours=Math.floor(abs/3600000),mins=Math.max(0,Math.ceil((abs%3600000)/60000));
 const duration=hours?`${hours}h ${mins}m`:`${mins}m`;
 let statusText,statusClass;
 if(remaining<=-60000){statusText=`Overdue by ${duration}`;statusClass='medOverdue'}
 else if(remaining<=60000){statusText='Due now';statusClass='medDueNow'}
 else if(remaining<=30*60000){statusText=`Due in ${duration}`;statusClass='medDueSoon'}
 else{statusText=`Due in ${duration}`;statusClass='medOnTime'}
 return {target,done,statusText,statusClass,next,remaining,slots};
}
function physioTimingHtml(exercise){
 const t=physioExerciseTiming(exercise);
 return `<div class="physioCountdown ${t.statusClass}">
   <div><span>${t.done>=t.target&&t.target?'Today complete':'Next exercise'}</span><strong>${t.next?formatClock(t.next):(t.done>=t.target&&t.target?'✓ Done':'No schedule')}</strong></div>
   <small class="physioCountdownStatus" data-physio-countdown="${t.next?t.next.toISOString():''}" data-physio-complete="${t.done>=t.target&&t.target?'1':'0'}">${esc(t.statusText)}</small>
 </div>`;
}
function refreshPhysioCountdowns(){
 document.querySelectorAll('[data-physio-countdown]').forEach(el=>{
   if(el.dataset.physioComplete==='1'){el.textContent='Complete for today';return}
   const next=el.dataset.physioCountdown?new Date(el.dataset.physioCountdown):null;
   if(!next||Number.isNaN(next.getTime()))return;
   const remaining=next.getTime()-Date.now(),abs=Math.abs(remaining),hours=Math.floor(abs/3600000),mins=Math.max(0,Math.ceil((abs%3600000)/60000));
   const duration=hours?`${hours}h ${mins}m`:`${mins}m`;
   el.classList.remove('medOverdue','medDueNow','medDueSoon','medOnTime');
   if(remaining<=-60000){el.textContent=`Overdue by ${duration}`;el.classList.add('medOverdue')}
   else if(remaining<=60000){el.textContent='Due now';el.classList.add('medDueNow')}
   else if(remaining<=30*60000){el.textContent=`Due in ${duration}`;el.classList.add('medDueSoon')}
   else{el.textContent=`Due in ${duration}`;el.classList.add('medOnTime')}
 });
}

function exerciseDailyProgressHtml(exercise){
 const target=exerciseTimesPerDay(exercise);
 const done=exerciseDoneToday(exercise.id);
 if(!target){
   return `<div class="exerciseDailyProgress noTarget"><div class="exerciseProgressTop"><span>Today</span><strong>${done} completed</strong></div></div>`;
 }
 const capped=Math.min(done,target);
 const segments=Array.from({length:target},(_,i)=>`<span class="exerciseProgressSegment ${i<capped?'is-complete':''}" aria-hidden="true"></span>`).join('');
 return `<div class="exerciseDailyProgress">
   <div class="exerciseProgressTop"><span>Today</span><strong>${done} / ${target} completed</strong></div>
   <div class="exerciseProgressBar" role="progressbar" aria-label="${esc(exercise.name||'Exercise')} daily progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${capped}">
     ${segments}
   </div>
 </div>`;
}


function physioExerciseHistoryByDayHtml(logs=[]){
 const groups=new Map();
 logs.forEach(log=>{
   const day=localDateKey(log.dateTime)||'Unknown';
   if(!groups.has(day))groups.set(day,[]);
   groups.get(day).push(log);
 });
 return [...groups.entries()].map(([day,items])=>{
   items.sort((a,b)=>new Date(a.dateTime||0)-new Date(b.dateTime||0));
   const done=items.filter(x=>x.status==='Done').length;
   const unable=items.filter(x=>x.status==='Unable').length;
   return `<section class="physioHistoryDay">
     <div class="physioHistoryDayHead">
       <div><strong>${day==='Unknown'?'Unknown date':fmt(day)}</strong><span>${items.length} record${items.length===1?'':'s'}</span></div>
       <div class="physioHistoryDayCounts">
         <span class="physioDoneCount">✓ ${done} completed</span>
         ${unable?`<span class="physioUnableCount">× ${unable} unable</span>`:''}
       </div>
     </div>
     <div class="physioHistoryDayRows">${items.map(physioExerciseLogRow).join('')}</div>
   </section>`;
 }).join('');
}

function physioExerciseLogRow(log){
 const when=fmtDateTime(log.dateTime);
 return `<div class="physioExerciseLogRow">
   <div><strong class="${log.status==='Unable'?'physioUnable':'physioDone'}">${log.status==='Unable'?'Unable':'Completed'}</strong><span>${when}</span>${log.note?`<small>${esc(log.note)}</small>`:''}</div>
   <div class="actions"><button class="iconBtn" data-edit="physioExerciseLog" data-id="${log.id}">Edit</button><button class="iconBtn" data-delete="physioExerciseLog" data-id="${log.id}">Delete</button></div>
 </div>`;
}


function exerciseScorecardHtml(ex){
 const timing=physioExerciseTiming(ex);
 const lastDone=[...(state.physioExerciseLogs||[])]
   .filter(l=>l.exerciseId===ex.id&&l.status==='Done')
   .sort((a,b)=>new Date(b.dateTime)-new Date(a.dateTime))[0];
 const target=exerciseTimesPerDay(ex);
 const done=exerciseDoneToday(ex.id);
 const hero=ex.thumbnail
   ? `<img src="${attachmentSrc(ex.thumbnail)}" alt="${esc(ex.name||'Exercise')}">`
   : `<div class="exerciseScorecardFallback">🏃</div>`;
 return `<div class="exerciseScorecardTop">
   <div class="exerciseScorecardHero">${hero}</div>
   <div class="exerciseScorecardTitle">
     <span class="exerciseScorecardEyebrow">HOME EXERCISE</span>
     <h2>${esc(ex.name||'Exercise')}</h2>
     <p>${ex.prescribedBy?`Prescribed by ${esc(ex.prescribedBy)}`:'Physiotherapy exercise'}</p>
   </div>
   <button type="button" class="exerciseScorecardClose" data-close-exercise-card>✕</button>
 </div>
 <div class="exerciseScorecardStats">
   <div><span>Sets</span><strong>${esc(ex.sets||'—')}</strong></div>
   <div><span>Reps</span><strong>${esc(ex.reps||'—')}</strong></div>
   <div><span>Hold</span><strong>${esc(ex.holdTime||'—')}</strong></div>
   <div><span>Daily</span><strong>${target?`${target}×`:'—'}</strong></div>
 </div>
 <div class="exerciseScorecardProgress">
   <div><span>Today's progress</span><strong>${done}${target?` / ${target}`:''}</strong></div>
   ${target?`<div class="exerciseProgressBar large">${Array.from({length:target},(_,i)=>`<span class="exerciseProgressSegment ${i<Math.min(done,target)?'is-complete':''}"></span>`).join('')}</div>`:''}
 </div>
 <div class="exerciseScorecardGrid">
   <div class="exerciseScorecardInfo"><span>Next scheduled</span><strong>${timing.next?formatClock(timing.next):(done>=target&&target?'Complete for today':'Not scheduled')}</strong><small>${esc(timing.statusText)}</small></div>
   <div class="exerciseScorecardInfo"><span>Last completed</span><strong>${lastDone?fmtDateTime(lastDone.dateTime):'Not yet'}</strong></div>
 </div>
 ${timing.slots.length?`<div class="exerciseScorecardSection"><span>Planned times</span><div class="exerciseTimePills">${timing.slots.map(t=>`<b>${formatClock(t)}</b>`).join('')}</div></div>`:''}
 ${ex.instructions?`<div class="exerciseScorecardSection instructions"><span>Instructions</span><p>${esc(ex.instructions).replace(/\n/g,'<br>')}</p></div>`:''}
 ${ex.exerciseUrl?`<div class="exerciseScorecardSection exerciseLinkSection"><span>Exercise link</span><a class="exerciseLinkButton" href="${esc(ex.exerciseUrl)}" target="_blank" rel="noopener">↗ Open Exercise Link</a></div>`:''}
 ${(ex.photos||[]).length?`<div class="exerciseScorecardSection"><span>Exercise sheet / attachments</span>${physioPhotoGallery(ex.photos||[])}</div>`:''}
 <div class="exerciseScorecardFooter">
   ${ex.active!==false?`<button class="btn primary" type="button" data-scorecard-done="${ex.id}">✓ Done Now</button>`:''}
   <button class="btn secondary" type="button" data-edit="physioExercise" data-id="${ex.id}">Edit Exercise</button>
 </div>`;
}

function physio(){
 const prescriptions=[...(state.physioPrescriptions||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const visits=[...(state.physioVisits||[])].sort((a,b)=>`${b.date||''}${b.time||''}`.localeCompare(`${a.date||''}${a.time||''}`));
 const exercises=[...(state.physioExercises||[])].sort((a,b)=>(a.active===false)-(b.active===false)||(a.name||'').localeCompare(b.name||''));
 const documents=[...(state.physioDocuments||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const upcoming=[...(state.physioVisits||[])].filter(v=>v.status!=='Completed'&&v.status!=='Cancelled'&&v.date>=today()).sort((a,b)=>`${a.date}${a.time||''}`.localeCompare(`${b.date}${b.time||''}`))[0];
 const activeRx=prescriptions.filter(p=>p.active!==false).length;
 const activeExercises=exercises.filter(e=>e.active!==false).length;

 return appShell(`
 <section class="card physioNextCompact">
   <div class="physioNextCompactIcon">🧘</div>
   <div class="physioNextCompactLabel">
     <span>Next Physio</span>
     ${upcoming?`<strong>${fmt(upcoming.date)}${upcoming.time?` · ${esc(upcoming.time)}`:''}</strong>${upcoming.therapist||upcoming.clinic?`<small>${[upcoming.therapist,upcoming.clinic].filter(Boolean).map(esc).join(' · ')}</small>`:''}`:`<strong>No appointment scheduled</strong>`}
   </div>
   <button class="physioCompactLink" data-add="physioVisit">${upcoming?'Add / Update':'Add Visit'}</button>
 </section>

 <section class="card physioSectionCard physioExerciseSection">
  <div class="physioSectionCardHead physioExerciseProgramHead">
    <div class="physioExerciseProgramTitleRow">
      <button class="compactAddExerciseBtn" data-add="physioExercise" aria-label="Add exercise">+ Add</button>
      <div><h2>🏠 Home Exercise Program</h2><p class="muted small">${activeExercises} active exercise${activeExercises===1?'':'s'}</p></div>
    </div>
  </div>
  <div class="physioWindowShell compactWindowShell" data-physio-window>
    <button type="button" class="physioWindowSummary compactWindowSummary" id="togglePhysioWindow" aria-expanded="false">
      <div><span>Schedule</span><strong>${formatClock(physioClockDate(state.physioSettings.startTime))} – ${formatClock(physioClockDate(state.physioSettings.endTime))}</strong></div>
      <span class="physioWindowEditLabel">Edit</span>
      <span class="physioWindowToggleIcon">+</span>
    </button>
    <div class="physioWindowExpandable">
      <div class="physioWindowExpandableInner">
        <div class="physioWindowBar">
          <label><span>Start</span><input type="time" id="physioStartTime" value="${esc(state.physioSettings.startTime)}"></label>
          <label><span>Finish</span><input type="time" id="physioEndTime" value="${esc(state.physioSettings.endTime)}"></label>
          <button type="button" class="btn secondary" id="savePhysioWindow">Save Window</button>
        </div>
      </div>
    </div>
  </div>
  <div class="physioExerciseGrid">${exercises.length?exercises.map(ex=>{
    const logs=[...(state.physioExerciseLogs||[])].filter(l=>l.exerciseId===ex.id).sort((a,b)=>new Date(b.dateTime)-new Date(a.dateTime));
    const lastDone=logs.find(l=>l.status==='Done');
    return `<article class="card physioExerciseCard ${ex.active===false?'physioInactive':''}" data-physio-exercise="${ex.id}">
      <div class="physioExerciseHeader">
       <button type="button" class="physioExerciseHeaderMain" data-open-exercise-card="${ex.id}">
         <div class="physioExerciseIcon">${ex.thumbnail?`<img src="${attachmentSrc(ex.thumbnail)}" alt="${esc(ex.name||'Exercise')} thumbnail">`:'🏃'}</div>
         <div class="physioExerciseTitle"><h3>${esc(ex.name)}</h3><p>${[ex.sets&&`${ex.sets} sets`,ex.reps&&`${ex.reps} reps`,ex.holdTime&&`${ex.holdTime} hold`,exerciseTimesPerDay(ex)&&`${exerciseTimesPerDay(ex)}× daily`].filter(Boolean).map(esc).join(' · ')||'Exercise details not entered'}</p><small>Tap for exercise card</small></div>
       </button>
       <button type="button" class="physioExpandBtn" data-toggle-physio-exercise aria-expanded="false" aria-label="Expand exercise history">+</button>
      </div>
      <div class="physioExerciseQuick physioExerciseQuickProgress">
       <div class="exerciseLastCompleted"><span>Last completed</span><strong>${lastDone?fmtDateTime(lastDone.dateTime):'Not recorded yet'}</strong></div>
       ${exerciseDailyProgressHtml(ex)}
      </div>
      ${ex.active!==false?physioTimingHtml(ex):''}
      ${ex.active!==false?`<div class="physioExerciseButtons"><button class="btn primary" type="button" data-exercise-done="${ex.id}">✓ Done Now</button><button class="btn secondary" type="button" data-exercise-unable="${ex.id}">Unable</button></div>`:''}
      <div class="physioExpandable">
       <div class="physioExpandableInner">
        <div class="physioRecordGrid physioExerciseExpandedInfo">
          ${ex.prescribedBy?`<div><span>Prescribed by</span><strong>${esc(ex.prescribedBy)}</strong></div>`:''}
          ${exerciseTimesPerDay(ex)?`<div><span>Daily target</span><strong>${exerciseTimesPerDay(ex)} time${exerciseTimesPerDay(ex)===1?'':'s'} per day</strong></div>`:''}
          ${physioExerciseTiming(ex).slots.length?`<div class="physioScheduleTimes"><span>Planned times</span><strong>${physioExerciseTiming(ex).slots.map(formatClock).join(' · ')}</strong></div>`:''}
        </div>
        ${ex.instructions?`<div class="physioDetailBlock"><span>Instructions</span><p>${esc(ex.instructions).replace(/\n/g,'<br>')}</p></div>`:''}
        ${physioPhotoGallery(ex.photos||[])}
        <div class="actions"><button class="iconBtn" data-new-exercise-log="${ex.id}">Log Earlier</button><button class="iconBtn" data-edit="physioExercise" data-id="${ex.id}">Edit Exercise</button><button class="iconBtn" data-delete="physioExercise" data-id="${ex.id}">Delete</button></div>
        <div class="physioHistoryHead"><strong>Completion history</strong><span>${logs.length} records</span></div>
        ${logs.length?`<div class="physioExerciseHistoryGrouped">${physioExerciseHistoryByDayHtml(logs.slice(0,60))}</div>`:`<div class="empty compactEmpty">No exercise completions recorded yet.</div>`}
       </div>
      </div>
    </article>`;
  }).join(''):`<div class="empty">Add the home exercises your physiotherapist prescribed. Once added, they become one-tap daily tracking cards.</div>`}</div>
 </section>

 <section class="card physioSectionCard physioDocumentsSection">
  <div class="physioSectionCardHead">
    <div><h2>📋 Prescriptions & Treatment Documents</h2><p class="muted small">Scripts, referrals, exercise sheets, specialist instructions and other treatment paperwork.</p></div>
    <div class="toolbarRight"><button class="btn secondary" data-add="physioPrescription">+ Prescription</button><button class="btn secondary" data-add="physioDocument">+ Document</button></div>
  </div>
  <div class="physioSubsectionLabel">Prescriptions & Referrals</div>
  <div class="list">${prescriptions.length?prescriptions.map(p=>`<article class="card physioRecordCard physioPrescriptionCard" data-physio-prescription="${p.id}">
   <div class="physioPrescriptionHeader">
    <div>
      <h3>${esc(p.title||'Physiotherapy prescription')}</h3>
      <div class="rowMeta">${fmt(p.date)}${p.prescribedBy?' · '+esc(p.prescribedBy):''}</div>
    </div>
    <button type="button" class="physioExpandBtn" data-toggle-physio-prescription aria-expanded="false" aria-label="Expand prescription">+</button>
   </div>
   <div class="physioPrescriptionSummary">
    <div><span>Injury / condition</span><strong>${esc(p.treatmentFor||'Not entered')}</strong></div>
    <div><span>Frequency</span><strong>${esc(p.frequency||'Not entered')}</strong></div>
    <div><span>Duration</span><strong>${esc(p.duration||'Not entered')}</strong></div>
   </div>
   <div class="physioPrescriptionExpandable">
    <div class="physioPrescriptionInner">
      <div class="physioRecordGrid">
       ${p.prescribedBy?`<div><span>Prescribed by</span><strong>${esc(p.prescribedBy)}</strong></div>`:''}
       ${p.status?`<div><span>Status</span><strong>${esc(p.status)}</strong></div>`:''}
      </div>
      ${p.instructions?`<div class="physioDetailBlock"><span>Instructions</span><p>${esc(p.instructions).replace(/\n/g,'<br>')}</p></div>`:''}
      ${physioPhotoGallery(p.photos||[])}
      <div class="actions physioPrescriptionActions"><button class="iconBtn" data-edit="physioPrescription" data-id="${p.id}">Edit</button><button class="iconBtn" data-delete="physioPrescription" data-id="${p.id}">Delete</button></div>
    </div>
   </div>
  </article>`).join(''):`<div class="empty">No physio prescriptions or referrals have been saved.</div>`}</div>
  <div class="physioSubsectionDivider"></div>
  <div class="physioSubsectionHead">
    <div><span class="physioSubsectionLabel">Documents & Photos</span><p class="muted small">Exercise sheets, specialist instructions, handouts, images and PDFs.</p></div>
  </div>
  <div class="list">${documents.length?documents.map(d=>`<article class="physioCompactDocument">
   <div class="physioCompactDocHead">
    <div><strong>${esc(d.title||'Physio document')}</strong><span>${fmt(d.date)}${d.category?' · '+esc(d.category):''}${d.source?' · '+esc(d.source):''}</span></div>
    <button type="button" class="physioExpandBtn compact" data-toggle-physio-document aria-expanded="false">+</button>
   </div>
   <div class="physioDocumentExpandable">
    <div class="physioDocumentInner">
      ${d.notes?`<div class="physioDetailBlock"><span>Notes</span><p>${esc(d.notes).replace(/\n/g,'<br>')}</p></div>`:''}
      ${physioPhotoGallery(d.photos||[])}
      <div class="actions physioPrescriptionActions"><button class="iconBtn" data-edit="physioDocument" data-id="${d.id}">Edit</button><button class="iconBtn" data-delete="physioDocument" data-id="${d.id}">Delete</button></div>
    </div>
   </div>
  </article>`).join(''):`<div class="empty compactEmpty">No treatment documents saved yet.</div>`}</div>
 </section>

 <section class="card physioSectionCard physioVisitsSection">
  <div class="physioSectionCardHead">
    <div><h2>🗓 Physio Visit History</h2><p class="muted small">Visits added here also appear in your regular Appointments section.</p></div>
    <button class="btn secondary" data-add="physioVisit">+ Add Visit</button>
  </div>
  <div class="list">${visits.length?visits.map(v=>`<article class="physioVisitCompact" data-physio-visit="${v.id}">
   <div class="physioVisitCompactHead">
     <div>
       <strong>${fmt(v.date)}${v.time?' · '+esc(v.time):''}</strong>
       <span>${esc(v.therapist||state.quickInfo.physiotherapist||'Physiotherapy')}${v.focus?' · '+esc(v.focus):''}</span>
     </div>
     <button type="button" class="physioExpandBtn compact" data-toggle-physio-visit aria-expanded="false">+</button>
   </div>
   <div class="physioVisitExpandable">
    <div class="physioVisitInner">
      <div class="physioRecordGrid">
       ${v.status?`<div><span>Status</span><strong>${esc(v.status)}</strong></div>`:''}
       ${v.clinic?`<div><span>Clinic</span><strong>${esc(v.clinic)}</strong></div>`:''}
      </div>
      ${v.treatments?`<div class="physioDetailBlock"><span>What was done</span><p>${esc(v.treatments).replace(/\n/g,'<br>')}</p></div>`:''}
      ${v.exercisesSuggested?`<div class="physioDetailBlock"><span>Exercises / suggestions</span><p>${esc(v.exercisesSuggested).replace(/\n/g,'<br>')}</p></div>`:''}
      ${v.restrictions?`<div class="physioDetailBlock"><span>Restrictions / precautions</span><p>${esc(v.restrictions).replace(/\n/g,'<br>')}</p></div>`:''}
      ${v.notes?`<div class="physioDetailBlock"><span>Notes</span><p>${esc(v.notes).replace(/\n/g,'<br>')}</p></div>`:''}
      ${physioPhotoGallery(v.photos||[])}
      <div class="actions physioPrescriptionActions"><button class="iconBtn" data-edit="physioVisit" data-id="${v.id}">Edit</button><button class="iconBtn" data-delete="physioVisit" data-id="${v.id}">Delete</button></div>
    </div>
   </div>
  </article>`).join(''):`<div class="empty">No physio visits recorded yet.</div>`}</div>
 </section>

 <div class="exerciseScorecardBackdrop hidden" id="exerciseScorecardBackdrop">
   <div class="exerciseScorecard" id="exerciseScorecard" role="dialog" aria-modal="true" aria-label="Exercise details"></div>
 </div>

 <div class="physioPhotoViewer hidden" id="physioPhotoViewer"><button type="button" class="physioPhotoClose" id="closePhysioPhoto">✕</button><img id="physioPhotoViewerImage" alt="Attached document"></div>
 `,'Physiotherapy','Track treatment, home exercises, prescriptions and the documents your providers give you.');
}

function missedActivities(){
 const items=[...(state.missedActivities||[])].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
 const total=items.reduce((s,x)=>s+(Number(x.amountLost)||0),0);
 return appShell(`
  <div class="toolbar missedActivitiesTop"><div><h2 style="margin:0">Missed Activities & Events</h2><p class="muted small">Record plans, outings and events you could not attend because of your injuries.</p></div><button class="btn primary" data-add="missedActivity">+ Add</button></div>
  ${items.length?`<div class="grid grid2 missedActivitySummary"><section class="card"><div class="muted small">Recorded items</div><div class="metric">${items.length}</div></section><section class="card"><div class="muted small">Money lost</div><div class="metric">${money(total)}</div></section></div>`:''}
  <div class="missedActivityList">${items.length?items.map(x=>`<article class="card missedActivityCard">
    <div class="missedActivityHead">
      <div class="missedActivityIcon">🎟️</div>
      <div><h3>${esc(x.title||'Missed activity')}</h3><p>${fmt(x.date)}${x.location?` · ${esc(x.location)}`:''}</p></div>
      <button type="button" class="missedActivityToggle" data-toggle-missed-activity aria-expanded="false">+</button>
    </div>
    <div class="missedActivityExpandable"><div class="missedActivityInner">
      ${x.amountLost?`<div class="missedActivityLoss"><span>Money lost</span><strong>${money(x.amountLost)}</strong></div>`:''}
      ${x.withWhom?`<div class="missedActivityText"><span>Who I planned to go with</span><p>${esc(x.withWhom)}</p></div>`:''}
      ${x.reason?`<div class="missedActivityText"><span>Why I missed it</span><p>${esc(x.reason).replace(/\n/g,'<br>')}</p></div>`:''}
      ${x.impact?`<div class="missedActivityText"><span>How it affected me</span><p>${esc(x.impact).replace(/\n/g,'<br>')}</p></div>`:''}
      ${x.notes?`<div class="missedActivityText"><span>Notes</span><p>${esc(x.notes).replace(/\n/g,'<br>')}</p></div>`:''}
      ${(x.photos||[]).length?`<div class="photoGrid missedActivityAttachments">${x.photos.map((p,ix)=>attachmentPreview(p,{label:`Missed activity attachment ${ix+1}`})).join('')}</div>`:''}
      <div class="actions missedActivityBottomActions"><button class="iconBtn" data-edit="missedActivity" data-id="${x.id}">Edit</button><button class="iconBtn" data-delete="missedActivity" data-id="${x.id}">Delete</button></div>
    </div></div>
  </article>`).join(''):`<div class="empty">Nothing recorded yet. Add a concert, outing, trip, family event, activity, or other plan you missed because of your injuries.</div>`}</div>
 `,'Missed Activities','Plans and events your injuries prevented you from attending.');
}
function receipts(){
 const total=state.receipts.reduce((s,r)=>s+Number(r.amount||0),0);
 const sorted=[...state.receipts].sort((a,b)=>b.date.localeCompare(a.date));
 return appShell(`<div class="grid grid2"><section class="card"><div class="muted small">Total expenses</div><div class="metric">${money(total)}</div></section><section class="card"><div class="muted small">Number of receipts</div><div class="metric">${state.receipts.length}</div></section></div>
 <div class="toolbar" style="margin-top:16px"><div></div><button class="btn primary" data-add="receipt">+ Add receipt</button></div>
 <div class="list">${sorted.length?sorted.map(r=>`<div class="row"><div class="rowMain" style="display:flex;gap:12px">${reportSettings.includePhotos&&r.photo?attachmentPreview(r.photo,{label:'Receipt'}):''}<div><div class="rowTitle">${esc(r.description)}</div><div class="rowMeta">${fmt(r.date)} · ${esc(r.category||'Other')}</div>${r.notes?`<div class="small">${esc(r.notes)}</div>`:''}</div></div><div><strong>${money(r.amount)}</strong><div class="actions" style="margin-top:8px"><button class="iconBtn" data-edit="receipt" data-id="${r.id}">Edit</button><button class="iconBtn" data-delete="receipt" data-id="${r.id}">Delete</button></div></div></div>`).join(''):`<div class="empty">No receipts recorded.</div>`}</div>`,'Receipts','Keep expense details and receipt photos together.');
}

function appointments(){
 const sorted=[...state.appointments].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||''));
 const visible=filterAppts(sorted);
 return appShell(`<div class="toolbar"><div class="tabs"><button class="${tab==='all'?'active':''}" data-tab="all">All</button><button class="${tab==='upcoming'?'active':''}" data-tab="upcoming">Upcoming</button><button class="${tab==='past'?'active':''}" data-tab="past">Past</button></div><button class="btn primary" data-add="appointment">+ Add appointment</button></div>
 <div class="list">${visible.length?visible.map(a=>{
   const kind=a.appointmentKind||((a.type||'').toLowerCase().includes('insurance')?'Insurance':'Medical');
   const insurance=kind==='Insurance';
   const title=insurance?(a.insuranceCompany||a.contactName||'Insurance contact'):(a.provider||a.professionalType||'Medical appointment');
   const detail=insurance
     ? [a.contactName,a.contactMethod].filter(Boolean).join(' · ')
     : [a.professionalType,a.location].filter(Boolean).join(' · ');
   const notes=insurance
     ? (a.discussionNotes||a.notes||'')
     : (a.visitSummary||a.notes||'');
   return `<section class="card appointmentCard" data-appointment-card="${a.id}">
    <div class="appointmentCollapsedHeader">
      <div class="appointmentTypeIcon">${insurance?'🚗':'🏥'}</div>
      <div class="appointmentHeaderInfo">
        <div class="appointmentTitleRow">
          <div>
            <div class="appointmentTypeLabel">${insurance?'Insurance appointment':'Medical appointment'}</div>
            <h3>${esc(title)}</h3>
            ${detail?`<div class="appointmentSubtitle">${esc(detail)}</div>`:''}
          </div>
          <button type="button" class="appointmentExpandBtn" data-toggle-appointment aria-expanded="false">+</button>
        </div>
        <div class="appointmentQuickSummary">
          <div><span>Date & time</span><strong>${fmt(a.date)}${a.time?' · '+esc(a.time):''}</strong></div>
          <div><span>Status</span><strong>${esc(a.status||'Scheduled')}</strong></div>
        </div>
      </div>
    </div>
    <div class="appointmentExpandableBody">
      <div class="appointmentExpandableInner">
        <div class="appointmentTopActions"><button class="iconBtn appointmentRebookBtn" type="button" data-rebook-appointment="${a.id}">↻ Rebook</button><button class="iconBtn" data-edit="appointment" data-id="${a.id}">Edit</button><button class="iconBtn" data-delete="appointment" data-id="${a.id}">Delete</button></div>
        ${insurance?`
          <div class="appointmentDetailsGrid">
            ${a.insuranceCompany?`<div><span>Insurance company</span><strong>${esc(a.insuranceCompany)}</strong></div>`:''}
            ${a.contactName?`<div><span>Person spoken with</span><strong>${esc(a.contactName)}</strong></div>`:''}
            ${a.contactMethod?`<div><span>Contact method</span><strong>${esc(a.contactMethod)}</strong></div>`:''}
            ${a.claimNumber?`<div><span>Claim number</span><strong>${esc(a.claimNumber)}</strong></div>`:''}
          </div>
          ${notes?`<div class="appointmentNotesBlock"><span>Discussion notes</span><p>${esc(notes)}</p></div>`:''}
          ${a.actionItems?`<div class="appointmentNotesBlock"><span>Action items</span><p>${esc(a.actionItems)}</p></div>`:''}
          ${a.followUp?`<div class="appointmentNotesBlock"><span>Follow-up</span><p>${esc(a.followUp)}</p></div>`:''}
        `:`
          <div class="appointmentDetailsGrid">
            ${a.provider?`<div><span>Provider</span><strong>${esc(a.provider)}</strong></div>`:''}
            ${a.professionalType?`<div><span>Professional type</span><strong>${esc(a.professionalType)}</strong></div>`:''}
            ${a.location?`<div><span>Clinic or hospital</span><strong>${esc(a.location)}</strong></div>`:''}
            ${a.reason?`<div><span>Reason</span><strong>${esc(a.reason)}</strong></div>`:''}
          </div>
          ${notes?`<div class="appointmentNotesBlock"><span>Visit summary</span><p>${esc(notes)}</p></div>`:''}
          ${a.testsOrdered?`<div class="appointmentNotesBlock"><span>Tests ordered</span><p>${esc(a.testsOrdered)}</p></div>`:''}
          ${a.followUp?`<div class="appointmentNotesBlock"><span>Follow-up</span><p>${esc(a.followUp)}</p></div>`:''}
        `}
      </div>
    </div>
   </section>`;
 }).join(''):`<div class="empty">No appointments in this view.</div>`}</div>`,'Appointments','Track medical appointments and insurance conversations.');
}

function filterAppts(a){return tab==='upcoming'?a.filter(x=>x.date>=today()):tab==='past'?a.filter(x=>x.date<today()):a}

function timeline(){
 const sorted=[...state.timeline].sort((a,b)=>a.date.localeCompare(b.date));
 return appShell(`<div class="toolbar"><div><span class="pill">${sorted.length} events</span></div><button class="btn primary" data-add="timeline">+ Add event</button></div>
 ${sorted.length?`<div class="card"><div class="timeline">${sorted.map(t=>`<div class="timelineItem"><div class="toolbar"><div><div class="rowMeta">${fmt(t.date)}</div><div class="rowTitle">${esc(t.title)}</div><div class="small">${esc(t.type||'Event')}</div></div><div class="actions"><button class="iconBtn" data-edit="timeline" data-id="${t.id}">Edit</button><button class="iconBtn" data-delete="timeline" data-id="${t.id}">Delete</button></div></div>${t.notes?`<p>${esc(t.notes)}</p>`:''}</div>`).join('')}</div></div>`:`<div class="empty">Build a chronological record from the accident onward.</div>`}`,'Recovery Timeline','See important events in chronological order.');
}

function taskRow(t){return `<div class="checkRow"><input type="checkbox" data-check-task="${t.id}" ${t.done?'checked':''}><div class="${t.done?'strike':''}"><div class="rowTitle">${esc(t.title)}</div><div class="rowMeta">${t.due?fmt(t.due):'No due date'} · ${esc(t.priority||'Normal')}</div></div></div>`}
function tasks(){
 return appShell(`<div class="toolbar"><div><span class="pill">${state.tasks.filter(t=>!t.done).length} open</span></div><button class="btn primary" data-add="task">+ Add task</button></div>
 <div class="card"><div class="list">${state.tasks.length?state.tasks.map(t=>`<div class="row"><div>${taskRow(t)}</div><div class="actions"><button class="iconBtn" data-edit="task" data-id="${t.id}">Edit</button><button class="iconBtn" data-delete="task" data-id="${t.id}">Delete</button></div></div>`).join(''):`<div class="empty">No tasks yet.</div>`}</div></div>`,'Tasks & Paperwork','Stay on top of forms, calls, follow-ups and deadlines.');
}

function notes(){
 const sortedNotes=[...(state.notes||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 return appShell(`<div class="grid grid2">
 <section class="card"><div class="toolbar"><h2>Questions</h2><button class="btn secondary" data-add="question">+ Add</button></div><div class="list">${state.questions.length?state.questions.map(q=>`<div class="row"><div class="${q.answered?'strike':''}"><div class="rowTitle">${esc(q.text)}</div><div class="rowMeta">${esc(q.forWhom||'Doctor')}</div>${q.answer?`<div class="small"><strong>Answer:</strong> ${esc(q.answer)}</div>`:''}</div><div class="actions"><button class="iconBtn" data-edit="question" data-id="${q.id}">Edit</button><button class="iconBtn" data-delete="question" data-id="${q.id}">Delete</button></div></div>`).join(''):`<div class="empty">No questions saved.</div>`}</div></section>
 <section class="card generalNotesSection"><div class="toolbar"><h2>General notes</h2><button class="btn secondary" data-add="note">+ Add</button></div><div class="list">${sortedNotes.length?sortedNotes.map(n=>`<article class="noteCollapsible">
   <div class="noteCollapseHead">
     <div><div class="rowTitle">${esc(n.title||'Note')}</div><div class="rowMeta">${fmt(n.date)}</div></div>
     <button type="button" class="noteToggleBtn" data-toggle-note aria-expanded="false">+</button>
   </div>
   <div class="noteExpandable"><div class="noteInner">
     ${n.text?`<p class="small">${esc(n.text).replace(/\n/g,'<br>')}</p>`:''}
     <div class="actions noteBottomActions"><button class="iconBtn" data-edit="note" data-id="${n.id}">Edit</button><button class="iconBtn" data-delete="note" data-id="${n.id}">Delete</button></div>
   </div></div>
 </article>`).join(''):`<div class="empty">No notes saved.</div>`}</div></section>
 </div>`,'Notes & Questions','Keep questions for doctors, your lawyer, insurer and your own notes.');
}
function reports(){
 const totalReceipts=state.receipts.reduce((sum,r)=>sum+Number(r.amount||0),0);
 const quickCard=(icon,title,description,type,includes)=>`<section class="card reportPresetCard"><div class="reportPresetIcon">${icon}</div><h2>${title}</h2><p>${description}</p><div class="reportIncludes">${includes.map(x=>`<span>✓ ${x}</span>`).join('')}</div><button class="btn primary wide" data-generate-report="${type}">Generate ${title}</button></section>`;
 return appShell(`
 <div class="reportIntro card"><div><span class="pill">Reports 2.0</span><h2>Create a professional recovery report</h2><p>Choose a ready-made report or build your own. Reports open in a print-ready window where you can select <strong>Save as PDF</strong>.</p></div><div class="reportIntroStats"><strong>${state.journal.length}</strong><span>Daily logs</span><strong>${state.appointments.length}</strong><span>Appointments</span><strong>${money(totalReceipts)}</strong><span>Expenses</span></div></div>
 <div class="grid grid3 reportPresetGrid">
 ${quickCard('🩺','Medical Report','A focused clinical history for doctors, specialists and therapists.','medical',['Daily logs','Injuries','Medication timeline','Appointments'])}
 ${quickCard('⚖️','Full Claim Report','A complete chronological package for your lawyer or claim file.','legal',['All recovery records','Receipts and photos','Medication changes','Notes and timeline'])}
 ${quickCard('💰','Insurance Report','A concise report focused on appointments, expenses and claim activity.','insurance',['Appointments','Receipts','Recovery timeline','Claim notes'])}
 </div>
 <section class="card customReportCard"><div class="toolbar"><div><span class="pill">Custom</span><h2>Build a custom report</h2><p class="muted">Choose the date range and sections to include.</p></div></div>
 <div class="reportDateRange"><div class="field"><label>From</label><input id="reportFrom" type="date"></div><div class="field"><label>To</label><input id="reportTo" type="date" value="${today()}"></div></div>
 <div class="reportOptionGrid">
 ${[['journal','Daily logs'],['injuries','Injury tracking'],['medications','Medication timeline'],['doseHistory','Detailed dose history'],['appointments','Appointments'],['receipts','Receipts and expenses'],['timeline','Recovery timeline'],['notes','Notes and questions'],['photos','Photo appendix']].map(([key,label])=>`<label class="settingCheck"><input type="checkbox" data-report-option="${key}" ${key==='photos'?'':'checked'}><span><strong>${label}</strong></span></label>`).join('')}
 </div>
 <div class="reportActions"><button class="btn secondary" id="previewCustomReport">Preview report</button><button class="btn primary" id="generateCustomReport">Generate PDF report</button></div>
 <div id="reportPreview" class="reportPreview hidden"></div>
 </section>`,'Reports','Create medical, legal, insurance or custom reports.');
}



function otherProviderEditRow(p={},ix=0){
 return `<div class="otherProviderRow" data-provider-row>
   <div class="otherProviderRowHead">
     <div><span class="providerEditorNumber">${ix+1}</span><strong>${esc(p.name||`Healthcare Professional ${ix+1}`)}</strong>${p.specialty?`<small>${esc(p.specialty)}</small>`:''}</div>
     <button type="button" class="iconBtn removeOtherProvider">Remove</button>
   </div>
   <div class="formGrid">
     ${field('Provider / specialist name','providerName',p.name||'')}
     ${field('Specialty','providerSpecialty',p.specialty||'')}
     ${field('Clinic / hospital','providerClinic',p.clinic||'')}
     ${field('Phone','providerPhone',p.phone||'','tel')}
     ${field('Email','providerEmail',p.email||'','email')}
     ${field('Address','providerAddress',p.address||'')}
   </div>
 </div>`;
}

function quickInfo(){
 const q={...defaults.quickInfo,...(state.quickInfo||{})};
 const display=(label,value,copy=true)=>`<div class="quickInfoValue"><span>${esc(label)}</span><div><strong>${esc(value||'Not entered')}</strong>${copy&&value?`<button type="button" class="quickCopyBtn" data-copy-value="${esc(value)}">Copy</button>`:''}</div></div>`;
 const phone=(label,value)=>{
   const clean=String(value||'').replace(/[^0-9+*#,;]/g,'');
   return `<div class="quickInfoValue"><span>${esc(label)}</span><div>${value?`<a class="quickContactLink phoneLink" href="tel:${esc(clean)}">${esc(value)}</a>`:`<strong>Not entered</strong>`}${value?`<button type="button" class="quickCopyBtn" data-copy-value="${esc(value)}">Copy</button>`:''}</div></div>`;
 };
 const email=(label,value)=>{
   return `<div class="quickInfoValue"><span>${esc(label)}</span><div>${value?`<a class="quickContactLink emailLink" href="mailto:${esc(value)}">${esc(value)}</a>`:`<strong>Not entered</strong>`}${value?`<button type="button" class="quickCopyBtn" data-copy-value="${esc(value)}">Copy</button>`:''}</div></div>`;
 };
 return appShell(`
 <div class="quickInfoTopbar">
   <div><span class="pill">Quick Reference</span><h2>Everything you are commonly asked for</h2><p class="muted">Claim, treatment, legal and benefits information in one place. Tap Copy beside any saved value.</p></div>
   <div class="quickInfoTopActions"><button class="btn secondary" id="printQuickInfo">Print Information Sheet</button><button class="btn primary" id="openQuickInfoEdit">Edit Information</button></div>
 </div>

 <div class="quickInfoGrid">
  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>🚗</span><div><h2>Accident & Claim</h2><small>Core claim information</small></div></div>
    ${display('Claimant',state.profile.name)}
    ${display('Accident date',fmt(state.profile.accidentDate),false)}
    ${display('Insurance company',q.insurer)}
    ${display('Policy number',q.policyNumber)}
    ${display('Claim number',state.profile.claimNumber)}
    ${display('Adjuster',q.adjusterName)}
    ${phone('Adjuster phone',q.adjusterPhone)}
    ${email('Adjuster email',q.adjusterEmail)}
  </section>

  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>👩‍⚕️</span><div><h2>Family Doctor</h2><small>Primary care information</small></div></div>
    ${display('Doctor',q.familyDoctor)}
    ${phone('Doctor phone',q.familyDoctorPhone)}
    ${email('Doctor email',q.familyDoctorEmail)}
    ${display('Clinic name',q.clinicName)}
    ${display('Clinic address',q.clinicAddress)}
  </section>

  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>🩺</span><div><h2>Physiotherapy</h2><small>Clinic and appointment information</small></div></div>
    ${display('Clinic',q.physioClinic)}
    ${display('Physiotherapist',q.physiotherapist)}
    ${phone('Clinic phone',q.physioPhone)}
    ${email('Clinic email',q.physioEmail)}
    ${display('Address',q.physioAddress)}
    ${display('Usual appointment / schedule',q.physioSchedule)}
  </section>

  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>⚖️</span><div><h2>Lawyer</h2><small>Legal file contacts</small></div></div>
    ${display('Lawyer',state.profile.lawyer)}
    ${display('Firm',q.lawyerFirm)}
    ${display('Assistant / contact',q.lawyerAssistant)}
    ${phone('Phone',q.lawyerPhone)}
    ${email('Email',q.lawyerEmail)}
    ${display('File number',q.lawyerFileNumber)}
    ${display('Address',q.lawyerAddress)}
  </section>

  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>🟢</span><div><h2>Green Shield</h2><small>Primary and secondary coverage</small></div></div>
    ${display('Primary plan name',q.greenShieldPlanName)}
    ${display('Primary plan number',q.greenShieldPlanNumber)}
    ${display('Secondary plan name',q.greenShieldSecondaryPlanName)}
    ${display('Secondary plan number',q.greenShieldSecondaryPlanNumber)}
  </section>

  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>💼</span><div><h2>Work & Benefits</h2><small>Plan IDs and benefits contact</small></div></div>
    ${display('Employer',q.employer)}
    ${display('Benefits provider',q.benefitsProvider)}
    ${display('Group plan number',q.benefitsGroupPlanNumber)}
    ${display('Employee ID number',q.employeeIdNumber)}
    ${display('Portfolio ID',q.portfolioId)}
    ${display('Contact person',q.benefitsContactName)}
    ${phone('Contact phone',q.benefitsContactPhone)}
    ${email('Contact email',q.benefitsContactEmail)}
  </section>

  <section class="card quickInfoSection"><div class="quickInfoSectionHead"><span>🏥</span><div><h2>Other Healthcare</h2><small>Healthcare contacts grouped by provider</small></div></div>
    <div class="healthcareGroup">
      <div class="healthcareGroupHead"><span>💊</span><div><strong>Pharmacy</strong><small>Pharmacy contact information</small></div></div>
      ${display('Pharmacy name',q.pharmacy)}
      ${phone('Pharmacy phone',q.pharmacyPhone)}
      ${display('Pharmacy address',q.pharmacyAddress)}
    </div>

    <div class="healthcareGroup additionalProvidersGroup">
      <div class="healthcareGroupHead"><span>🩻</span><div><strong>Additional Healthcare Professionals</strong><small>Specialists and other treating providers</small></div></div>
      ${(q.otherHealthcareProviders||[]).length
        ? (q.otherHealthcareProviders||[]).map((p,ix)=>`
          <div class="providerMiniCard">
            <div class="providerMiniCardHead">
              <div><strong>${esc(p.name||`Provider ${ix+1}`)}</strong>${p.specialty?`<span>${esc(p.specialty)}</span>`:''}</div>
              <span class="providerNumber">${ix+1}</span>
            </div>
            ${p.clinic?`<div class="providerDetail"><span>Clinic / hospital</span><strong>${esc(p.clinic)}</strong></div>`:''}
            ${p.phone?`<div class="providerDetail"><span>Phone</span><div><a class="quickContactLink phoneLink" href="tel:${esc(String(p.phone).replace(/[^0-9+*#,;]/g,''))}">${esc(p.phone)}</a><button type="button" class="quickCopyBtn" data-copy-value="${esc(p.phone)}">Copy</button></div></div>`:''}
            ${p.email?`<div class="providerDetail"><span>Email</span><div><a class="quickContactLink emailLink" href="mailto:${esc(p.email)}">${esc(p.email)}</a><button type="button" class="quickCopyBtn" data-copy-value="${esc(p.email)}">Copy</button></div></div>`:''}
            ${p.address?`<div class="providerDetail"><span>Address</span><strong>${esc(p.address)}</strong></div>`:''}
          </div>`).join('')
        : `<div class="empty compactEmpty">No additional healthcare professionals added yet.</div>`}
    </div>
  </section>
 </div>

 ${q.importantNotes?`<section class="card quickInfoNotes"><h2>📝 Important Notes</h2><p>${esc(q.importantNotes).replace(/\n/g,'<br>')}</p></section>`:''}

 <div class="modalBackdrop quickInfoEditBackdrop hidden" id="quickInfoEditBackdrop">
  <div class="modal quickInfoModal">
   <div class="modalHead"><div><h2>Edit Quick Reference</h2><p class="muted small">Fields marked Linked also update the same information used elsewhere in the app.</p></div><button type="button" class="iconBtn" id="closeQuickInfoEdit">Close</button></div>
   <form id="quickInfoForm">
    <div class="quickEditGroup"><h3>🚗 Accident & Claim</h3><div class="formGrid">
      <div class="field linkedField"><label>Name <span class="linkedBadge">Linked</span></label><input name="profileName" value="${esc(state.profile.name)}"></div>
      <div class="field linkedField"><label>Accident date <span class="linkedBadge">Linked</span></label><input name="profileAccidentDate" type="date" value="${esc(state.profile.accidentDate)}"></div>
      ${field('Insurance company','insurer',q.insurer)}${field('Policy number','policyNumber',q.policyNumber)}
      <div class="field linkedField"><label>Claim number <span class="linkedBadge">Linked</span></label><input name="profileClaimNumber" value="${esc(state.profile.claimNumber)}"></div>
      ${field('Adjuster name','adjusterName',q.adjusterName)}${field('Adjuster phone','adjusterPhone',q.adjusterPhone,'tel')}
      ${field('Adjuster email','adjusterEmail',q.adjusterEmail,'email')}
    </div></div>

    <div class="quickEditGroup"><h3>👩‍⚕️ Family Doctor</h3><div class="formGrid">
      ${field('Family doctor','familyDoctor',q.familyDoctor)}
      ${field('Doctor phone','familyDoctorPhone',q.familyDoctorPhone,'tel')}
      ${field('Doctor email','familyDoctorEmail',q.familyDoctorEmail,'email')}
      ${field('Clinic name','clinicName',q.clinicName)}
      ${field('Clinic address','clinicAddress',q.clinicAddress)}
    </div></div>

    <div class="quickEditGroup"><h3>🩺 Physiotherapy</h3><div class="formGrid">
      ${field('Clinic','physioClinic',q.physioClinic)}${field('Physiotherapist','physiotherapist',q.physiotherapist)}
      ${field('Clinic phone','physioPhone',q.physioPhone,'tel')}${field('Clinic email','physioEmail',q.physioEmail,'email')}
      ${field('Clinic address','physioAddress',q.physioAddress)}${field('Usual appointment / schedule','physioSchedule',q.physioSchedule)}
    </div></div>

    <div class="quickEditGroup"><h3>⚖️ Lawyer</h3><div class="formGrid">
      <div class="field linkedField"><label>Lawyer <span class="linkedBadge">Linked</span></label><input name="profileLawyer" value="${esc(state.profile.lawyer)}"></div>
      ${field('Firm','lawyerFirm',q.lawyerFirm)}${field('Assistant / contact','lawyerAssistant',q.lawyerAssistant)}
      ${field('Phone','lawyerPhone',q.lawyerPhone,'tel')}${field('Email','lawyerEmail',q.lawyerEmail,'email')}
      ${field('File number','lawyerFileNumber',q.lawyerFileNumber)}${field('Address','lawyerAddress',q.lawyerAddress)}
    </div></div>

    <div class="quickEditGroup"><h3>🟢 Green Shield</h3><div class="formGrid">
      ${field('Primary plan name','greenShieldPlanName',q.greenShieldPlanName)}
      ${field('Primary plan number','greenShieldPlanNumber',q.greenShieldPlanNumber)}
      ${field('Secondary plan name','greenShieldSecondaryPlanName',q.greenShieldSecondaryPlanName)}
      ${field('Secondary plan number','greenShieldSecondaryPlanNumber',q.greenShieldSecondaryPlanNumber)}
    </div></div>

    <div class="quickEditGroup"><h3>💼 Work & Benefits</h3><div class="formGrid">
      ${field('Employer','employer',q.employer)}${field('Benefits provider','benefitsProvider',q.benefitsProvider)}
      ${field('Group plan number','benefitsGroupPlanNumber',q.benefitsGroupPlanNumber)}
      ${field('Employee ID number','employeeIdNumber',q.employeeIdNumber)}
      ${field('Portfolio ID','portfolioId',q.portfolioId)}
      ${field('Contact person','benefitsContactName',q.benefitsContactName)}
      ${field('Contact phone','benefitsContactPhone',q.benefitsContactPhone,'tel')}
      ${field('Contact email','benefitsContactEmail',q.benefitsContactEmail,'email')}
    </div></div>

    <div class="quickEditGroup"><h3>🏥 Other Healthcare</h3>

      <div class="healthcareEditGroup">
        <div class="healthcareEditGroupHead"><span>💊</span><div><strong>Pharmacy</strong><small>Keep all pharmacy information together.</small></div></div>
        <div class="formGrid">
          ${field('Pharmacy name','pharmacy',q.pharmacy)}
          ${field('Pharmacy phone','pharmacyPhone',q.pharmacyPhone,'tel')}
          ${field('Pharmacy address','pharmacyAddress',q.pharmacyAddress)}
        </div>
      </div>

      <div class="healthcareEditGroup additionalProvidersEditor">
        <div class="toolbar providerEditorToolbar">
          <div class="healthcareEditGroupHead"><span>🩻</span><div><strong>Additional Healthcare Professionals</strong><small>Add specialists and other providers as separate cards.</small></div></div>
          <button class="btn secondary" type="button" id="addOtherProvider">+ Add Provider</button>
        </div>
        <div id="otherProviderRows">
          ${(q.otherHealthcareProviders||[]).map((p,ix)=>otherProviderEditRow(p,ix)).join('')}
        </div>
      </div>

      ${area('Important notes','importantNotes',q.importantNotes)}
    </div>

    <button class="btn primary wide quickInfoSaveBtn">Save Quick Reference</button>
   </form>
  </div>
 </div>
 `,'Quick Info','Your claim, treatment and contact information at a glance.');
}

function printQuickInfoSheet(){
 const q={...defaults.quickInfo,...(state.quickInfo||{})};
 const row=(label,value)=>value?`<div class="qiPrintRow"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`:'';
 const section=(title,body)=>body.replace(/\s/g,'')?`<section><h2>${title}</h2>${body}</section>`:'';
 const win=window.open('','_blank');
 if(!win){alert('Please allow pop-ups to print the information sheet.');return;}
 const html=`<!doctype html><html><head><title>MVA Quick Reference v${APP_VERSION}</title><style>
 @page{size:letter;margin:.45in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#15283f;margin:0;font-size:10.5pt}header{border-bottom:3px solid #0b63ce;padding-bottom:12px;margin-bottom:16px}h1{margin:0;font-size:22pt;color:#0b315f}header p{margin:4px 0 0;color:#64758a}h2{font-size:13pt;color:#0b315f;margin:0 0 8px;border-bottom:1px solid #d9e2ec;padding-bottom:4px}section{break-inside:avoid;margin:0 0 15px}.qiGrid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}.qiPrintRow{display:grid;grid-template-columns:145px 1fr;gap:8px;padding:4px 0;border-bottom:1px dotted #dbe2ea}.qiPrintRow span{color:#68788b}.notes{white-space:pre-wrap;line-height:1.45}footer{margin-top:18px;border-top:1px solid #d9e2ec;padding-top:7px;color:#7b8795;font-size:8.5pt}@media print{button{display:none}}
 </style></head><body><header><h1>MVA Quick Reference</h1><p>${esc(state.profile.name||'Claimant')} · Generated ${new Date().toLocaleDateString('en-CA')} · App v${APP_VERSION}</p></header>
 <div class="qiGrid">
 ${section('Accident & Claim',row('Accident date',fmt(state.profile.accidentDate))+row('Insurance company',q.insurer)+row('Policy number',q.policyNumber)+row('Claim number',state.profile.claimNumber)+row('Adjuster',q.adjusterName)+row('Adjuster phone',q.adjusterPhone)+row('Adjuster email',q.adjusterEmail))}
 ${section('Family Doctor',row('Doctor',q.familyDoctor)+row('Doctor phone',q.familyDoctorPhone)+row('Doctor email',q.familyDoctorEmail)+row('Clinic name',q.clinicName)+row('Clinic address',q.clinicAddress))}
 ${(q.otherHealthcareProviders||[]).map((p,ix)=>section(
   p.specialty?`${esc(p.specialty)} — ${esc(p.name||`Provider ${ix+1}`)}`:`Additional Healthcare Provider ${ix+1}`,
   row('Provider',p.name)+
   row('Specialty',p.specialty)+
   row('Clinic / hospital',p.clinic)+
   row('Phone',p.phone)+
   row('Email',p.email)+
   row('Address',p.address)
 )).join('')}
 ${section('Physiotherapy',row('Clinic',q.physioClinic)+row('Physiotherapist',q.physiotherapist)+row('Phone',q.physioPhone)+row('Email',q.physioEmail)+row('Address',q.physioAddress)+row('Usual schedule',q.physioSchedule))}
 ${section('Lawyer',row('Lawyer',state.profile.lawyer)+row('Firm',q.lawyerFirm)+row('Assistant / contact',q.lawyerAssistant)+row('Phone',q.lawyerPhone)+row('Email',q.lawyerEmail)+row('File number',q.lawyerFileNumber)+row('Address',q.lawyerAddress))}
 ${section('Green Shield',row('Primary plan name',q.greenShieldPlanName)+row('Primary plan number',q.greenShieldPlanNumber)+row('Secondary plan name',q.greenShieldSecondaryPlanName)+row('Secondary plan number',q.greenShieldSecondaryPlanNumber))}
 ${section('Work & Benefits',row('Employer',q.employer)+row('Benefits provider',q.benefitsProvider)+row('Group plan number',q.benefitsGroupPlanNumber)+row('Employee ID number',q.employeeIdNumber)+row('Portfolio ID',q.portfolioId)+row('Contact person',q.benefitsContactName)+row('Contact phone',q.benefitsContactPhone)+row('Contact email',q.benefitsContactEmail))}
 ${section('Pharmacy',row('Pharmacy name',q.pharmacy)+row('Pharmacy phone',q.pharmacyPhone)+row('Pharmacy address',q.pharmacyAddress))}
 </div>
 ${q.importantNotes?`<section><h2>Important Notes</h2><div class="notes">${esc(q.importantNotes)}</div></section>`:''}
 <footer>Private recovery information · MVA Record Keeper</footer><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`;
 win.document.write(html);win.document.close();
}

function settings(){
 const rs={...defaults.reportSettings,...(state.reportSettings||{})};
 return appShell(`<div class="grid grid2 settingsGrid">
 <section class="card"><div class="settingsIcon">📱</div><h2>App</h2><p>Share the MVA Record Keeper so it can be opened on another phone, tablet or computer.</p><button class="btn primary wide" id="shareAppBtn">Share App</button><div class="small muted shareUrl">mva-record-keeper.vercel.app</div><hr class="settingsDivider"><h3>About</h3><div class="summaryBox"><strong>MVA Record Keeper</strong><br><span class="small">Recovery records, medication tracking and claim documentation.</span><br><span class="small muted">App version ${APP_VERSION}</span></div></section>
 <section class="card"><div class="settingsIcon">👤</div><h2>Claim information</h2><form id="profileForm" class="formGrid">
 ${field('Name','name',state.profile.name)}${field('Accident date','accidentDate',state.profile.accidentDate,'date')}
 ${field('Lawyer','lawyer',state.profile.lawyer)}${field('Claim number','claimNumber',state.profile.claimNumber)}
 <button class="btn primary span2">Save information</button></form></section>
 <section class="card"><div class="settingsIcon">💾</div><h2>Data</h2><p>Records are stored on this device. Images and PDFs use expanded attachment storage (IndexedDB). Download a backup regularly; it includes both your records and attachments.</p><div class="grid"><button class="btn secondary" id="backupBtn">Download backup</button><label class="btn secondary" style="text-align:center">Restore backup<input id="restoreInput" type="file" accept="application/json" hidden></label></div><p class="small muted">Use Restore Backup to move your records to another device after opening the shared app link.</p></section>
 <section class="card"><div class="settingsIcon">📄</div><h2>Report options</h2><p>Choose what is included when you generate the lawyer report.</p><div class="settingsOptions">
 <label class="settingCheck"><input type="checkbox" id="reportIncludePhotos" ${rs.includePhotos?'checked':''}><span><strong>Include photos</strong><small>Journal and receipt photos will appear in the report.</small></span></label>
 <label class="settingCheck"><input type="checkbox" id="reportIncludeMedicationHistory" ${rs.includeMedicationHistory?'checked':''}><span><strong>Include detailed medication history</strong><small>Includes individual taken and missed dose records.</small></span></label>
 <label class="settingCheck"><input type="checkbox" id="reportAutoPrint" ${rs.autoPrint?'checked':''}><span><strong>Open print window automatically</strong><small>Immediately opens Print / Save as PDF after generating.</small></span></label>
 </div></section>
 <section class="card dangerZone span2"><div class="settingsIcon">⚠️</div><h2>Danger Zone</h2><p>Erasing app data permanently removes every record stored on this device. Download a backup first.</p><button class="btn danger" id="resetBtn">Erase all app data</button></section>
 </div>`,'Settings','Manage the app, reports and your stored records.');
}
function more(){
 return appShell(`<div class="grid grid2">${[
 ['quickinfo','📇','Quick Info'],['physio','🧘','Physiotherapy'],['receipts','🧾','Receipts'],['missedActivities','🎟️','Missed Activities'],['appointments','🩺','Appointments'],['timeline','🕒','Recovery Timeline'],['tasks','✅','Tasks & Paperwork'],['notes','📝','Notes & Questions'],['reports','📄','Reports'],['settings','⚙️','Settings']
 ].map(i=>`<button class="card" data-nav="${i[0]}" style="text-align:left;border:1px solid #dde5ef"><div style="font-size:28px">${i[1]}</div><h3>${i[2]}</h3></button>`).join('')}</div>`,'More','All additional tools and records.');
}

function field(label,name,value='',type='text',extra=''){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}
function area(label,name,value='',span=true){return `<div class="field ${span?'span2':''}"><label>${label}</label><textarea name="${name}">${esc(value)}</textarea></div>`}
function selectField(label,name,options,value){return `<div class="field"><label>${label}</label><select name="${name}">${options.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`}

function openForm(type,id){
 const newInjuryId=type==='injuryLog'&&String(id||'').startsWith('new:')?String(id).slice(4):'';
 const newExerciseId=type==='physioExerciseLog'&&String(id||'').startsWith('new:')?String(id).slice(4):'';
 const newDoseDate=type==='dose'&&String(id||'').startsWith('newday:')?String(id).slice(7):'';
 const rebookId=(type==='appointment'||type==='physioVisit')&&String(id||'').startsWith('rebook:')?String(id).slice(7):'';
 if(newInjuryId||newExerciseId||newDoseDate||rebookId)id='';
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',dose:'doses',receipt:'receipts',appointment:'appointments',missedActivity:'missedActivities',physioPrescription:'physioPrescriptions',physioVisit:'physioVisits',physioExercise:'physioExercises',physioExerciseLog:'physioExerciseLogs',physioDocument:'physioDocuments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 const arr=state[map[type]]||[];
 let item=id?arr.find(x=>x.id===id):{};
 if(rebookId){
   const source=arr.find(x=>x.id===rebookId)||{};
   item={...source,id:'',date:'',time:'',status:'Scheduled'};
   if(type==='appointment'){
     delete item.physioVisitId;
     item.visitSummary='';item.testsOrdered='';item.followUp='';
     item.discussionNotes='';item.actionItems='';item.notes='';
   }
   if(type==='physioVisit'){
     delete item.appointmentId;
     item.treatments='';item.exercisesSuggested='';item.restrictions='';item.notes='';item.photos=[];
   }
 }
 const titles={physioPrescription:'Physio Prescription / Referral',physioVisit:'Physio Visit',physioExercise:'Home Exercise',physioExerciseLog:'Exercise Completion',physioDocument:'Physio Document / Photo'};
 let body='', title=rebookId?`Rebook ${type==='physioVisit'?'Physio Visit':'Appointment'}`:(type==='injuryLog'?'Update Injury':(type==='dose'&&!id?'Add Medication Record':(titles[type]?`${id?'Edit':'Add'} ${titles[type]}`:(id?'Edit ':'Add ')+type[0].toUpperCase()+type.slice(1))));
 if(type==='journal') body=`${field('Date','date',item.date||today(),'date')}${area('How was your day?','notes',item.notes||'')}${photoField('Photo or PDF (optional)','photos',item.photos||[],true)}`;
 if(type==='injury') body=`${field('Injury name','name',item.name||'')}${field('Short description (optional)','description',item.description||'')}${selectField('Status','active',['Active','Archived'],item.active===false?'Archived':'Active')}<div class="field span2"><label>Daily tracking fields</label><p class="small muted trackingHelp">Enable only the details that make sense for this injury. Enabled fields will appear in every Daily Log.</p><div class="trackingToggles"><label class="trackingToggle"><input type="checkbox" name="trackSwelling" ${item.trackSwelling?'checked':''}><span>Swelling</span></label><label class="trackingToggle"><input type="checkbox" name="trackStiffness" ${item.trackStiffness?'checked':''}><span>Stiffness</span></label><label class="trackingToggle"><input type="checkbox" name="trackRangeOfMotion" ${item.trackRangeOfMotion?'checked':''}><span>Range of motion</span></label></div></div>`;
 if(type==='injuryLog'){const injuryId=item.injuryId||newInjuryId; const injury=state.injuries.find(x=>x.id===injuryId); body=`<div class="field span2 summaryBox"><strong>${esc(injury?.name||'Injury')}</strong><div class="small muted">Update only what you want to record today.</div></div>${field('Date','date',item.date||today(),'date')}${field('Pain level (0-10)','pain',item.pain??0,'number','min="0" max="10"')}${selectField('Compared with last update','change',['Better','Same','Worse','Not sure'],item.change||'Same')}${area('Notes (optional)','notes',item.notes||'')}${photoField('Photo or PDF (optional)','photos',item.photos||[],true)}<input type="hidden" name="injuryId" value="${esc(injuryId)}">`; }
 if(type==='medication') body=`${field('Medication name','name',item.name||'')}${field('Dose','dose',item.dose||'')}${selectField('Frequency','frequency',['Every 4 hours','Every 6 hours','Every 8 hours','Every 12 hours','Once daily','Twice daily','Three times daily','Four times daily','As needed (PRN)'],item.frequency||item.schedule||'Every 8 hours')}${field('First dose time','firstDoseTime',item.firstDoseTime||parseClockTime(item.usualTimes||''),'time')}${selectField('Status','status',['Active','Completed'],item.active===false?'Completed':'Active')}${field('Completed date','completedDate',item.completedDate||today(),'date')}${area('Reason completed (optional)','completedReason',item.completedReason||'')}${area('Instructions or notes','notes',item.notes||'')}`;
 if(type==='dose'){
   const med=state.medications.find(m=>m.id===item.medicationId);
   const availableMeds=[...(state.medications||[])];
   const selectedMed=med||availableMeds.find(m=>m.active!==false)||availableMeds[0];
   const isNew=!id;
   const medicationPicker=isNew
     ? `<div class="field span2"><label>Medication</label><select name="medicationId" data-dose-medication-select>${availableMeds.length?availableMeds.map(m=>`<option value="${esc(m.id)}" ${m.id===selectedMed?.id?'selected':''}>${esc(m.name)}${m.active===false?' (Completed)':''}</option>`).join(''):'<option value="">No medications available</option>'}</select></div>`
     : `<div class="field span2 summaryBox"><strong>${esc(item.medicationNameSnapshot||med?.name||'Medication')}</strong><div class="small muted">Correct this history record without changing other entries.</div></div>`;
   body=`${medicationPicker}${field('Date','doseDate',item.dateTime?localDateKey(item.dateTime):(newDoseDate||today()),'date')}${field('Time','doseTime',item.dateTime?localDateTimeValue(new Date(item.dateTime)).slice(11,16):localDateTimeValue().slice(11,16),'time')}${selectField('Status','status',['Taken','Missed'],item.status||'Taken')}${field('Dose at that time','doseSnapshot',item.doseSnapshot||selectedMed?.dose||'')}${field('Frequency at that time','frequencySnapshot',item.frequencySnapshot||selectedMed?.frequency||selectedMed?.schedule||'')}${area('Note (optional)','note',item.note||'')}${isNew?'':`<input type="hidden" name="medicationId" value="${esc(item.medicationId||'')}">`}<input type="hidden" name="medicationNameSnapshot" value="${esc(item.medicationNameSnapshot||selectedMed?.name||'Medication')}">`;
 }
 if(type==='receipt') body=`${field('Date','date',item.date||today(),'date')}${field('Amount','amount',item.amount||'','number','step="0.01" min="0"')}${field('Description','description',item.description||'')}${selectField('Category','category',['Pharmacy','Physiotherapy','Parking','Mileage','Medical supplies','Legal','Other'],item.category||'Other')}${area('Notes','notes',item.notes||'')}${photoField('Receipt image or PDF','photo',item.photo?[item.photo]:[],false)}`;
 if(type==='appointment'){
   const kind=item.appointmentKind||((item.type||'').toLowerCase().includes('insurance')?'Insurance':'Medical');
   body=`${selectField('Appointment type','appointmentKind',['Medical','Insurance'],kind)}
   ${field('Date','date',rebookId?'':(item.date||today()),'date')}
   ${field('Time','time',rebookId?'':(item.time||''),'time')}
   ${selectField('Status','status',['Scheduled','Completed','Cancelled'],item.status||'Scheduled')}
   <div class="${kind==='Medical'?'':'hidden'}" data-appointment-fields="Medical">
     ${field('Provider name','provider',item.provider||'')}
     ${field('Professional type','professionalType',item.professionalType||'','text','placeholder="Example: Orthopedic surgeon or physiotherapist"')}
     ${field('Clinic or hospital','location',item.location||'')}
     ${field('Reason for visit','reason',item.reason||'')}
     ${area('Visit summary','visitSummary',item.visitSummary||item.notes||'')}
     ${area('Tests ordered','testsOrdered',item.testsOrdered||'')}
     ${area('Follow-up required','followUp',item.followUp||'')}
   </div>
   <div class="${kind==='Insurance'?'':'hidden'}" data-appointment-fields="Insurance">
     ${field('Insurance company','insuranceCompany',item.insuranceCompany||'')}
     ${field('Person spoken with','contactName',item.contactName||'')}
     ${selectField('Contact method','contactMethod',['Phone','Email','Virtual meeting','In person'],item.contactMethod||'Phone')}
     ${field('Claim number','claimNumber',item.claimNumber||'')}
     ${area('Discussion notes','discussionNotes',item.discussionNotes||item.notes||'')}
     ${area('Action items','actionItems',item.actionItems||'')}
     ${area('Follow-up required','followUpInsurance',item.followUp||'')}
   </div>`;
 }
 if(type==='missedActivity') body=`${field('Date','date',item.date||today(),'date')}${field('Activity / event','title',item.title||'','text','placeholder="Example: Concert"')}${field('Location / venue','location',item.location||'')}${field('Amount lost ($)','amountLost',item.amountLost||'','number','min="0" step="0.01" placeholder="0.00"')}${field('Who was going with you?','withWhom',item.withWhom||'')}${area('Why you missed it','reason',item.reason||'')}${area('How this affected you','impact',item.impact||'')}${area('Notes','notes',item.notes||'')}${photoField('Tickets, receipts, screenshots or PDFs','photos',item.photos||[],true)}`;
 if(type==='physioPrescription') body=`${field('Date prescribed','date',item.date||today(),'date')}${field('Title','title',item.title||'Physiotherapy prescription')}${physioProviderSelect(item.prescribedBy||'')}${area('Injury / condition being treated','treatmentFor',item.treatmentFor||'')}${field('Frequency ordered','frequency',item.frequency||'','text','placeholder="Example: 2 times per week"')}${field('Duration ordered','duration',item.duration||'','text','placeholder="Example: 6 weeks"')}${selectField('Status','status',['Active','Completed'],item.status||'Active')}${area('Special instructions','instructions',item.instructions||'')}${photoField('Prescription / referral image or PDF','photos',item.photos||[],true)}`;
 if(type==='physioVisit') body=`${field('Date','date',rebookId?'':(item.date||today()),'date')}${field('Time','time',rebookId?'':(item.time||''),'time')}${selectField('Status','status',['Scheduled','Completed','Cancelled'],rebookId?'Scheduled':(item.status||'Completed'))}${field('Physiotherapist','therapist',item.therapist||state.quickInfo.physiotherapist||'')}${field('Clinic','clinic',item.clinic||state.quickInfo.physioClinic||'')}${field('What was the visit focused on?','focus',item.focus||'')}${area('Treatment / what was done','treatments',item.treatments||'')}${area('Exercises or suggestions from physio','exercisesSuggested',item.exercisesSuggested||'')}${area('Restrictions / precautions','restrictions',item.restrictions||'')}${area('Visit notes','notes',item.notes||'')}${photoField('Handouts, photos or PDFs from this visit','photos',item.photos||[],true)}`;
 if(type==='physioExercise') body=`${field('Exercise name','name',item.name||'')}${field('Prescribed by','prescribedBy',item.prescribedBy||state.quickInfo.physiotherapist||'')}${field('Start date','startDate',item.startDate||today(),'date')}${field('Sets','sets',item.sets||'')}${field('Reps','reps',item.reps||'')}${field('Hold time','holdTime',item.holdTime||'','text','placeholder="Example: 10 seconds"')}${field('Times per day','timesPerDay',item.timesPerDay||exerciseTimesPerDay(item)||'','number','min="1" max="24" step="1" placeholder="Example: 3"')}${field('Exercise link / video URL','exerciseUrl',item.exerciseUrl||'','url','placeholder="https://..."')}${selectField('Status','status',['Active','Completed'],item.active===false?'Completed':'Active')}<div class="field span2"><label>Exercise thumbnail image</label><input type="file" name="thumbnail" accept="image/*"><div class="attachmentHint">Choose an image from your gallery. The app will automatically make a small copy for the exercise card.</div><div class="thumbnailSaveStatus" data-thumbnail-status></div>${item.thumbnail?`<div class="exerciseThumbnailPreview"><img src="${attachmentSrc(item.thumbnail)}" alt="Current exercise thumbnail"><span>Current thumbnail</span></div>`:''}</div>${area('Instructions / technique','instructions',item.instructions||'')}${photoField('Exercise sheet, photo or PDF','photos',item.photos||[],true)}`;
 if(type==='physioExerciseLog'){const exerciseId=item.exerciseId||newExerciseId;const exercise=state.physioExercises.find(e=>e.id===exerciseId);body=`<div class="field span2 summaryBox"><strong>${esc(exercise?.name||'Home exercise')}</strong><div class="small muted">Add or correct a completion record.</div></div>${field('Date','exerciseDate',item.dateTime?localDateKey(item.dateTime):today(),'date')}${field('Time','exerciseTime',item.dateTime?localDateTimeValue(new Date(item.dateTime)).slice(11,16):localDateTimeValue().slice(11,16),'time')}${selectField('Status','status',['Done','Unable'],item.status||'Done')}${area('Note (optional)','note',item.note||'')}<input type="hidden" name="exerciseId" value="${esc(exerciseId||'')}">`; }
 if(type==='physioDocument') body=`${field('Date','date',item.date||today(),'date')}${field('Document title','title',item.title||'')}${selectField('Type','category',['Exercise sheet','Prescription / Script','Referral','Specialist instructions','Physio handout','Other'],item.category||'Other')}${field('Given by / source','source',item.source||'')}${area('Notes','notes',item.notes||'')}${photoField('Document images or PDFs','photos',item.photos||[],true)}`;

 if(type==='timeline') body=`${field('Date','date',item.date||today(),'date')}${field('Event title','title',item.title||'')}${selectField('Event type','type',['Accident','Hospital / ER','Doctor','Imaging','Physiotherapy','Insurance','Lawyer','Medication','Other'],item.type||'Other')}${area('Details','notes',item.notes||'')}`;
 if(type==='task') body=`${field('Task','title',item.title||'')}${field('Due date','due',item.due||'','date')}${selectField('Priority','priority',['Low','Normal','High'],item.priority||'Normal')}${selectField('Status','done',['Open','Completed'],item.done?'Completed':'Open')}`;
 if(type==='question') body=`${area('Question','text',item.text||'')}${selectField('For','forWhom',['Doctor','Lawyer','Insurance','Physiotherapist','Other'],item.forWhom||'Doctor')}${selectField('Status','answered',['Open','Answered'],item.answered?'Answered':'Open')}${area('Answer / notes','answer',item.answer||'')}`;
 if(type==='note') body=`${field('Date','date',item.date||today(),'date')}${field('Title','title',item.title||'')}${area('Note','text',item.text||'')}`;
 modal=`<div class="modalBackdrop"><form class="modal" id="editForm" data-type="${type}" data-id="${id||''}"><div class="modalHead"><h2>${title}</h2><button type="button" class="iconBtn" data-close>✕</button></div><div class="formGrid">${body}</div><div class="modalFoot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn primary">Save</button></div></form></div>`;
 render();
}
function photoField(label,name,photos,multiple){return `<div class="field span2"><label>${label}</label><input type="file" name="${name}" accept="image/*,application/pdf" ${multiple?'multiple':''}><div class="attachmentHint">Choose a photo from your gallery, take a new photo, or select a PDF.</div><div class="photoGrid" style="margin-top:8px">${photos.map((p,ix)=>attachmentPreview(p,{label:`${label} ${ix+1}`})).join('')}</div></div>`}

function isPdfAttachment(value=''){return String(attachmentSrc(value)||'').startsWith('data:application/pdf')}
function attachmentPreview(value,opts={}){
 const remove=opts.remove||'', label=opts.label||'Attachment',src=attachmentSrc(value);
 if(!src)return `<div class="attachmentWrap missingAttachment"><span>Attachment unavailable</span>${remove}</div>`;
 if(isPdfAttachment(value)){
   return `<div class="attachmentWrap pdfAttachment"><a class="pdfAttachmentLink" href="${src}" target="_blank" rel="noopener"><span class="pdfAttachmentIcon">PDF</span><span>${esc(label)}</span><small>Tap to open</small></a>${remove}</div>`;
 }
 return `<div class="attachmentWrap imageAttachment"><img class="photo" src="${src}" alt="${esc(label)}">${remove}</div>`;
}
async function filesToData(input){return Promise.all([...input.files].map(f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)})))}
async function fileToData(file){
 return new Promise((resolve,reject)=>{
   const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Could not read file.'));r.readAsDataURL(file);
 });
}
async function filesToAttachmentRefs(input){
 const refs=[];
 for(const file of [...(input?.files||[])]){
   const data=await fileToData(file);
   refs.push(await putAttachmentData(data));
 }
 return refs;
}

async function imageFileToThumbnail(file,maxSize=240){
 return new Promise((resolve,reject)=>{
   if(!file||!String(file.type||'').startsWith('image/')){reject(new Error('Choose an image file for the thumbnail.'));return}
   const reader=new FileReader();
   reader.onerror=()=>reject(reader.error||new Error('Could not read image.'));
   reader.onload=()=>{
     const img=new Image();
     img.onerror=()=>reject(new Error('Could not load image.'));
     img.onload=()=>{
       const scale=Math.min(1,maxSize/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
       const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
       const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
       const canvas=document.createElement('canvas');
       canvas.width=w;canvas.height=h;
       const ctx=canvas.getContext('2d');
       ctx.drawImage(img,0,0,w,h);
       resolve(canvas.toDataURL('image/jpeg',0.78));
     };
     img.src=reader.result;
   };
   reader.readAsDataURL(file);
 });
}


async function saveForm(form){
 const type=form.dataset.type,id=form.dataset.id, fd=new FormData(form);
 const obj=Object.fromEntries(fd.entries()); obj.id=id||uid();
 if(type==='appointment'){
   const existingAppointment=state.appointments.find(x=>x.id===id);
   if(existingAppointment?.physioVisitId)obj.physioVisitId=existingAppointment.physioVisitId;
   obj.appointmentKind=obj.appointmentKind||'Medical';
   if(obj.appointmentKind==='Insurance'){
     obj.followUp=obj.followUpInsurance||'';
     obj.notes=obj.discussionNotes||'';
     obj.type='Insurance';
   }else{
     obj.notes=obj.visitSummary||'';
     obj.type='Medical';
   }
   delete obj.followUpInsurance;
   if(obj.physioVisitId){
     const visit=state.physioVisits.find(v=>v.id===obj.physioVisitId);
     if(visit){
       visit.date=obj.date;visit.time=obj.time;visit.status=obj.status;
       visit.therapist=obj.provider||visit.therapist;
       visit.clinic=obj.location||visit.clinic;
       visit.focus=obj.reason||visit.focus;
       visit.notes=obj.visitSummary||obj.notes||visit.notes;
       visit.restrictions=obj.followUp||visit.restrictions;
     }
   }
 }
 if(type==='journal'){const existing=state.journal.find(x=>x.id===id);obj.photos=existing?.photos||[];const inp=form.elements.photos;if(inp.files.length)obj.photos=await filesToAttachmentRefs(inp)}
 if(type==='injury'){
   obj.active=obj.active==='Active';
   obj.trackSwelling=fd.has('trackSwelling');
   obj.trackStiffness=fd.has('trackStiffness');
   obj.trackRangeOfMotion=fd.has('trackRangeOfMotion');
 }
 if(type==='injuryLog'){obj.pain=Math.max(0,Math.min(10,Number(obj.pain||0)));const existing=state.injuryLogs.find(x=>x.id===id);obj.photos=existing?.photos||[];const inp=form.elements.photos;if(inp.files.length)obj.photos=await filesToAttachmentRefs(inp)}
 if(type==='receipt'){obj.amount=Number(obj.amount);const existing=state.receipts.find(x=>x.id===id);obj.photo=existing?.photo||'';const inp=form.elements.photo;if(inp.files.length)obj.photo=(await filesToAttachmentRefs(inp))[0]}
 if(type==='medication'){
   const existing=state.medications.find(x=>x.id===id);
   obj.active=obj.status==='Active';obj.schedule=obj.frequency||'';
   if(obj.active){obj.completedDate='';obj.completedReason=''}
   const eventTime=new Date().toISOString();
   if(!existing){state.medicationEvents.push({id:uid(),medicationId:obj.id,eventType:'Created',dateTime:eventTime})}
   else{
     [['Dose','dose'],['Frequency','frequency']].forEach(([label,key])=>{if(String(existing[key]||existing.schedule||'')!==String(obj[key]||''))state.medicationEvents.push({id:uid(),medicationId:obj.id,eventType:'Changed',field:label,from:existing[key]||existing.schedule||'',to:obj[key]||'',dateTime:eventTime})});
     if(existing.active!==false&&obj.active===false)state.medicationEvents.push({id:uid(),medicationId:obj.id,eventType:'Completed',dateTime:eventTime,reason:obj.completedReason||''});
     if(existing.active===false&&obj.active!==false)state.medicationEvents.push({id:uid(),medicationId:obj.id,eventType:'Reactivated',dateTime:eventTime});
   }
 }
 if(type==='dose'){
   const selectedMedication=state.medications.find(m=>m.id===obj.medicationId);
   if(!obj.medicationId||!selectedMedication){alert('Choose a medication.');return}
   if(!id){
     obj.medicationNameSnapshot=selectedMedication.name||'Medication';
     if(!obj.doseSnapshot)obj.doseSnapshot=selectedMedication.dose||'';
     if(!obj.frequencySnapshot)obj.frequencySnapshot=selectedMedication.frequency||selectedMedication.schedule||'';
   }
   const local=new Date(`${obj.doseDate}T${obj.doseTime}`);
   if(Number.isNaN(local.getTime())){alert('Choose a valid date and time.');return}
   obj.dateTime=local.toISOString();delete obj.doseDate;delete obj.doseTime;obj.legacySnapshot=false;
 }
 if(type==='physioPrescription'){
   const existing=state.physioPrescriptions.find(x=>x.id===id);
   obj.photos=existing?.photos||[];
   const inp=form.elements.photos;if(inp?.files?.length)obj.photos.push(...await filesToAttachmentRefs(inp));
   obj.active=obj.status==='Active';
 }
 if(type==='physioVisit'){
   const existing=state.physioVisits.find(x=>x.id===id);
   obj.photos=existing?.photos||[];
   const inp=form.elements.photos;if(inp?.files?.length)obj.photos.push(...await filesToAttachmentRefs(inp));
   obj.appointmentId=existing?.appointmentId||uid();
   const appt={
     id:obj.appointmentId,
     physioVisitId:obj.id,
     appointmentKind:'Medical',type:'Medical',
     date:obj.date,time:obj.time,status:obj.status,
     provider:obj.therapist||state.quickInfo.physiotherapist||'Physiotherapist',
     professionalType:'Physiotherapist',
     location:obj.clinic||state.quickInfo.physioClinic||'',
     reason:obj.focus||'Physiotherapy',
     visitSummary:[obj.treatments,obj.exercisesSuggested,obj.notes].filter(Boolean).join('\\n\\n'),
     notes:[obj.treatments,obj.exercisesSuggested,obj.notes].filter(Boolean).join('\\n\\n'),
     testsOrdered:'',followUp:obj.restrictions||''
   };
   const ai=state.appointments.findIndex(a=>a.id===appt.id);
   if(ai>=0)state.appointments[ai]={...state.appointments[ai],...appt};else state.appointments.push(appt);
 }
 if(type==='missedActivity'){
   const existing=state.missedActivities.find(x=>x.id===id);
   obj.photos=existing?.photos||[];
   const inp=form.elements.photos;
   if(inp?.files?.length)obj.photos.push(...await filesToAttachmentRefs(inp));
   obj.amountLost=Number(obj.amountLost||0);
 }
 if(type==='physioExercise'){
   const existing=state.physioExercises.find(x=>x.id===id);
   obj.photos=existing?.photos||[];
   const inp=form.elements.photos;if(inp?.files?.length)obj.photos.push(...await filesToAttachmentRefs(inp));
   obj.thumbnail=existing?.thumbnail||'';
   const thumbInput=form.elements.thumbnail;
   if(thumbInput?.files?.length){
     try{
       obj.thumbnail=await putAttachmentData(await imageFileToThumbnail(thumbInput.files[0]));
     }catch(err){
       alert(err?.message||'The exercise thumbnail could not be saved.');
       return;
     }
   }
   obj.active=obj.status==='Active';
   obj.timesPerDay=Math.max(0,Math.round(Number(obj.timesPerDay||0)));
   if(obj.timesPerDay)obj.frequency=`${obj.timesPerDay} times daily`;
 }
 if(type==='physioExerciseLog'){
   const local=new Date(`${obj.exerciseDate}T${obj.exerciseTime}`);
   if(Number.isNaN(local.getTime())){alert('Choose a valid date and time.');return}
   obj.dateTime=local.toISOString();delete obj.exerciseDate;delete obj.exerciseTime;
 }
 if(type==='physioDocument'){
   const existing=state.physioDocuments.find(x=>x.id===id);
   obj.photos=existing?.photos||[];
   const inp=form.elements.photos;if(inp?.files?.length)obj.photos.push(...await filesToAttachmentRefs(inp));
 }

 if(type==='task') obj.done=obj.done==='Completed';
 if(type==='question') obj.answered=obj.answered==='Answered';
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',dose:'doses',receipt:'receipts',appointment:'appointments',missedActivity:'missedActivities',physioPrescription:'physioPrescriptions',physioVisit:'physioVisits',physioExercise:'physioExercises',physioExerciseLog:'physioExerciseLogs',physioDocument:'physioDocuments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 const arr=state[map[type]];
 if(!arr){alert('This record type could not be saved.');return}
 const ix=arr.findIndex(x=>x.id===id); if(ix>=0)arr[ix]=obj;else arr.push(obj);
 save(); modal=null; render(); toast('Saved');
}

function del(type,id){
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',receipt:'receipts',appointment:'appointments',missedActivity:'missedActivities',physioPrescription:'physioPrescriptions',physioVisit:'physioVisits',physioExercise:'physioExercises',physioExerciseLog:'physioExerciseLogs',physioDocument:'physioDocuments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 if(!confirm('Delete this item?'))return;
 if(type==='journal'){const entry=state.journal.find(x=>x.id===id);if(entry)state.injuryLogs=state.injuryLogs.filter(x=>x.date!==entry.date)}
 if(type==='physioVisit'){const visit=state.physioVisits.find(v=>v.id===id);if(visit?.appointmentId)state.appointments=state.appointments.filter(a=>a.id!==visit.appointmentId)}
 state[map[type]]=state[map[type]].filter(x=>x.id!==id);
 if(type==='injury')state.injuryLogs=state.injuryLogs.filter(x=>x.injuryId!==id);
 if(type==='medication')state.doses=state.doses.filter(d=>d.medicationId!==id);
 if(type==='physioExercise')state.physioExerciseLogs=state.physioExerciseLogs.filter(l=>l.exerciseId!==id);
 save();render();
}

function medicationFrequencyHistoryHtml(medication){
 const records=[...(state.doses||[])]
   .filter(d=>d.medicationId===medication.id&&d.dateTime&&(d.frequencySnapshot||medication.frequency||medication.schedule))
   .sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));
 if(!records.length){
   const current=medication.frequency||medication.schedule||'Frequency not entered';
   return `<div class="frequencyTimeline"><div><strong>Current frequency:</strong> ${esc(current)}</div></div>`;
 }
 const periods=[];
 records.forEach(record=>{
   const frequency=String(record.frequencySnapshot||medication.frequency||medication.schedule||'Frequency not entered').trim();
   const date=localDateKey(record.dateTime);
   const last=periods[periods.length-1];
   if(last&&last.frequency===frequency){last.endDate=date;last.count+=1}
   else periods.push({frequency,startDate:date,endDate:date,count:1});
 });
 return `<div class="frequencyTimeline"><strong>Frequency history</strong>${periods.map(period=>{
   const dateLabel=period.startDate===period.endDate?fmt(period.startDate):`${fmt(period.startDate)} – ${fmt(period.endDate)}`;
   return `<div class="frequencyPeriod"><span>${dateLabel}</span><b>${esc(period.frequency)}</b></div>`;
 }).join('')}</div>`;
}

function reportPreset(type){
 const all={journal:true,injuries:true,medications:true,doseHistory:true,appointments:true,receipts:true,timeline:true,notes:true,photos:true};
 if(type==='medical')return {type,title:'Medical Recovery Report',journal:true,injuries:true,medications:true,doseHistory:true,appointments:true,receipts:false,timeline:true,notes:false,photos:false};
 if(type==='insurance')return {type,title:'Insurance Recovery Report',journal:false,injuries:false,medications:false,doseHistory:false,appointments:true,receipts:true,timeline:true,notes:true,photos:true};
 return {type:'legal',title:'Full MVA Claim Report',...all};
}
function customReportConfig(){
 const config={type:'custom',title:'Custom MVA Recovery Report',from:document.getElementById('reportFrom')?.value||'',to:document.getElementById('reportTo')?.value||''};
 document.querySelectorAll('[data-report-option]').forEach(input=>config[input.dataset.reportOption]=input.checked);
 return config;
}
function reportInRange(date,config){
 if(!date)return true;
 const key=String(date).slice(0,10);
 return (!config.from||key>=config.from)&&(!config.to||key<=config.to);
}
function reportPreviewHtml(config){
 const journal=state.journal.filter(x=>reportInRange(x.date,config)).length;
 const appointments=state.appointments.filter(x=>reportInRange(x.date,config)).length;
 const doses=state.doses.filter(x=>reportInRange(localDateKey(x.dateTime),config)).length;
 const receipts=state.receipts.filter(x=>reportInRange(x.date,config));
 const photos=(config.photos?state.journal.filter(x=>reportInRange(x.date,config)).reduce((n,x)=>n+(x.photos||[]).length,0)+receipts.filter(x=>x.photo).length:0);
 const sections=[['journal','Daily logs'],['injuries','Injury tracking'],['medications','Medication timeline'],['doseHistory','Dose history'],['appointments','Appointments'],['receipts','Receipts'],['timeline','Recovery timeline'],['notes','Notes and questions'],['photos','Photo appendix']].filter(([key])=>config[key]).map(([,label])=>label);
 return `<div class="reportPreviewHead"><div><span class="pill">Preview</span><h3>${esc(config.title)}</h3><p>${config.from||'Beginning'} – ${config.to||'Today'}</p></div><div class="reportPreviewCount">${sections.length}<small>sections</small></div></div><div class="reportPreviewStats"><div><strong>${journal}</strong><span>Daily logs</span></div><div><strong>${appointments}</strong><span>Appointments</span></div><div><strong>${doses}</strong><span>Dose records</span></div><div><strong>${money(receipts.reduce((n,r)=>n+Number(r.amount||0),0))}</strong><span>Expenses</span></div><div><strong>${photos}</strong><span>Photos</span></div></div><div class="reportSectionList">${sections.map(x=>`<span>✓ ${x}</span>`).join('')}</div>`;
}
function medicationTimelineForReport(med,config){
 const events=(state.medicationEvents||[]).filter(e=>e.medicationId===med.id&&reportInRange(localDateKey(e.dateTime),config)).map(e=>({dateTime:e.dateTime,label:e.eventType==='Changed'?`${e.field} changed: ${e.from||'Not entered'} → ${e.to||'Not entered'}`:e.eventType+(e.reason?`: ${e.reason}`:'')}));
 const doses=(state.doses||[]).filter(d=>d.medicationId===med.id&&reportInRange(localDateKey(d.dateTime),config)).sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));
 let previous='';
 doses.forEach(d=>{const freq=d.frequencySnapshot||'';if(freq&&freq!==previous){events.push({dateTime:d.dateTime,label:`Frequency recorded as ${freq}`});previous=freq}});
 return events.sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime)).map(e=>`<div class="timelineLine"><time>${fmtDateTime(e.dateTime)}</time><span>${esc(e.label)}</span></div>`).join('')||'<p class="muted">No dated changes recorded in this range.</p>';
}
function printReport(config=reportPreset('legal')){
 const win=window.open('','_blank');
 if(!win){alert('Please allow pop-ups so the report can open.');return}
 const inRange=(date)=>reportInRange(date,config);
 const journal=state.journal.filter(x=>inRange(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const injuryLogs=state.injuryLogs.filter(x=>inRange(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const appointments=state.appointments.filter(x=>inRange(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const receipts=state.receipts.filter(x=>inRange(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const timeline=state.timeline.filter(x=>inRange(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const notes=state.notes.filter(x=>inRange(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const doses=state.doses.filter(x=>inRange(localDateKey(x.dateTime))).sort((a,b)=>a.dateTime.localeCompare(b.dateTime));
 const accidentDays=state.profile.accidentDate?daysBetween(new Date(state.profile.accidentDate+'T12:00:00'),new Date()):0;
 const total=receipts.reduce((n,r)=>n+Number(r.amount||0),0);
 const section=(id,title,body)=>`<section id="${id}" class="reportSection"><h2>${title}</h2>${body||'<p class="emptyText">None recorded in this date range.</p>'}</section>`;
 const included=[['summary','Recovery Summary',true],['timeline','Recovery Timeline',config.timeline],['journal','Daily Logs',config.journal],['injuries','Injury Progress',config.injuries],['medications','Medication Timeline',config.medications],['doses','Dose History',config.doseHistory],['appointments','Appointments',config.appointments],['receipts','Receipts and Expenses',config.receipts],['notes','Notes and Questions',config.notes],['photos','Photo Appendix',config.photos]].filter(x=>x[2]);
 const toc=included.map(([,label],i)=>`<div><span>${i+1}. ${label}</span><b>Section ${i+1}</b></div>`).join('');
 const photoItems=[];
 if(config.photos){
 journal.forEach(j=>(j.photos||[]).forEach((file,i)=>photoItems.push(isPdfAttachment(file)
   ? `<figure class="reportPdfAttachment"><a href="${attachmentSrc(file)}" target="_blank"><span>PDF</span><strong>${fmt(j.date)} — Daily log attachment ${i+1}</strong></a></figure>`
   : `<figure><img src="${attachmentSrc(file)}"><figcaption>${fmt(j.date)} — Daily log photo ${i+1}</figcaption></figure>`)));
 receipts.forEach(r=>{if(r.photo)photoItems.push(isPdfAttachment(r.photo)
   ? `<figure class="reportPdfAttachment"><a href="${attachmentSrc(r.photo)}" target="_blank"><span>PDF</span><strong>${fmt(r.date)} — ${esc(r.description||'Receipt')}</strong></a></figure>`
   : `<figure><img src="${attachmentSrc(r.photo)}"><figcaption>${fmt(r.date)} — ${esc(r.description||'Receipt')}</figcaption></figure>`)})
}
 const generatedDate=new Date().toLocaleString('en-CA');
 const reportPeriod=`${config.from?fmt(config.from):'Beginning'} – ${config.to?fmt(config.to):'Today'}`;
 const photoCount=photoItems.length;
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(config.title)}</title><style>
 @page{size:auto;margin:14mm 14mm 17mm}*{box-sizing:border-box}html{counter-reset:page}body{font-family:Arial,sans-serif;color:#1c2d40;margin:0;line-height:1.38;font-size:11.5px}.firstPage{border-top:8px solid #0b63ce;padding-top:14px;margin-bottom:18px}.reportLabel{display:inline-block;padding:4px 9px;border-radius:999px;background:#eaf3ff;color:#0b63ce;font-weight:bold;font-size:9px;letter-spacing:.08em}.firstPage h1{font-size:28px;color:#0b315f;margin:10px 0 3px;line-height:1.08}.sub{font-size:13px;color:#557086;margin-bottom:15px}.identityGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.identityGrid div,.snapshotCard,.stat{padding:10px 11px;border:1px solid #dbe4ee;border-radius:8px}.identityGrid span,.snapshotItem span,.stat span{display:block;color:#718096;font-size:8.5px;text-transform:uppercase;letter-spacing:.06em}.snapshotCard{margin-top:12px;background:#f7fbff}.snapshotCard h2{border:0!important;padding:0!important;margin:0 0 8px!important;font-size:16px!important}.snapshotGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.snapshotItem{padding:8px;background:#fff;border:1px solid #dce7f3;border-radius:7px}.snapshotItem strong{display:block;font-size:17px;color:#0b63ce;margin-bottom:1px}.toc{margin-top:12px}.toc h2,.reportSection h2{color:#0b315f;border-bottom:2px solid #0b63ce;padding-bottom:5px;margin:0 0 7px}.toc h2{font-size:16px}.tocGrid{display:grid;grid-template-columns:1fr 1fr;column-gap:20px}.toc div{display:flex;justify-content:space-between;border-bottom:1px dotted #9cadbf;padding:4px 0;font-size:10px}.reportSection{margin-top:16px;break-inside:auto}.reportSection h2{font-size:18px;break-after:avoid-page}.summaryGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.stat strong{font-size:18px;color:#0b63ce}.item{break-inside:avoid;margin:0 0 8px;padding:9px 10px;border:1px solid #dce5ef;border-radius:7px}.item p{margin:5px 0}.meta,.muted{color:#66798d}.timelineLine{display:grid;grid-template-columns:125px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid #e5ebf2;break-inside:avoid}.timelineLine time{color:#65788e}.medHeader{display:flex;justify-content:space-between;gap:10px}.badge{padding:3px 7px;border-radius:999px;background:#eaf3ff;color:#0b63ce;font-weight:bold;font-size:9px}.receiptTotal{font-size:16px;color:#0b315f;margin:5px 0 9px}.photoGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.photoGrid figure{margin:0;break-inside:avoid}.photoGrid img{width:100%;max-height:285px;object-fit:contain;border:1px solid #dbe4ee;border-radius:7px}.photoGrid figcaption{margin-top:4px;color:#65788e}.reportPdfAttachment{border:1px solid #dbe4ee;border-radius:7px;padding:16px;background:#f7f9fc;min-height:90px}.reportPdfAttachment a{text-decoration:none;color:#17324d;display:grid;gap:6px}.reportPdfAttachment span{display:inline-grid;place-items:center;width:42px;height:42px;border-radius:8px;background:#d94747;color:#fff;font-weight:bold}.printHeader,.printFooter{display:none}.printBar{position:fixed;right:16px;bottom:16px}.printBar button{padding:12px 18px;background:#0b63ce;color:white;border:0;border-radius:9px;font-weight:bold}@media print{body{padding-top:5mm;padding-bottom:7mm}.printBar{display:none}.printHeader{display:block;position:fixed;top:-9mm;left:0;right:0;border-bottom:1px solid #dbe4ee;padding-bottom:2mm;color:#66798d;font-size:8.5px}.printFooter{display:flex;position:fixed;bottom:-12mm;left:0;right:0;justify-content:space-between;border-top:1px solid #dbe4ee;padding-top:2mm;color:#66798d;font-size:8px}.pageNumber:after{counter-increment:page;content:"Page " counter(page)}.firstPage{break-after:auto}.reportSection{orphans:3;widows:3}.reportSection h2{break-after:avoid}.item,.timelineLine,.stat{break-inside:avoid}}
 </style></head><body>
 <div class="printHeader">MVA Record Keeper • ${esc(config.title)}</div><div class="printFooter"><span>${esc(state.profile.name||'MVA Record')}</span><span>Generated ${esc(generatedDate)}</span><span class="pageNumber"></span></div>
 <section class="firstPage"><span class="reportLabel">MVA RECORD KEEPER</span><h1>${esc(config.title)}</h1><div class="sub">A clear, chronological record of recovery following a motor vehicle accident</div>
 <div class="identityGrid"><div><span>Patient / claimant</span><strong>${esc(state.profile.name||'Not entered')}</strong></div><div><span>Claim number</span><strong>${esc(state.profile.claimNumber||'Not entered')}</strong></div><div><span>Accident date</span><strong>${fmt(state.profile.accidentDate)||'Not entered'}</strong></div><div><span>Reporting period</span><strong>${reportPeriod}</strong></div><div><span>Lawyer</span><strong>${esc(state.profile.lawyer||'Not entered')}</strong></div><div><span>Generated</span><strong>${esc(generatedDate)}</strong></div></div>
 <div class="snapshotCard"><h2>Recovery Snapshot</h2><div class="snapshotGrid"><div class="snapshotItem"><strong>${journal.length}</strong><span>Daily logs</span></div><div class="snapshotItem"><strong>${doses.length}</strong><span>Medication events</span></div><div class="snapshotItem"><strong>${appointments.length}</strong><span>Appointments</span></div><div class="snapshotItem"><strong>${photoCount}</strong><span>Photos</span></div><div class="snapshotItem"><strong>${receipts.length}</strong><span>Receipts</span></div><div class="snapshotItem"><strong>${state.injuries.length}</strong><span>Injuries tracked</span></div></div></div>
 <section class="toc"><h2>Table of Contents</h2><div class="tocGrid">${toc}</div></section></section>
 ${section('summary','Recovery Summary',`<div class="summaryGrid"><div class="stat"><strong>${accidentDays}</strong><span>Days since accident</span></div><div class="stat"><strong>${journal.length}</strong><span>Daily logs</span></div><div class="stat"><strong>${state.injuries.length}</strong><span>Injuries tracked</span></div><div class="stat"><strong>${appointments.length}</strong><span>Appointments</span></div><div class="stat"><strong>${doses.length}</strong><span>Dose records</span></div><div class="stat"><strong>${money(total)}</strong><span>Expenses</span></div></div>`)}
 ${config.timeline?section('timeline','Recovery Timeline',timeline.map(x=>`<div class="item"><strong>${fmt(x.date)} — ${esc(x.title)}</strong><div class="meta">${esc(x.type||'Event')}</div>${x.notes?`<p>${esc(x.notes)}</p>`:''}</div>`).join('')):''}
 ${config.journal?section('journal','Daily Logs',journal.map(x=>`<div class="item"><strong>${fmt(x.date)}</strong><p>${esc(x.notes||'')}</p></div>`).join('')):''}
 ${config.injuries?section('injuries','Injury Progress',state.injuries.map(i=>{const logs=injuryLogs.filter(l=>l.injuryId===i.id);return `<div class="item"><strong>${esc(i.name)}</strong>${i.description?`<p class="meta">${esc(i.description)}</p>`:''}${logs.map(l=>`<p><b>${fmt(l.date)} — Pain ${l.pain}/10${l.change?' — '+esc(l.change):''}</b><br>${esc(l.notes||'')}</p>`).join('')||'<p class="muted">No entries in range.</p>'}</div>`}).join('')):''}
 ${config.medications?section('medications','Medication Timeline',state.medications.map(m=>`<div class="item"><div class="medHeader"><strong>${esc(m.name)} — ${esc(m.dose||'Dose not entered')}</strong><span class="badge">${m.active===false?'Completed':'Active'}</span></div><p class="meta">Current frequency: ${esc(m.frequency||m.schedule||'Not entered')}</p>${medicationTimelineForReport(m,config)}</div>`).join('')):''}
 ${config.doseHistory?section('doses','Detailed Dose History',doses.map(d=>{const m=state.medications.find(x=>x.id===d.medicationId);return `<div class="timelineLine medicationReportLine ${medicationColorClass(d.medicationId,d.medicationNameSnapshot||m?.name||'Medication')}"><time>${fmtDateTime(d.dateTime)}</time><span><strong>${esc(d.medicationNameSnapshot||m?.name||'Medication')} — ${esc(d.status)}</strong><br>${esc(d.doseSnapshot||'')}${d.frequencySnapshot?' · '+esc(d.frequencySnapshot):''}${d.note?'<br>'+esc(d.note):''}</span></div>`}).join('')):''}
 ${config.appointments?section('appointments','Appointments',appointments.map(a=>`<div class="item"><strong>${fmt(a.date)} ${esc(a.time||'')} — ${esc(a.appointmentKind||a.type||'Appointment')}</strong><div class="meta">${esc(a.provider||a.insuranceCompany||'')} ${esc(a.location||a.contactName||'')}</div><p>${esc(a.notes||a.visitSummary||a.discussionNotes||'')}</p></div>`).join('')):''}
 ${config.receipts?section('receipts','Receipts and Expenses',`<p class="receiptTotal"><strong>Total: ${money(total)}</strong></p>`+receipts.map(r=>`<div class="item"><strong>${fmt(r.date)} — ${esc(r.description)} — ${money(r.amount)}</strong><div class="meta">${esc(r.category||'Other')}</div>${r.notes?`<p>${esc(r.notes)}</p>`:''}</div>`).join('')):''}
 ${config.notes?section('notes','Notes and Questions',notes.map(n=>`<div class="item"><strong>${fmt(n.date)} — ${esc(n.title)}</strong><p>${esc(n.text)}</p></div>`).join('')+state.questions.map(q=>`<div class="item"><strong>Question for ${esc(q.forWhom||'')}</strong><p>${esc(q.text)}</p>${q.answer?`<p><b>Answer:</b> ${esc(q.answer)}</p>`:''}</div>`).join('')):''}
 ${config.photos?section('photos','Photo Appendix',`<div class="photoGrid">${photoItems.join('')}</div>`):''}
 <div class="printBar"><button onclick="window.print()">Print / Save as PDF</button></div></body></html>`;
 win.document.write(html);win.document.close();setTimeout(()=>win.focus(),250);
}
function render(){
 const views={dashboard,journal,injuries,medications,physio,quickinfo:quickInfo,receipts,missedActivities,appointments,timeline,tasks,notes,reports,settings,more};
 document.getElementById('app').innerHTML=views[page]();
 bind();
}
function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>nav(b.dataset.nav));
 const openQuickInfoEdit=document.getElementById('openQuickInfoEdit');
 const quickInfoBackdrop=document.getElementById('quickInfoEditBackdrop');
 if(openQuickInfoEdit&&quickInfoBackdrop)openQuickInfoEdit.onclick=()=>quickInfoBackdrop.classList.remove('hidden');
 const closeQuickInfoEdit=document.getElementById('closeQuickInfoEdit');
 if(closeQuickInfoEdit&&quickInfoBackdrop)closeQuickInfoEdit.onclick=()=>quickInfoBackdrop.classList.add('hidden');
 document.querySelectorAll('.quickCopyBtn').forEach(b=>b.onclick=async()=>{
   const value=b.dataset.copyValue||'';
   try{await navigator.clipboard.writeText(value);toast('Copied')}catch{prompt('Copy this value:',value)}
 });
 const quickInfoForm=document.getElementById('quickInfoForm');
 if(quickInfoForm)quickInfoForm.onsubmit=e=>{
   e.preventDefault();
   const fd=new FormData(quickInfoForm);
   state.profile.name=String(fd.get('profileName')||'').trim();
   state.profile.accidentDate=String(fd.get('profileAccidentDate')||today());
   state.profile.claimNumber=String(fd.get('profileClaimNumber')||'').trim();
   state.profile.lawyer=String(fd.get('profileLawyer')||'').trim();
   Object.keys(defaults.quickInfo).forEach(key=>{
     if(key!=='otherHealthcareProviders')state.quickInfo[key]=String(fd.get(key)||'').trim();
   });
   const rows=[...quickInfoForm.querySelectorAll('[data-provider-row]')];
   state.quickInfo.otherHealthcareProviders=rows.map(row=>({
     name:String(row.querySelector('[name="providerName"]')?.value||'').trim(),
     specialty:String(row.querySelector('[name="providerSpecialty"]')?.value||'').trim(),
     clinic:String(row.querySelector('[name="providerClinic"]')?.value||'').trim(),
     phone:String(row.querySelector('[name="providerPhone"]')?.value||'').trim(),
     email:String(row.querySelector('[name="providerEmail"]')?.value||'').trim(),
     address:String(row.querySelector('[name="providerAddress"]')?.value||'').trim()
   })).filter(p=>Object.values(p).some(Boolean));
   save();render();toast('Quick reference saved');
 };
 const printQuickInfo=document.getElementById('printQuickInfo');
 if(printQuickInfo)printQuickInfo.onclick=printQuickInfoSheet;
 const providerRows=document.getElementById('otherProviderRows');
 const bindProviderRemove=()=>{
   document.querySelectorAll('.removeOtherProvider').forEach(btn=>btn.onclick=()=>{
     btn.closest('[data-provider-row]')?.remove();
     [...document.querySelectorAll('[data-provider-row]')].forEach((row,ix)=>{
       const number=row.querySelector('.providerEditorNumber');if(number)number.textContent=String(ix+1);
       const label=row.querySelector('.otherProviderRowHead strong');if(label&&!row.querySelector('[name="providerName"]')?.value.trim())label.textContent=`Healthcare Professional ${ix+1}`;
     });
   });
 };
 const addOtherProvider=document.getElementById('addOtherProvider');
 if(addOtherProvider&&providerRows)addOtherProvider.onclick=()=>{
   const wrap=document.createElement('div');
   wrap.innerHTML=otherProviderEditRow({},providerRows.querySelectorAll('[data-provider-row]').length);
   providerRows.appendChild(wrap.firstElementChild);
   bindProviderRemove();
 };
 bindProviderRemove();


 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openForm(b.dataset.add));
 document.querySelectorAll('[data-new-exercise-log]').forEach(b=>b.onclick=()=>openForm('physioExerciseLog','new:'+b.dataset.newExerciseLog));
 document.querySelectorAll('[data-exercise-done]').forEach(b=>b.onclick=()=>{
   const ex=state.physioExercises.find(e=>e.id===b.dataset.exerciseDone);if(!ex)return;
   state.physioExerciseLogs.push({id:uid(),exerciseId:ex.id,dateTime:new Date().toISOString(),status:'Done',note:''});
   save();render();toast(`${ex.name} completed`);
 });
 document.querySelectorAll('[data-exercise-unable]').forEach(b=>b.onclick=()=>{
   const ex=state.physioExercises.find(e=>e.id===b.dataset.exerciseUnable);if(!ex)return;
   const note=prompt('Optional: why were you unable to complete this exercise?','');
   if(note===null)return;
   state.physioExerciseLogs.push({id:uid(),exerciseId:ex.id,dateTime:new Date().toISOString(),status:'Unable',note:String(note||'').trim()});
   save();render();toast(`${ex.name} marked unable`);
 });
 document.querySelectorAll('[data-toggle-physio-exercise]').forEach(b=>b.onclick=()=>{
   const card=b.closest('[data-physio-exercise]');if(!card)return;
   const expanded=card.classList.toggle('is-expanded');b.textContent=expanded?'−':'+';b.setAttribute('aria-expanded',String(expanded));
 });
 document.querySelectorAll('[data-open-exercise-card]').forEach(b=>b.onclick=()=>{
   const ex=state.physioExercises.find(e=>e.id===b.dataset.openExerciseCard);
   const backdrop=document.getElementById('exerciseScorecardBackdrop');
   const card=document.getElementById('exerciseScorecard');
   if(!ex||!backdrop||!card)return;
   card.innerHTML=exerciseScorecardHtml(ex);
   backdrop.classList.remove('hidden');
   card.querySelector('[data-close-exercise-card]')?.addEventListener('click',()=>backdrop.classList.add('hidden'));
   card.querySelector('[data-scorecard-done]')?.addEventListener('click',ev=>{
     const exercise=state.physioExercises.find(e=>e.id===ev.currentTarget.dataset.scorecardDone);
     if(!exercise)return;
     state.physioExerciseLogs.push({id:uid(),exerciseId:exercise.id,dateTime:new Date().toISOString(),status:'Done',note:''});
     save();render();toast(`${exercise.name} completed`);
   });
   card.querySelector('[data-edit="physioExercise"]')?.addEventListener('click',ev=>{
     backdrop.classList.add('hidden');
     openForm('physioExercise',ev.currentTarget.dataset.id);
   });
   card.querySelectorAll('[data-view-photo]').forEach(btn=>btn.onclick=()=>{
     const viewer=document.getElementById('physioPhotoViewer'),img=document.getElementById('physioPhotoViewerImage');
     if(!viewer||!img)return;img.src=attachmentSrc(btn.dataset.viewPhoto);viewer.classList.remove('hidden');
   });
 });
 const exerciseBackdrop=document.getElementById('exerciseScorecardBackdrop');
 if(exerciseBackdrop)exerciseBackdrop.onclick=e=>{if(e.target===exerciseBackdrop)exerciseBackdrop.classList.add('hidden')};

 document.querySelectorAll('[data-toggle-physio-prescription]').forEach(b=>b.onclick=()=>{
   const card=b.closest('[data-physio-prescription]');if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   b.textContent=expanded?'−':'+';
   b.setAttribute('aria-expanded',String(expanded));
   b.setAttribute('aria-label',expanded?'Collapse prescription':'Expand prescription');
 });
 document.querySelectorAll('[data-toggle-physio-visit]').forEach(b=>b.onclick=()=>{
   const card=b.closest('[data-physio-visit]');if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   b.textContent=expanded?'−':'+';
   b.setAttribute('aria-expanded',String(expanded));
 });
 document.querySelectorAll('[data-toggle-physio-document]').forEach(b=>b.onclick=()=>{
   const card=b.closest('.physioCompactDocument');if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   b.textContent=expanded?'−':'+';
   b.setAttribute('aria-expanded',String(expanded));
 });

 const getOrCreateTodayInjuryLog=(injuryId)=>{
   let log=state.injuryLogs.find(l=>l.injuryId===injuryId&&l.date===today());
   if(!log){
     const prev=[...(state.injuryLogs||[])].filter(l=>l.injuryId===injuryId).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
     log={id:uid(),injuryId,date:today(),pain:prev?.pain??'',change:'',notes:'',photos:[],swelling:prev?.swelling||'',stiffness:prev?.stiffness||'',rangeOfMotion:prev?.rangeOfMotion||''};
     state.injuryLogs.push(log);
   }
   return log;
 };
 document.querySelectorAll('[data-quick-injury-pain]').forEach(b=>b.onclick=()=>{
   const [injuryId,painText]=b.dataset.quickInjuryPain.split(':');
   const log=getOrCreateTodayInjuryLog(injuryId);
   log.pain=Number(painText);save();render();toast('Pain updated');
 });
 document.querySelectorAll('[data-quick-injury-change]').forEach(b=>b.onclick=()=>{
   const [injuryId,change]=b.dataset.quickInjuryChange.split(':');
   const log=getOrCreateTodayInjuryLog(injuryId);
   log.change=change;save();render();toast('Injury trend updated');
 });
 document.querySelectorAll('[data-save-quick-injury]').forEach(b=>b.onclick=()=>{
   const injuryId=b.dataset.saveQuickInjury;
   const note=document.querySelector(`[data-quick-injury-note="${injuryId}"]`)?.value||'';
   const log=getOrCreateTodayInjuryLog(injuryId);
   log.notes=String(note).trim();save();render();toast('Injury note saved');
 });

 document.querySelectorAll('[data-new-injury-log]').forEach(b=>b.onclick=()=>openForm('injuryLog','new:'+b.dataset.newInjuryLog));



 document.querySelectorAll('[data-view-photo]').forEach(b=>b.onclick=()=>{
   const viewer=document.getElementById('physioPhotoViewer'),img=document.getElementById('physioPhotoViewerImage');if(!viewer||!img)return;
   img.src=attachmentSrc(b.dataset.viewPhoto);viewer.classList.remove('hidden');
 });
 const closePhysioPhoto=document.getElementById('closePhysioPhoto');
 if(closePhysioPhoto)closePhysioPhoto.onclick=()=>document.getElementById('physioPhotoViewer')?.classList.add('hidden');
 const togglePhysioWindow=document.getElementById('togglePhysioWindow');
 if(togglePhysioWindow){
   togglePhysioWindow.onclick=()=>{
     const shell=togglePhysioWindow.closest('[data-physio-window]');
     if(!shell)return;
     const expanded=shell.classList.toggle('is-expanded');
     togglePhysioWindow.setAttribute('aria-expanded',String(expanded));
     const icon=togglePhysioWindow.querySelector('.physioWindowToggleIcon');
     if(icon)icon.textContent=expanded?'−':'+';
   };
 }
 const savePhysioWindow=document.getElementById('savePhysioWindow');
 if(savePhysioWindow)savePhysioWindow.onclick=()=>{
   const start=document.getElementById('physioStartTime')?.value||'';
   const end=document.getElementById('physioEndTime')?.value||'';
   if(!start||!end){alert('Choose both a start and finish time.');return}
   const startDate=physioClockDate(start),endDate=physioClockDate(end);
   if(!startDate||!endDate||endDate<=startDate){alert('The finish time must be later than the start time.');return}
   state.physioSettings.startTime=start;state.physioSettings.endTime=end;save();render();toast('Physio schedule updated');
 };


 document.querySelectorAll('[data-log-injury]').forEach(b=>b.onclick=()=>openForm('injuryLog','new:'+b.dataset.logInjury));
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));
 document.querySelectorAll('[data-edit-daily]').forEach(b=>b.onclick=()=>editDailyLog(b.dataset.editDaily));
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>del(b.dataset.delete,b.dataset.id));
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{modal=null;render()});
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
 document.querySelectorAll('[data-check-task]').forEach(c=>c.onchange=()=>setState(s=>{const t=s.tasks.find(x=>x.id===c.dataset.checkTask);if(t)t.done=c.checked}));
 document.querySelectorAll('[data-dose-now]').forEach(b=>b.onclick=()=>{const med=state.medications.find(m=>m.id===b.dataset.doseNow);if(!med)return;setState(s=>s.doses.push(doseSnapshot(med,b.dataset.status,new Date().toISOString())));toast(`${med.name} recorded as ${String(b.dataset.status).toLowerCase()}`)});
 document.querySelectorAll('[data-fix-medication-names]').forEach(b=>b.onclick=()=>{
   const historicalNames=[...new Set((state.doses||[]).map(d=>String(d.medicationNameSnapshot||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
   if(!historicalNames.length){alert('No historical medication names were found.');return;}
   const oldName=prompt(`Enter the OLD medication name exactly as it appears in history.\n\nHistorical names found:\n${historicalNames.join('\n')}`);
   if(oldName===null)return;
   const oldTrim=oldName.trim();
   if(!oldTrim){alert('Enter the old medication name.');return;}
   const matches=(state.doses||[]).filter(d=>String(d.medicationNameSnapshot||'').trim().toLowerCase()===oldTrim.toLowerCase());
   if(!matches.length){alert(`No historical records were found with the name "${oldTrim}".`);return;}
   const currentNames=(state.medications||[]).map(m=>m.name).filter(Boolean).sort((a,b)=>a.localeCompare(b));
   const newName=prompt(`Enter the CORRECT medication name.\n\nCurrent medications:\n${currentNames.join('\n')}`,currentNames[0]||'');
   if(newName===null)return;
   const newTrim=newName.trim();
   if(!newTrim){alert('Enter the correct medication name.');return;}
   if(!confirm(`Change "${oldTrim}" to "${newTrim}" in ${matches.length} historical record${matches.length===1?'':'s'}?\n\nDose, frequency, date, time and notes will stay exactly the same.`))return;
   let changed=0;
   (state.doses||[]).forEach(d=>{
     if(String(d.medicationNameSnapshot||'').trim().toLowerCase()===oldTrim.toLowerCase()){
       d.medicationNameSnapshot=newTrim;
       changed++;
     }
   });
   save();
   render();
   toast(`Changed ${changed} historical record${changed===1?'':'s'} to ${newTrim}`);
 });

 document.querySelectorAll('[data-multi-med]').forEach(select=>select.onchange=()=>{const row=select.dataset.multiMed;const med=state.medications.find(m=>m.id===select.value);const dose=document.querySelector(`[data-multi-dose="${row}"]`);const frequency=document.querySelector(`[data-multi-frequency="${row}"]`);if(dose)dose.value=med?.dose||'';if(frequency)frequency.value=med?.frequency||med?.schedule||'';});
 const logTwo=document.getElementById('logTwoMedications');if(logTwo)logTwo.onclick=()=>{
   const date=document.getElementById('multiDoseDate')?.value;
   const clock=document.getElementById('multiDoseTime')?.value;
   const status=document.getElementById('multiDoseStatus')?.value||'Taken';
   const ids=[1,2].map(row=>document.querySelector(`[data-multi-med="${row}"]`)?.value).filter(Boolean);
   if(!date||!clock){alert('Choose both a date and time first.');return;}
   if(ids.length!==2){alert('Choose two medications.');return;}
   if(ids[0]===ids[1]){alert('Choose two different medications.');return;}
   const local=new Date(`${date}T${clock}`);if(Number.isNaN(local.getTime())){alert('That date or time could not be read.');return;}
   const records=[];
   for(const row of [1,2]){const id=document.querySelector(`[data-multi-med="${row}"]`)?.value;const med=state.medications.find(m=>m.id===id);if(!med)continue;records.push(doseSnapshot(med,status,local.toISOString(),{doseSnapshot:document.querySelector(`[data-multi-dose="${row}"]`)?.value||'',frequencySnapshot:document.querySelector(`[data-multi-frequency="${row}"]`)?.value||'',note:document.querySelector(`[data-multi-note="${row}"]`)?.value||''}));}
   setState(s=>s.doses.push(...records));toast('Both medication records added');
 };
 document.querySelectorAll('[data-log-dose]').forEach(b=>b.onclick=()=>{
   const id=b.dataset.logDose;
   const date=document.querySelector(`[data-dose-date="${id}"]`)?.value;
   const clock=document.querySelector(`[data-dose-clock="${id}"]`)?.value;
   const status=document.querySelector(`[data-dose-status="${id}"]`)?.value||'Taken';
   const dose=document.querySelector(`[data-dose-amount="${id}"]`)?.value||'';
   const frequency=document.querySelector(`[data-dose-frequency="${id}"]`)?.value||'';
   const note=document.querySelector(`[data-dose-note="${id}"]`)?.value||'';
   if(!date||!clock){alert('Choose both a date and time first.');return;}
   const local=new Date(`${date}T${clock}`);
   if(Number.isNaN(local.getTime())){alert('That date or time could not be read.');return;}
   const med=state.medications.find(m=>m.id===id);if(!med)return;
   setState(s=>s.doses.push(doseSnapshot(med,status,local.toISOString(),{doseSnapshot:dose,frequencySnapshot:frequency,note})));
   toast('Medication history added');
 });
 document.querySelectorAll('[data-delete-dose]').forEach(b=>b.onclick=()=>{
   if(!confirm('Delete this dose record?'))return;
   state.doses=state.doses.filter(d=>d.id!==b.dataset.deleteDose);save();render();
 });
 document.querySelectorAll('[data-add-dose-day]').forEach(b=>b.onclick=()=>openForm('dose','newday:'+b.dataset.addDoseDay));
 const doseMedSelect=document.querySelector('[data-dose-medication-select]');
 if(doseMedSelect){
   doseMedSelect.onchange=()=>{
     const med=state.medications.find(m=>m.id===doseMedSelect.value);
     const form=doseMedSelect.closest('form');
     if(!form||!med)return;
     const dose=form.elements.doseSnapshot;
     const frequency=form.elements.frequencySnapshot;
     const name=form.elements.medicationNameSnapshot;
     if(dose)dose.value=med.dose||'';
     if(frequency)frequency.value=med.frequency||med.schedule||'';
     if(name)name.value=med.name||'Medication';
   };
 }

 document.querySelectorAll('[data-toggle-medication]').forEach(b=>b.onclick=()=>{
   const card=b.closest('[data-medication-card]');
   const expanded=card.classList.toggle('is-expanded');
   b.textContent=expanded?'−':'+';
   b.setAttribute('aria-expanded',String(expanded));
   b.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} ${card.querySelector('.medicationTitleRow h3')?.textContent||'medication'}`);
 });
 document.querySelectorAll('[data-toggle-appointment]').forEach(b=>b.onclick=()=>{
   const card=b.closest('[data-appointment-card]');
   if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   b.textContent=expanded?'−':'+';
   b.setAttribute('aria-expanded',String(expanded));
 });
 document.querySelectorAll('[data-rebook-appointment]').forEach(b=>b.onclick=()=>{
   const source=state.appointments.find(a=>a.id===b.dataset.rebookAppointment);
   if(!source)return;
   if(source.physioVisitId&&state.physioVisits.some(v=>v.id===source.physioVisitId)){
     openForm('physioVisit','rebook:'+source.physioVisitId);
   }else{
     openForm('appointment','rebook:'+source.id);
   }
 });

 document.querySelectorAll('.painChoice').forEach(b=>b.onclick=()=>{const card=b.closest('[data-injury-id]');card.querySelectorAll('.painChoice').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');card.querySelector('input[name$="_pain"]').value=b.dataset.pain;});
 document.querySelectorAll('.changeChoice').forEach(b=>b.onclick=()=>{const card=b.closest('[data-injury-id]');card.querySelectorAll('.changeChoice').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');card.querySelector('input[name$="_change"]').value=b.dataset.change;});
 document.querySelectorAll('.symptomChoice').forEach(b=>b.onclick=()=>{const field=b.closest('.symptomField');field.querySelectorAll('.symptomChoice').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');field.querySelector('input[type="hidden"]').value=b.dataset.symptomValue;});
 document.querySelectorAll('[data-toggle-injury]').forEach(b=>b.onclick=()=>{
   const card=b.closest('.dailyInjuryCard');
   const expanded=card.classList.toggle('is-expanded');
   b.textContent=expanded?'−':'+';
   b.setAttribute('aria-expanded',String(expanded));
   b.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} ${card.querySelector('.injuryTitleBlock strong')?.textContent||'injury'}`);
 });
 const df=document.getElementById('dailyLogForm');if(df){df.onsubmit=async e=>{e.preventDefault();await saveDailyLog(df)};df.querySelectorAll('[data-injury-id]').forEach(card=>{card.dataset.photos='[]';card.dataset.logId=''});bindDailyPhotoRemoval();}
 const f=document.getElementById('editForm');if(f){
   f.onsubmit=async e=>{e.preventDefault();await saveForm(f)};
   const kind=f.querySelector('[name="appointmentKind"]');
   if(kind){
     const update=()=>f.querySelectorAll('[data-appointment-fields]').forEach(group=>group.classList.toggle('hidden',group.dataset.appointmentFields!==kind.value));
     kind.onchange=update;
     update();
   }
 }
 const pf=document.getElementById('profileForm');if(pf)pf.onsubmit=e=>{e.preventDefault();state.profile={...state.profile,...Object.fromEntries(new FormData(pf))};save();toast('Saved')};
 document.querySelectorAll('[data-generate-report]').forEach(button=>button.onclick=()=>printReport(reportPreset(button.dataset.generateReport)));
 const previewCustom=document.getElementById('previewCustomReport');if(previewCustom)previewCustom.onclick=()=>{const box=document.getElementById('reportPreview');box.innerHTML=reportPreviewHtml(customReportConfig());box.classList.remove('hidden');box.scrollIntoView({behavior:'smooth',block:'nearest'})};
 const generateCustom=document.getElementById('generateCustomReport');if(generateCustom)generateCustom.onclick=()=>printReport(customReportConfig());
 const shareBtn=document.getElementById('shareAppBtn');if(shareBtn)shareBtn.onclick=async()=>{
   const url='https://mva-record-keeper.vercel.app/';
   const shareData={title:'MVA Record Keeper',text:"I've been using this MVA Record Keeper to track injuries, medications, appointments, receipts and recovery.",url};
   try{
     if(navigator.share){await navigator.share(shareData);return;}
     if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);toast('App link copied');return;}
     const input=document.createElement('textarea');input.value=url;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove();toast('App link copied');
   }catch(err){if(err?.name!=='AbortError')alert(`Share this link: ${url}`)}
 };
 const saveReportSetting=(key,value)=>{state.reportSettings={...defaults.reportSettings,...(state.reportSettings||{}),[key]:value};save();toast('Report option saved')};
 const includePhotos=document.getElementById('reportIncludePhotos');if(includePhotos)includePhotos.onchange=()=>saveReportSetting('includePhotos',includePhotos.checked);
 const includeMedicationHistory=document.getElementById('reportIncludeMedicationHistory');if(includeMedicationHistory)includeMedicationHistory.onchange=()=>saveReportSetting('includeMedicationHistory',includeMedicationHistory.checked);
 const autoPrint=document.getElementById('reportAutoPrint');if(autoPrint)autoPrint.onchange=()=>saveReportSetting('autoPrint',autoPrint.checked);
 const bb=document.getElementById('backupBtn');if(bb)bb.onclick=async()=>{
   try{
     bb.disabled=true;bb.textContent='Preparing backup…';
     const refs=allAttachmentRefsFromState(),attachments={};
     refs.forEach(ref=>{if(attachmentCache[ref])attachments[ref]=attachmentCache[ref]});
     const payload={...state,attachments,backupCreatedAt:new Date().toISOString(),dataVersion:Math.max(Number(state.dataVersion||0),4),attachmentStorageVersion:1};
     const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
     const a=document.createElement('a');a.href=url;const stamp=new Date();
     const timeStamp=[String(stamp.getHours()).padStart(2,'0'),String(stamp.getMinutes()).padStart(2,'0'),String(stamp.getSeconds()).padStart(2,'0')].join('-');
     a.download=`mva-record-keeper-v${APP_VERSION}-backup-${today()}-${timeStamp}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Backup downloaded · ${Object.keys(attachments).length} attachment${Object.keys(attachments).length===1?'':'s'}`);
   }catch(err){console.error(err);alert('The backup could not be created. Please try again.')}
   finally{bb.disabled=false;bb.textContent='Download backup'}
 };
 const ri=document.getElementById('restoreInput');if(ri)ri.onchange=async()=>{try{
   if(!ri.files?.[0])return;
   const data=JSON.parse(await ri.files[0].text());
   if(!data||typeof data!=='object'||!Array.isArray(data.medications)||!Array.isArray(data.journal))throw new Error('Invalid backup');
   if(!confirm('Restore this backup? Your current records and stored attachments on this device will be replaced.'))return;
   await clearAttachmentDB();
   const backupAttachments=data.attachments&&typeof data.attachments==='object'?data.attachments:{};
   for(const [ref,value] of Object.entries(backupAttachments))if(value)await putAttachmentData(value,ref);
   const clean={...data};delete clean.attachments;delete clean.backupCreatedAt;
   state={...structuredClone(defaults),...clean};
   state.profile={...defaults.profile,...(state.profile||{})};
   state.quickInfo={...defaults.quickInfo,...(state.quickInfo||{})};
   state.reportSettings={...defaults.reportSettings,...(state.reportSettings||{})};
   state.physioSettings={...defaults.physioSettings,...(state.physioSettings||{})};
   migrateMedicationData();
   await migrateLegacyAttachments();
   save();render();toast(`Backup restored · ${allAttachmentRefsFromState().size} attachment${allAttachmentRefsFromState().size===1?'':'s'}`);
 }catch(err){console.error(err);alert('That file could not be restored as an MVA Record Keeper backup.')}finally{ri.value=''}};
 const rb=document.getElementById('resetBtn');if(rb)rb.onclick=async()=>{if(confirm('Erase all MVA app data and stored attachments on this device?')){await clearAttachmentDB();state=structuredClone(defaults);save();render();toast('All app data erased')}};
}

// Robust navigation handling. This is delegated so bottom-nav buttons keep
// working even after render() replaces the page HTML.
document.addEventListener('click',function(e){
 const missedToggle=e.target.closest('[data-toggle-missed-activity]');
 if(missedToggle){
   e.preventDefault();
   const card=missedToggle.closest('.missedActivityCard');
   if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   missedToggle.textContent=expanded?'−':'+';
   missedToggle.setAttribute('aria-expanded',String(expanded));
   return;
 }

 const noteToggle=e.target.closest('[data-toggle-note]');
 if(noteToggle){
   e.preventDefault();
   const card=noteToggle.closest('.noteCollapsible');
   if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   noteToggle.textContent=expanded?'−':'+';
   noteToggle.setAttribute('aria-expanded',String(expanded));
   return;
 }

 const injuryToggle=e.target.closest('[data-toggle-injury-card]');
 if(injuryToggle){
   e.preventDefault();
   e.stopPropagation();
   const card=injuryToggle.closest('[data-injury-card]');
   if(!card)return;
   const expanded=card.classList.toggle('is-expanded');
   injuryToggle.textContent=expanded?'−':'+';
   injuryToggle.setAttribute('aria-expanded',String(expanded));
   return;
 }

 const navBtn=e.target.closest('[data-nav]');
 if(!navBtn)return;
 const destination=navBtn.dataset.nav;
 if(!destination)return;
 e.preventDefault();
 page=destination;
 render();
 // NAV_DELEGATE_END
});

async function startApp(){
 try{
   const existing=await loadAttachmentCache();
   const result=await migrateLegacyAttachments();
   await loadAttachmentCache();
   render();
   if(result.migrated)toast(`Storage upgraded · moved ${result.migrated} attachment${result.migrated===1?'':'s'}`);
   else if(existing&&state.attachmentStorageVersion===1)console.log(`Loaded ${existing} stored attachment(s)`);
 }catch(err){
   console.error('Attachment storage startup error',err);
   render();
   alert('The app opened, but the expanded attachment storage could not be initialized. Your existing records have not been deleted. Please keep your backup and avoid adding new attachments until this is resolved.');
 }
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
setInterval(()=>{if(page==='physio')refreshPhysioCountdowns()},30000);
startApp();
})();
