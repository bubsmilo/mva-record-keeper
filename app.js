
(() => {
'use strict';

const KEY='mva-record-keeper-v1';
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
  reportSettings:{includePhotos:true,includeMedicationHistory:true,autoPrint:true},
  journal:[], injuries:[], injuryLogs:[], medications:[], doses:[], medicationEvents:[], receipts:[], appointments:[],
  tasks:[], questions:[], notes:[], timeline:[]
};
let state=load();
state.reportSettings={...defaults.reportSettings,...(state.reportSettings||{})};
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
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function setState(mut){mut(state);save();render()}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.append(el);setTimeout(()=>el.remove(),2200)}
function nav(p){page=p;modal=null;render();window.scrollTo(0,0)}

function appShell(content,title,subtitle=''){
  const items=[
    ['dashboard','🏠','Dashboard'],['journal','📖','Journal'],['injuries','🦴','Injuries'],['medications','💊','Medications'],
    ['receipts','🧾','Receipts'],['appointments','🩺','Appointments'],['timeline','🕒','Timeline'],
    ['tasks','✅','Tasks'],['notes','📝','Notes & Questions'],['reports','📄','Reports'],['settings','⚙️','Settings']
  ];
  return `<div class="app">
    <aside class="sidebar">
      <div class="brand"><img src="./mva-logo-192.png"><div><strong>MVA Record Keeper</strong><small>Your recovery, organized</small></div></div>
      <nav class="nav">${items.map(i=>`<button data-nav="${i[0]}" class="${page===i[0]?'active':''}"><span>${i[1]}</span>${i[2]}</button>`).join('')}</nav>
      <div class="sidebarFoot">Private data stored on this device.</div>
    </aside>
    <main class="main">
      <header class="topbar"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><img src="./mva-logo-32.png" width="32" height="32" alt=""></header>
      ${content}
    </main>
    <nav class="bottomNav">${[items[0],items[1],items[2],items[3],['more','•••','More']].map(i=>{
      const morePages=['receipts','appointments','timeline','tasks','notes','reports','settings'];
      const active=i[0]==='more'?morePages.includes(page):page===i[0];
      return `<button data-nav="${i[0]}" class="${active?'active':''}"><span>${i[1]}</span>${i[2]}</button>`;
    }).join('')}</nav>
    ${modal||''}
  </div>`;
}

function dashboard(){
 const expense=state.receipts.reduce((s,r)=>s+Number(r.amount||0),0);
 const next=state.appointments.filter(a=>a.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
 const meds=state.medications.filter(m=>m.active!==false);
 const dueTasks=state.tasks.filter(t=>!t.done).slice(0,4);
 return appShell(`
 <div class="grid grid2">
  <section class="card hero"><div><div class="muted small">Days since accident</div><div class="metric">${daysBetween(state.profile.accidentDate,today())}</div><div>${fmt(state.profile.accidentDate)}</div></div><img src="./mva-logo-192.png"></section>
  <section class="card"><div class="muted small">Next appointment</div>${next?`<div class="rowTitle">${esc(next.type)}</div><div class="rowMeta">${fmt(next.date)}${next.time?' at '+esc(next.time):''}</div><div>${esc(next.provider||'')}</div>`:`<div class="empty">No upcoming appointment</div>`}</section>
 </div>
 <div class="grid grid4" style="margin-top:16px">
  <section class="card"><div class="muted small">Journal entries</div><div class="metric">${state.journal.length}</div></section>
  <section class="card"><div class="muted small">Active medications</div><div class="metric">${meds.length}</div></section>
  <section class="card"><div class="muted small">Receipt total</div><div class="metric">${money(expense)}</div></section>
  <section class="card"><div class="muted small">Open tasks</div><div class="metric">${state.tasks.filter(t=>!t.done).length}</div></section>
 </div>
 <div class="grid grid2" style="margin-top:16px">
  <section class="card"><h2>Quick actions</h2><div class="grid grid2">
   <button class="btn primary" data-add="journal">+ Journal Entry</button><button class="btn secondary" data-add="receipt">+ Receipt</button>
   <button class="btn secondary" data-add="appointment">+ Appointment</button><button class="btn secondary" data-add="task">+ Task</button>
  </div></section>
  <section class="card"><h2>Tasks due</h2>${dueTasks.length?`<div class="list">${dueTasks.map(taskRow).join('')}</div>`:`<div class="empty">No open tasks</div>`}</section>
 </div>`, 'Dashboard','A clear picture of your recovery and claim records.');
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
function journal(){
 const sorted=[...state.journal].sort((a,b)=>(b.date+b.id).localeCompare(a.date+a.id));
 const active=state.injuries;
 return appShell(`
 <form class="card dailyLogForm" id="dailyLogForm" data-edit-id="">
  <div class="toolbar"><div><h2 id="dailyLogHeading">How was your day?</h2><p class="muted">Add your overall daily note and update every injury on this one page.</p></div><button type="button" class="btn secondary" data-add="injury">+ Add Injury</button></div>
  <div class="dailyDate"><label for="dailyDate">Date</label><input id="dailyDate" name="date" type="date" value="${today()}"></div>
  <div class="field"><label for="dailyNotes">Overall daily note</label><textarea id="dailyNotes" name="notes" placeholder="Example: Took a shower and dressed myself for the first time. I still could not brush my hair."></textarea></div>
  <div class="dailyInjuryHead"><div><h3>Injury updates</h3><p class="muted small">Each injury can have its own pain score, change, notes, and optional photo.</p></div></div>
  ${active.length?`<div class="dailyInjuryList">${active.map(i=>dailyInjuryEditor(i)).join('')}</div>`:`<div class="empty">Add your injuries once, then they will all appear here in every daily log.</div>`}
  <button class="btn primary wide saveDailyBtn">Save Daily Log</button>
 </form>
 <div class="toolbar" style="margin-top:20px"><h2 style="margin:0">Previous daily logs</h2><span class="pill">${sorted.length} entries</span></div>
 <div class="list">${sorted.length?sorted.map(j=>{const logs=state.injuryLogs.filter(x=>x.date===j.date);return `<article class="card">
  <div class="toolbar"><div><h3>${fmt(j.date)}</h3></div><div class="actions"><button class="iconBtn" data-edit-daily="${j.id}">Edit daily log</button><button class="iconBtn" data-delete="journal" data-id="${j.id}">Delete</button></div></div>
  <p>${esc(j.notes||'').replace(/\n/g,'<br>')}</p>
  ${(()=>{const dayDoses=(state.doses||[]).filter(d=>localDateKey(d.dateTime)===j.date&&d.status==='Taken').sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));return dayDoses.length?`<div class="dailyMedicationSummary"><strong>Medication taken</strong>${dayDoses.map(d=>`<span>✓ ${esc(d.medicationNameSnapshot||state.medications.find(m=>m.id===d.medicationId)?.name||'Medication')} · ${new Date(d.dateTime).toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'})}${d.doseSnapshot?' · '+esc(d.doseSnapshot):''}</span>`).join('')}</div>`:''})()}
  ${logs.length?`<div class="injurySummary">${logs.map(l=>{const i=state.injuries.find(x=>x.id===l.injuryId);const extras=[l.swelling&&`Swelling: ${esc(l.swelling)}`,l.stiffness&&`Stiffness: ${esc(l.stiffness)}`,l.rangeOfMotion&&`Range of motion: ${esc(l.rangeOfMotion)}`].filter(Boolean);return `<div><strong>${esc(i?.name||'Injury')}</strong>${l.pain!==''&&l.pain!=null?` <span class="pill">${l.pain}/10</span>`:''}${l.change?` · ${esc(l.change)}`:''}${extras.length?`<div class="symptomSummary small">${extras.join(' · ')}</div>`:''}${l.notes?`<div class="small muted">${esc(l.notes)}</div>`:''}${l.photos?.length?`<div class="photoGrid" style="margin-top:8px">${l.photos.map((p,ix)=>`<div class="photoWrap"><img class="photo" src="${p}"><button type="button" class="removePhotoBtn" data-remove-saved-photo="${l.id}:${ix}" aria-label="Remove photo">×</button></div>`).join('')}</div>`:''}</div>`}).join('')}</div>`:''}
 </article>`}).join(''):`<div class="empty">Add your first daily log.</div>`}</div>`,'Daily Log','Record your day and keep every injury separate.');
}

function dailyInjuryEditor(i,log={}){
 const photos=log.photos||[], pain=log.pain??'', change=log.change||'';
 const symptomFields=[
   i.trackSwelling?`<div class="field symptomField"><label>Swelling</label>${optionButtons(`injury_${i.id}_swelling`,log.swelling||'', ['None','Slight','Moderate','Severe'])}</div>`:'',
   i.trackStiffness?`<div class="field symptomField"><label>Stiffness</label>${optionButtons(`injury_${i.id}_stiffness`,log.stiffness||'', ['None','Slight','Moderate','Severe'])}</div>`:'',
   i.trackRangeOfMotion?`<div class="field symptomField rangeField"><label>Range of motion</label>${optionButtons(`injury_${i.id}_rangeOfMotion`,log.rangeOfMotion||'', ['Full','Slightly limited','Moderately limited','Very limited','Unable'])}</div>`:''
 ].join('');
 const hasSavedData=log && Object.keys(log).length>0;
 return `<section class="dailyInjuryCard ${hasSavedData?'is-expanded':''}" data-injury-id="${i.id}">
   <div class="dailyInjuryName">
     <div class="injuryIcon">${esc((i.name||'I').slice(0,1).toUpperCase())}</div>
     <div class="injuryTitleBlock"><strong>${esc(i.name)}</strong>${i.description?`<span>${esc(i.description)}</span>`:''}</div>
     <span class="updatedToday">${hasSavedData?'Saved entry':'Update today'}</span>
     <button type="button" class="injuryExpandBtn" data-toggle-injury aria-expanded="${hasSavedData?'true':'false'}" aria-label="${hasSavedData?'Collapse':'Expand'} ${esc(i.name)}">${hasSavedData?'−':'+'}</button>
   </div>
   <div class="dailyInjuryBody">
   <div class="dailyInjuryFields">
     <div class="field painField"><label>Pain (0–10)</label><input type="hidden" name="injury_${i.id}_pain" value="${esc(pain)}"><div class="painScale">${Array.from({length:11},(_,n)=>`<button type="button" class="painChoice ${String(pain)===String(n)?'selected':''}" data-pain="${n}">${n}</button>`).join('')}</div></div>
     <div class="field changeField"><label>Compared with yesterday</label><input type="hidden" name="injury_${i.id}_change" value="${esc(change)}"><div class="changeChoices">${[['Better','↑'],['Same','='],['Worse','↓']].map(([v,icon])=>`<button type="button" class="changeChoice ${v.toLowerCase()} ${change===v?'selected':''}" data-change="${v}"><span>${icon}</span>${v}</button>`).join('')}</div></div>
     ${symptomFields?`<div class="symptomFields">${symptomFields}</div>`:''}
     <div class="field injuryNoteField"><label>Quick note <span>(optional)</span></label><div class="noteWithPhoto"><textarea name="injury_${i.id}_notes" placeholder="What changed or affected this injury today?">${esc(log.notes||'')}</textarea><label class="cameraBtn" title="Add photo">📷<input type="file" name="injury_${i.id}_photos" accept="image/*" capture="environment"></label></div><div class="photoGrid savedPhotoGrid" data-saved-photos="${i.id}">${photos.map((p,ix)=>`<div class="photoWrap"><img class="photo" src="${p}"><button type="button" class="removePhotoBtn" data-remove-edit-photo="${i.id}:${ix}" aria-label="Remove photo">×</button></div>`).join('')}</div></div>
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
   grid.innerHTML=(log.photos||[]).map((p,ix)=>`<div class="photoWrap"><img class="photo" src="${p}"><button type="button" class="removePhotoBtn" data-remove-edit-photo="${i.id}:${ix}" aria-label="Remove photo">×</button></div>`).join('');
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
   if(input?.files?.length) photos.push(...await filesToData(input));
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
   grid.innerHTML=photos.map((p,ix)=>`<div class="photoWrap"><img class="photo" src="${p}"><button type="button" class="removePhotoBtn" data-remove-edit-photo="${injuryId}:${ix}" aria-label="Remove photo">×</button></div>`).join('');
   bindDailyPhotoRemoval();
 });
 document.querySelectorAll('[data-remove-saved-photo]').forEach(b=>b.onclick=()=>{
   const [logId,indexText]=b.dataset.removeSavedPhoto.split(':'); const log=state.injuryLogs.find(x=>x.id===logId); if(!log)return;
   log.photos=(log.photos||[]).filter((_,ix)=>ix!==Number(indexText)); save();render();toast('Photo removed');
 });
}

function injuries(){
 const active=state.injuries.filter(i=>i.active!==false), inactive=state.injuries.filter(i=>i.active===false);
 return appShell(`<div class="toolbar"><div><span class="pill">${active.length} active injuries</span></div><button class="btn primary" data-add="injury">+ Add Injury</button></div>
 <div class="list">${active.length?active.map(i=>injuryCard(i)).join(''):`<div class="empty">No injuries added yet.</div>`}</div>
 ${inactive.length?`<h2 style="margin-top:24px">Archived injuries</h2><div class="list">${inactive.map(i=>injuryCard(i)).join('')}</div>`:''}`,'My Injuries','Keep each injury separate and view its history over time.');
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
function doseHistoryRow(d,showMedication=false){
 const med=state.medications.find(x=>x.id===d.medicationId);
 const name=d.medicationNameSnapshot||med?.name||'Medication';
 return `<div class="doseHistoryRow detailedDoseRow"><div>${showMedication?`<strong>${esc(name)}</strong>`:`<strong class="${d.status==='Missed'?'missedDose':'takenDose'}">${esc(d.status)}</strong>`}<span>${showMedication?`${esc(d.status)} · `:''}${fmtDateTime(d.dateTime)}</span><div class="doseSnapshotLine">${d.doseSnapshot?`<span><b>Dose:</b> ${esc(d.doseSnapshot)}</span>`:''}${d.frequencySnapshot?`<span><b>Frequency:</b> ${esc(d.frequencySnapshot)}</span>`:''}</div>${d.note?`<small>${esc(d.note)}</small>`:''}${d.legacySnapshot?`<small class="muted">Older imported record — details use the best information available.</small>`:''}</div><div class="doseRowActions"><button class="iconBtn" type="button" data-edit="dose" data-id="${d.id}">Edit</button><button class="doseDeleteBtn" type="button" data-delete-dose="${d.id}" aria-label="Delete dose record">×</button></div></div>`;
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
 <div class="toolbar"><div><span class="pill">${activeMeds.length} active · ${completedMeds.length} completed</span></div><button class="btn primary" data-add="medication">+ Add medication</button></div>
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
      <div class="medicationTitleRow"><div><h3>${esc(m.name)}</h3><div class="medDose">${esc(m.dose||'Dose not entered')} · ${esc(m.frequency||m.schedule||'Frequency not entered')}</div>${m.active===false?`<span class="completedMedicationTag">Completed${m.completedDate?' · '+fmt(m.completedDate):''}</span>`:''}</div><button type="button" class="medicationExpandBtn" data-toggle-medication aria-expanded="false">+</button></div>
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
 ${history.length?`<section class="card allDoseHistory"><div class="toolbar"><div><h2>All medication history</h2><p class="muted small">Every entry keeps the dose and frequency that applied at that time.</p></div></div><div class="doseHistory">${history.slice(0,60).map(d=>doseHistoryRow(d,true)).join('')}</div></section>`:''}
 `,'Medications','Track actual dose times while preserving changes to dose and frequency over time.');
}
function receipts(){
 const total=state.receipts.reduce((s,r)=>s+Number(r.amount||0),0);
 const sorted=[...state.receipts].sort((a,b)=>b.date.localeCompare(a.date));
 return appShell(`<div class="grid grid2"><section class="card"><div class="muted small">Total expenses</div><div class="metric">${money(total)}</div></section><section class="card"><div class="muted small">Number of receipts</div><div class="metric">${state.receipts.length}</div></section></div>
 <div class="toolbar" style="margin-top:16px"><div></div><button class="btn primary" data-add="receipt">+ Add receipt</button></div>
 <div class="list">${sorted.length?sorted.map(r=>`<div class="row"><div class="rowMain" style="display:flex;gap:12px">${reportSettings.includePhotos&&r.photo?`<img class="photo" src="${r.photo}">`:''}<div><div class="rowTitle">${esc(r.description)}</div><div class="rowMeta">${fmt(r.date)} · ${esc(r.category||'Other')}</div>${r.notes?`<div class="small">${esc(r.notes)}</div>`:''}</div></div><div><strong>${money(r.amount)}</strong><div class="actions" style="margin-top:8px"><button class="iconBtn" data-edit="receipt" data-id="${r.id}">Edit</button><button class="iconBtn" data-delete="receipt" data-id="${r.id}">Delete</button></div></div></div>`).join(''):`<div class="empty">No receipts recorded.</div>`}</div>`,'Receipts','Keep expense details and receipt photos together.');
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
        <div class="appointmentTopActions"><button class="iconBtn" data-edit="appointment" data-id="${a.id}">Edit</button><button class="iconBtn" data-delete="appointment" data-id="${a.id}">Delete</button></div>
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
 return appShell(`<div class="grid grid2">
 <section class="card"><div class="toolbar"><h2>Questions</h2><button class="btn secondary" data-add="question">+ Add</button></div><div class="list">${state.questions.length?state.questions.map(q=>`<div class="row"><div class="${q.answered?'strike':''}"><div class="rowTitle">${esc(q.text)}</div><div class="rowMeta">${esc(q.forWhom||'Doctor')}</div>${q.answer?`<div class="small"><strong>Answer:</strong> ${esc(q.answer)}</div>`:''}</div><div class="actions"><button class="iconBtn" data-edit="question" data-id="${q.id}">Edit</button><button class="iconBtn" data-delete="question" data-id="${q.id}">Delete</button></div></div>`).join(''):`<div class="empty">No questions saved.</div>`}</div></section>
 <section class="card"><div class="toolbar"><h2>General notes</h2><button class="btn secondary" data-add="note">+ Add</button></div><div class="list">${state.notes.length?state.notes.map(n=>`<div class="row"><div><div class="rowTitle">${esc(n.title)}</div><div class="rowMeta">${fmt(n.date)}</div><p class="small">${esc(n.text)}</p></div><div class="actions"><button class="iconBtn" data-edit="note" data-id="${n.id}">Edit</button><button class="iconBtn" data-delete="note" data-id="${n.id}">Delete</button></div></div>`).join(''):`<div class="empty">No notes saved.</div>`}</div></section>
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

function settings(){
 const rs={...defaults.reportSettings,...(state.reportSettings||{})};
 return appShell(`<div class="grid grid2 settingsGrid">
 <section class="card"><div class="settingsIcon">📱</div><h2>App</h2><p>Share the MVA Record Keeper so it can be opened on another phone, tablet or computer.</p><button class="btn primary wide" id="shareAppBtn">Share App</button><div class="small muted shareUrl">mva-record-keeper.vercel.app</div><hr class="settingsDivider"><h3>About</h3><div class="summaryBox"><strong>MVA Record Keeper</strong><br><span class="small">Recovery records, medication tracking and claim documentation.</span><br><span class="small muted">App version 2.1</span></div></section>
 <section class="card"><div class="settingsIcon">👤</div><h2>Claim information</h2><form id="profileForm" class="formGrid">
 ${field('Name','name',state.profile.name)}${field('Accident date','accidentDate',state.profile.accidentDate,'date')}
 ${field('Lawyer','lawyer',state.profile.lawyer)}${field('Claim number','claimNumber',state.profile.claimNumber)}
 <button class="btn primary span2">Save information</button></form></section>
 <section class="card"><div class="settingsIcon">💾</div><h2>Data</h2><p>Download a backup regularly. It contains all records and attached photos.</p><div class="grid"><button class="btn secondary" id="backupBtn">Download backup</button><label class="btn secondary" style="text-align:center">Restore backup<input id="restoreInput" type="file" accept="application/json" hidden></label></div><p class="small muted">Use Restore Backup to move your records to another device after opening the shared app link.</p></section>
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
 ['receipts','🧾','Receipts'],['appointments','🩺','Appointments'],['timeline','🕒','Recovery Timeline'],['tasks','✅','Tasks & Paperwork'],['notes','📝','Notes & Questions'],['reports','📄','Reports'],['settings','⚙️','Settings']
 ].map(i=>`<button class="card" data-nav="${i[0]}" style="text-align:left;border:1px solid #dde5ef"><div style="font-size:28px">${i[1]}</div><h3>${i[2]}</h3></button>`).join('')}</div>`,'More','All additional tools and records.');
}

function field(label,name,value='',type='text',extra=''){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}
function area(label,name,value='',span=true){return `<div class="field ${span?'span2':''}"><label>${label}</label><textarea name="${name}">${esc(value)}</textarea></div>`}
function selectField(label,name,options,value){return `<div class="field"><label>${label}</label><select name="${name}">${options.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`}

function openForm(type,id){
 const newInjuryId=type==='injuryLog'&&String(id||'').startsWith('new:')?String(id).slice(4):'';
 if(newInjuryId)id='';
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',dose:'doses',receipt:'receipts',appointment:'appointments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 const arr=state[map[type]]||[], item=id?arr.find(x=>x.id===id):{};
 let body='', title=type==='injuryLog'?'Update Injury':(id?'Edit ':'Add ')+type[0].toUpperCase()+type.slice(1);
 if(type==='journal') body=`${field('Date','date',item.date||today(),'date')}${area('How was your day?','notes',item.notes||'')}${photoField('Photo (optional)','photos',item.photos||[],true)}`;
 if(type==='injury') body=`${field('Injury name','name',item.name||'')}${field('Short description (optional)','description',item.description||'')}${selectField('Status','active',['Active','Archived'],item.active===false?'Archived':'Active')}<div class="field span2"><label>Daily tracking fields</label><p class="small muted trackingHelp">Enable only the details that make sense for this injury. Enabled fields will appear in every Daily Log.</p><div class="trackingToggles"><label class="trackingToggle"><input type="checkbox" name="trackSwelling" ${item.trackSwelling?'checked':''}><span>Swelling</span></label><label class="trackingToggle"><input type="checkbox" name="trackStiffness" ${item.trackStiffness?'checked':''}><span>Stiffness</span></label><label class="trackingToggle"><input type="checkbox" name="trackRangeOfMotion" ${item.trackRangeOfMotion?'checked':''}><span>Range of motion</span></label></div></div>`;
 if(type==='injuryLog'){const injuryId=item.injuryId||newInjuryId; const injury=state.injuries.find(x=>x.id===injuryId); body=`<div class="field span2 summaryBox"><strong>${esc(injury?.name||'Injury')}</strong><div class="small muted">Update only what you want to record today.</div></div>${field('Date','date',item.date||today(),'date')}${field('Pain level (0-10)','pain',item.pain??0,'number','min="0" max="10"')}${selectField('Compared with last update','change',['Better','Same','Worse','Not sure'],item.change||'Same')}${area('Notes (optional)','notes',item.notes||'')}${photoField('Photo (optional)','photos',item.photos||[],true)}<input type="hidden" name="injuryId" value="${esc(injuryId)}">`; }
 if(type==='medication') body=`${field('Medication name','name',item.name||'')}${field('Dose','dose',item.dose||'')}${selectField('Frequency','frequency',['Every 4 hours','Every 6 hours','Every 8 hours','Every 12 hours','Once daily','Twice daily','Three times daily','Four times daily','As needed (PRN)'],item.frequency||item.schedule||'Every 8 hours')}${field('First dose time','firstDoseTime',item.firstDoseTime||parseClockTime(item.usualTimes||''),'time')}${selectField('Status','status',['Active','Completed'],item.active===false?'Completed':'Active')}${field('Completed date','completedDate',item.completedDate||today(),'date')}${area('Reason completed (optional)','completedReason',item.completedReason||'')}${area('Instructions or notes','notes',item.notes||'')}`;
 if(type==='dose'){const med=state.medications.find(m=>m.id===item.medicationId);body=`<div class="field span2 summaryBox"><strong>${esc(item.medicationNameSnapshot||med?.name||'Medication')}</strong><div class="small muted">Correct this history record without changing other entries.</div></div>${field('Date','doseDate',localDateKey(item.dateTime)||today(),'date')}${field('Time','doseTime',item.dateTime?localDateTimeValue(new Date(item.dateTime)).slice(11,16):localDateTimeValue().slice(11,16),'time')}${selectField('Status','status',['Taken','Missed'],item.status||'Taken')}${field('Dose at that time','doseSnapshot',item.doseSnapshot||med?.dose||'')}${field('Frequency at that time','frequencySnapshot',item.frequencySnapshot||med?.frequency||med?.schedule||'')}${area('Note (optional)','note',item.note||'')}<input type="hidden" name="medicationId" value="${esc(item.medicationId||'')}"><input type="hidden" name="medicationNameSnapshot" value="${esc(item.medicationNameSnapshot||med?.name||'Medication')}">`; }
 if(type==='receipt') body=`${field('Date','date',item.date||today(),'date')}${field('Amount','amount',item.amount||'','number','step="0.01" min="0"')}${field('Description','description',item.description||'')}${selectField('Category','category',['Pharmacy','Physiotherapy','Parking','Mileage','Medical supplies','Legal','Other'],item.category||'Other')}${area('Notes','notes',item.notes||'')}${photoField('Receipt photo','photo',item.photo?[item.photo]:[],false)}`;
 if(type==='appointment'){
   const kind=item.appointmentKind||((item.type||'').toLowerCase().includes('insurance')?'Insurance':'Medical');
   body=`${selectField('Appointment type','appointmentKind',['Medical','Insurance'],kind)}
   ${field('Date','date',item.date||today(),'date')}
   ${field('Time','time',item.time||'','time')}
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
 if(type==='timeline') body=`${field('Date','date',item.date||today(),'date')}${field('Event title','title',item.title||'')}${selectField('Event type','type',['Accident','Hospital / ER','Doctor','Imaging','Physiotherapy','Insurance','Lawyer','Medication','Other'],item.type||'Other')}${area('Details','notes',item.notes||'')}`;
 if(type==='task') body=`${field('Task','title',item.title||'')}${field('Due date','due',item.due||'','date')}${selectField('Priority','priority',['Low','Normal','High'],item.priority||'Normal')}${selectField('Status','done',['Open','Completed'],item.done?'Completed':'Open')}`;
 if(type==='question') body=`${area('Question','text',item.text||'')}${selectField('For','forWhom',['Doctor','Lawyer','Insurance','Physiotherapist','Other'],item.forWhom||'Doctor')}${selectField('Status','answered',['Open','Answered'],item.answered?'Answered':'Open')}${area('Answer / notes','answer',item.answer||'')}`;
 if(type==='note') body=`${field('Date','date',item.date||today(),'date')}${field('Title','title',item.title||'')}${area('Note','text',item.text||'')}`;
 modal=`<div class="modalBackdrop"><form class="modal" id="editForm" data-type="${type}" data-id="${id||''}"><div class="modalHead"><h2>${title}</h2><button type="button" class="iconBtn" data-close>✕</button></div><div class="formGrid">${body}</div><div class="modalFoot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn primary">Save</button></div></form></div>`;
 render();
}
function photoField(label,name,photos,multiple){return `<div class="field span2"><label>${label}</label><input type="file" name="${name}" accept="image/*" capture="environment" ${multiple?'multiple':''}><div class="photoGrid" style="margin-top:8px">${photos.map(p=>`<img class="photo" src="${p}">`).join('')}</div></div>`}

async function filesToData(input){return Promise.all([...input.files].map(f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)})))}

async function saveForm(form){
 const type=form.dataset.type,id=form.dataset.id, fd=new FormData(form);
 const obj=Object.fromEntries(fd.entries()); obj.id=id||uid();
 if(type==='appointment'){
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
 }
 if(type==='journal'){const existing=state.journal.find(x=>x.id===id);obj.photos=existing?.photos||[];const inp=form.elements.photos;if(inp.files.length)obj.photos=await filesToData(inp)}
 if(type==='injury'){
   obj.active=obj.active==='Active';
   obj.trackSwelling=fd.has('trackSwelling');
   obj.trackStiffness=fd.has('trackStiffness');
   obj.trackRangeOfMotion=fd.has('trackRangeOfMotion');
 }
 if(type==='injuryLog'){obj.pain=Math.max(0,Math.min(10,Number(obj.pain||0)));const existing=state.injuryLogs.find(x=>x.id===id);obj.photos=existing?.photos||[];const inp=form.elements.photos;if(inp.files.length)obj.photos=await filesToData(inp)}
 if(type==='receipt'){obj.amount=Number(obj.amount);const existing=state.receipts.find(x=>x.id===id);obj.photo=existing?.photo||'';const inp=form.elements.photo;if(inp.files.length)obj.photo=(await filesToData(inp))[0]}
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
   const local=new Date(`${obj.doseDate}T${obj.doseTime}`);
   if(Number.isNaN(local.getTime())){alert('Choose a valid date and time.');return}
   obj.dateTime=local.toISOString();delete obj.doseDate;delete obj.doseTime;obj.legacySnapshot=false;
 }
 if(type==='task') obj.done=obj.done==='Completed';
 if(type==='question') obj.answered=obj.answered==='Answered';
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',dose:'doses',receipt:'receipts',appointment:'appointments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 const arr=state[map[type]], ix=arr.findIndex(x=>x.id===id); if(ix>=0)arr[ix]=obj;else arr.push(obj);
 save(); modal=null; render(); toast('Saved');
}

function del(type,id){
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',receipt:'receipts',appointment:'appointments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 if(!confirm('Delete this item?'))return;
 if(type==='journal'){const entry=state.journal.find(x=>x.id===id);if(entry)state.injuryLogs=state.injuryLogs.filter(x=>x.date!==entry.date)} state[map[type]]=state[map[type]].filter(x=>x.id!==id); if(type==='injury')state.injuryLogs=state.injuryLogs.filter(x=>x.injuryId!==id); if(type==='medication')state.doses=state.doses.filter(d=>d.medicationId!==id); save();render();
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
 if(config.photos){journal.forEach(j=>(j.photos||[]).forEach((photo,i)=>photoItems.push(`<figure><img src="${photo}"><figcaption>${fmt(j.date)} — Daily log photo ${i+1}</figcaption></figure>`)));receipts.forEach(r=>{if(r.photo)photoItems.push(`<figure><img src="${r.photo}"><figcaption>${fmt(r.date)} — ${esc(r.description||'Receipt')}</figcaption></figure>`)})}
 const generatedDate=new Date().toLocaleString('en-CA');
 const reportPeriod=`${config.from?fmt(config.from):'Beginning'} – ${config.to?fmt(config.to):'Today'}`;
 const photoCount=photoItems.length;
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(config.title)}</title><style>
 @page{size:auto;margin:14mm 14mm 17mm}*{box-sizing:border-box}html{counter-reset:page}body{font-family:Arial,sans-serif;color:#1c2d40;margin:0;line-height:1.38;font-size:11.5px}.firstPage{border-top:8px solid #0b63ce;padding-top:14px;margin-bottom:18px}.reportLabel{display:inline-block;padding:4px 9px;border-radius:999px;background:#eaf3ff;color:#0b63ce;font-weight:bold;font-size:9px;letter-spacing:.08em}.firstPage h1{font-size:28px;color:#0b315f;margin:10px 0 3px;line-height:1.08}.sub{font-size:13px;color:#557086;margin-bottom:15px}.identityGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.identityGrid div,.snapshotCard,.stat{padding:10px 11px;border:1px solid #dbe4ee;border-radius:8px}.identityGrid span,.snapshotItem span,.stat span{display:block;color:#718096;font-size:8.5px;text-transform:uppercase;letter-spacing:.06em}.snapshotCard{margin-top:12px;background:#f7fbff}.snapshotCard h2{border:0!important;padding:0!important;margin:0 0 8px!important;font-size:16px!important}.snapshotGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.snapshotItem{padding:8px;background:#fff;border:1px solid #dce7f3;border-radius:7px}.snapshotItem strong{display:block;font-size:17px;color:#0b63ce;margin-bottom:1px}.toc{margin-top:12px}.toc h2,.reportSection h2{color:#0b315f;border-bottom:2px solid #0b63ce;padding-bottom:5px;margin:0 0 7px}.toc h2{font-size:16px}.tocGrid{display:grid;grid-template-columns:1fr 1fr;column-gap:20px}.toc div{display:flex;justify-content:space-between;border-bottom:1px dotted #9cadbf;padding:4px 0;font-size:10px}.reportSection{margin-top:16px;break-inside:auto}.reportSection h2{font-size:18px;break-after:avoid-page}.summaryGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.stat strong{font-size:18px;color:#0b63ce}.item{break-inside:avoid;margin:0 0 8px;padding:9px 10px;border:1px solid #dce5ef;border-radius:7px}.item p{margin:5px 0}.meta,.muted{color:#66798d}.timelineLine{display:grid;grid-template-columns:125px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid #e5ebf2;break-inside:avoid}.timelineLine time{color:#65788e}.medHeader{display:flex;justify-content:space-between;gap:10px}.badge{padding:3px 7px;border-radius:999px;background:#eaf3ff;color:#0b63ce;font-weight:bold;font-size:9px}.receiptTotal{font-size:16px;color:#0b315f;margin:5px 0 9px}.photoGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.photoGrid figure{margin:0;break-inside:avoid}.photoGrid img{width:100%;max-height:285px;object-fit:contain;border:1px solid #dbe4ee;border-radius:7px}.photoGrid figcaption{margin-top:4px;color:#65788e}.printHeader,.printFooter{display:none}.printBar{position:fixed;right:16px;bottom:16px}.printBar button{padding:12px 18px;background:#0b63ce;color:white;border:0;border-radius:9px;font-weight:bold}@media print{body{padding-top:5mm;padding-bottom:7mm}.printBar{display:none}.printHeader{display:block;position:fixed;top:-9mm;left:0;right:0;border-bottom:1px solid #dbe4ee;padding-bottom:2mm;color:#66798d;font-size:8.5px}.printFooter{display:flex;position:fixed;bottom:-12mm;left:0;right:0;justify-content:space-between;border-top:1px solid #dbe4ee;padding-top:2mm;color:#66798d;font-size:8px}.pageNumber:after{counter-increment:page;content:"Page " counter(page)}.firstPage{break-after:auto}.reportSection{orphans:3;widows:3}.reportSection h2{break-after:avoid}.item,.timelineLine,.stat{break-inside:avoid}}
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
 ${config.doseHistory?section('doses','Detailed Dose History',doses.map(d=>{const m=state.medications.find(x=>x.id===d.medicationId);return `<div class="timelineLine"><time>${fmtDateTime(d.dateTime)}</time><span><strong>${esc(d.medicationNameSnapshot||m?.name||'Medication')} — ${esc(d.status)}</strong><br>${esc(d.doseSnapshot||'')}${d.frequencySnapshot?' · '+esc(d.frequencySnapshot):''}${d.note?'<br>'+esc(d.note):''}</span></div>`}).join('')):''}
 ${config.appointments?section('appointments','Appointments',appointments.map(a=>`<div class="item"><strong>${fmt(a.date)} ${esc(a.time||'')} — ${esc(a.appointmentKind||a.type||'Appointment')}</strong><div class="meta">${esc(a.provider||a.insuranceCompany||'')} ${esc(a.location||a.contactName||'')}</div><p>${esc(a.notes||a.visitSummary||a.discussionNotes||'')}</p></div>`).join('')):''}
 ${config.receipts?section('receipts','Receipts and Expenses',`<p class="receiptTotal"><strong>Total: ${money(total)}</strong></p>`+receipts.map(r=>`<div class="item"><strong>${fmt(r.date)} — ${esc(r.description)} — ${money(r.amount)}</strong><div class="meta">${esc(r.category||'Other')}</div>${r.notes?`<p>${esc(r.notes)}</p>`:''}</div>`).join('')):''}
 ${config.notes?section('notes','Notes and Questions',notes.map(n=>`<div class="item"><strong>${fmt(n.date)} — ${esc(n.title)}</strong><p>${esc(n.text)}</p></div>`).join('')+state.questions.map(q=>`<div class="item"><strong>Question for ${esc(q.forWhom||'')}</strong><p>${esc(q.text)}</p>${q.answer?`<p><b>Answer:</b> ${esc(q.answer)}</p>`:''}</div>`).join('')):''}
 ${config.photos?section('photos','Photo Appendix',`<div class="photoGrid">${photoItems.join('')}</div>`):''}
 <div class="printBar"><button onclick="window.print()">Print / Save as PDF</button></div></body></html>`;
 win.document.write(html);win.document.close();setTimeout(()=>win.focus(),250);
}
function render(){
 const views={dashboard,journal,injuries,medications,receipts,appointments,timeline,tasks,notes,reports,settings,more};
 document.getElementById('app').innerHTML=views[page]();
 bind();
}
function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>nav(b.dataset.nav));
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openForm(b.dataset.add));
 document.querySelectorAll('[data-log-injury]').forEach(b=>b.onclick=()=>openForm('injuryLog','new:'+b.dataset.logInjury));
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));
 document.querySelectorAll('[data-edit-daily]').forEach(b=>b.onclick=()=>editDailyLog(b.dataset.editDaily));
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>del(b.dataset.delete,b.dataset.id));
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{modal=null;render()});
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
 document.querySelectorAll('[data-check-task]').forEach(c=>c.onchange=()=>setState(s=>{const t=s.tasks.find(x=>x.id===c.dataset.checkTask);if(t)t.done=c.checked}));
 document.querySelectorAll('[data-dose-now]').forEach(b=>b.onclick=()=>{const med=state.medications.find(m=>m.id===b.dataset.doseNow);if(!med)return;setState(s=>s.doses.push(doseSnapshot(med,b.dataset.status,new Date().toISOString())));toast(`${med.name} recorded as ${String(b.dataset.status).toLowerCase()}`)});
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
 const bb=document.getElementById('backupBtn');if(bb)bb.onclick=()=>{
   const payload={...state,backupCreatedAt:new Date().toISOString(),dataVersion:state.dataVersion||2};
   const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download=`mva-record-keeper-backup-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded');
 };
 const ri=document.getElementById('restoreInput');if(ri)ri.onchange=async()=>{try{
   if(!ri.files?.[0])return;
   const data=JSON.parse(await ri.files[0].text());
   if(!data||typeof data!=='object'||!Array.isArray(data.medications)||!Array.isArray(data.journal))throw new Error('Invalid backup');
   if(!confirm('Restore this backup? Your current records on this device will be replaced.'))return;
   state={...structuredClone(defaults),...data};migrateMedicationData();save();render();toast('Backup restored');
 }catch{alert('That file is not a valid MVA Record Keeper backup.')}finally{ri.value=''}};
 const rb=document.getElementById('resetBtn');if(rb)rb.onclick=()=>{if(confirm('Erase all MVA app data on this device?')){state=structuredClone(defaults);save();render()}};
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
render();
})();
