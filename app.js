
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
const daysBetween=(a,b)=>Math.max(0,Math.floor((new Date(b)-new Date(a))/(86400000)));

const defaults={
  profile:{accidentDate:today(),name:'',lawyer:'',claimNumber:''},
  journal:[], injuries:[], injuryLogs:[], medications:[], doses:[], receipts:[], appointments:[],
  tasks:[], questions:[], notes:[], timeline:[]
};
let state=load();
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
    <nav class="bottomNav">${[items[0],items[1],items[2],items[4],['more','•••','More']].map(i=>`<button data-nav="${i[0]}" class="${page===i[0]?'active':''}"><span>${i[1]}</span>${i[2]}</button>`).join('')}</nav>
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

function medications(){
 const meds=[...state.medications].sort((a,b)=>(a.active===false)-(b.active===false)||a.name.localeCompare(b.name));
 const history=[...state.doses].sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
 return appShell(`
 <div class="toolbar"><div><span class="pill">${state.medications.filter(m=>m.active!==false).length} active medications</span></div><button class="btn primary" data-add="medication">+ Add medication</button></div>
 <div class="medicationGrid">${meds.length?meds.map(m=>{
   const doses=history.filter(d=>d.medicationId===m.id).slice(0,8);
   return `<section class="card medicationCard ${m.active===false?'inactiveMedication':''}">
    <div class="toolbar medicationHead"><div><h3>${esc(m.name)}</h3><div class="medDose">${esc(m.dose||'Dose not entered')}</div></div><div class="actions"><button class="iconBtn" data-edit="medication" data-id="${m.id}">Edit</button><button class="iconBtn" data-delete="medication" data-id="${m.id}">Delete</button></div></div>
    <div class="medSchedule">
      <div><span>Frequency</span><strong>${esc(m.frequency||m.schedule||'Not entered')}</strong></div>
      <div><span>Usual times</span><strong>${esc(m.usualTimes||'Not entered')}</strong></div>
    </div>
    ${m.notes?`<p class="small medNotes">${esc(m.notes)}</p>`:''}
    ${m.active!==false?`<div class="doseActions">
      <button class="btn primary" type="button" data-dose-now="${m.id}" data-status="Taken">✓ Taken now</button>
      <button class="btn secondary" type="button" data-dose-now="${m.id}" data-status="Missed">Mark missed now</button>
    </div>
    <div class="customDoseLog">
      <div class="field"><label>Log a different time</label><input type="datetime-local" data-dose-time="${m.id}" value="${localDateTimeValue()}"></div>
      <div class="field"><label>Status</label><select data-dose-status="${m.id}"><option>Taken</option><option>Missed</option></select></div>
      <button class="btn secondary" type="button" data-log-dose="${m.id}">Add to history</button>
    </div>`:`<div class="inactiveBanner">This medication is inactive.</div>`}
    <div class="medHistoryHead"><strong>Recent dose history</strong><span>${state.doses.filter(d=>d.medicationId===m.id).length} records</span></div>
    ${doses.length?`<div class="doseHistory">${doses.map(d=>`<div class="doseHistoryRow"><div><strong class="${d.status==='Missed'?'missedDose':'takenDose'}">${esc(d.status)}</strong><span>${fmtDateTime(d.dateTime)}</span>${d.note?`<small>${esc(d.note)}</small>`:''}</div><button class="doseDeleteBtn" type="button" data-delete-dose="${d.id}" aria-label="Delete dose record">×</button></div>`).join('')}</div>`:`<div class="empty compactEmpty">No doses recorded yet.</div>`}
   </section>`;
 }).join(''):`<div class="empty">Add your medications to start tracking doses and exact times.</div>`}</div>
 ${history.length?`<section class="card allDoseHistory"><div class="toolbar"><div><h2>All medication history</h2><p class="muted small">Newest records appear first.</p></div></div><div class="doseHistory">${history.slice(0,30).map(d=>{const m=state.medications.find(x=>x.id===d.medicationId);return `<div class="doseHistoryRow"><div><strong>${esc(m?.name||'Medication')}</strong><span>${esc(d.status)} · ${fmtDateTime(d.dateTime)}</span></div><button class="doseDeleteBtn" type="button" data-delete-dose="${d.id}" aria-label="Delete dose record">×</button></div>`}).join('')}</div></section>`:''}
 `,'Medications','Track what you take, how often you take it, and the exact time of every dose.');
}

function receipts(){
 const total=state.receipts.reduce((s,r)=>s+Number(r.amount||0),0);
 const sorted=[...state.receipts].sort((a,b)=>b.date.localeCompare(a.date));
 return appShell(`<div class="grid grid2"><section class="card"><div class="muted small">Total expenses</div><div class="metric">${money(total)}</div></section><section class="card"><div class="muted small">Number of receipts</div><div class="metric">${state.receipts.length}</div></section></div>
 <div class="toolbar" style="margin-top:16px"><div></div><button class="btn primary" data-add="receipt">+ Add receipt</button></div>
 <div class="list">${sorted.length?sorted.map(r=>`<div class="row"><div class="rowMain" style="display:flex;gap:12px">${r.photo?`<img class="photo" src="${r.photo}">`:''}<div><div class="rowTitle">${esc(r.description)}</div><div class="rowMeta">${fmt(r.date)} · ${esc(r.category||'Other')}</div>${r.notes?`<div class="small">${esc(r.notes)}</div>`:''}</div></div><div><strong>${money(r.amount)}</strong><div class="actions" style="margin-top:8px"><button class="iconBtn" data-edit="receipt" data-id="${r.id}">Edit</button><button class="iconBtn" data-delete="receipt" data-id="${r.id}">Delete</button></div></div></div>`).join(''):`<div class="empty">No receipts recorded.</div>`}</div>`,'Receipts','Keep expense details and receipt photos together.');
}

function appointments(){
 const sorted=[...state.appointments].sort((a,b)=>a.date.localeCompare(b.date));
 return appShell(`<div class="toolbar"><div class="tabs"><button class="${tab==='all'?'active':''}" data-tab="all">All</button><button class="${tab==='upcoming'?'active':''}" data-tab="upcoming">Upcoming</button><button class="${tab==='past'?'active':''}" data-tab="past">Past</button></div><button class="btn primary" data-add="appointment">+ Add appointment</button></div>
 <div class="list">${filterAppts(sorted).length?filterAppts(sorted).map(a=>`<div class="row"><div class="rowMain"><div class="rowTitle">${esc(a.type)}</div><div class="rowMeta">${fmt(a.date)}${a.time?' · '+esc(a.time):''}</div><div>${esc(a.provider||'')}</div>${a.location?`<div class="small muted">${esc(a.location)}</div>`:''}${a.notes?`<p class="small">${esc(a.notes)}</p>`:''}</div><div class="actions"><button class="iconBtn" data-edit="appointment" data-id="${a.id}">Edit</button><button class="iconBtn" data-delete="appointment" data-id="${a.id}">Delete</button></div></div>`).join(''):`<div class="empty">No appointments in this view.</div>`}</div>`,'Appointments','Track medical, legal, insurance and therapy appointments.');
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
 return appShell(`<div class="grid grid2">
 <section class="card"><h2>Lawyer report</h2><p>Create a printable report containing your profile, timeline, journal, medications, appointments, expenses, tasks, questions and notes.</p><button class="btn primary wide" id="printReport">Generate / Print PDF</button><p class="small muted">Choose “Save as PDF” in the print window.</p></section>
 <section class="card"><h2>Summary</h2><div class="summaryBox">Journal: <strong>${state.journal.length}</strong><br>Appointments: <strong>${state.appointments.length}</strong><br>Timeline events: <strong>${state.timeline.length}</strong><br>Expenses: <strong>${money(state.receipts.reduce((s,r)=>s+Number(r.amount||0),0))}</strong></div></section>
 </div>`,'Reports','Generate a clear chronological package for your lawyer.');
}

function settings(){
 return appShell(`<div class="grid grid2">
 <section class="card"><h2>Claim information</h2><form id="profileForm" class="formGrid">
 ${field('Name','name',state.profile.name)}${field('Accident date','accidentDate',state.profile.accidentDate,'date')}
 ${field('Lawyer','lawyer',state.profile.lawyer)}${field('Claim number','claimNumber',state.profile.claimNumber)}
 <button class="btn primary span2">Save information</button></form></section>
 <section class="card"><h2>Backup & restore</h2><p>Download a backup regularly. It contains your records and attached photos.</p><div class="grid"><button class="btn secondary" id="backupBtn">Download backup</button><label class="btn secondary" style="text-align:center">Restore backup<input id="restoreInput" type="file" accept="application/json" hidden></label><button class="btn danger" id="resetBtn">Erase all app data</button></div></section>
 </div>`,'Settings','Manage your claim details and protect your records.');
}

function more(){
 return appShell(`<div class="grid grid2">${[
 ['appointments','🩺','Appointments'],['timeline','🕒','Recovery Timeline'],['tasks','✅','Tasks & Paperwork'],['notes','📝','Notes & Questions'],['reports','📄','Reports'],['settings','⚙️','Settings']
 ].map(i=>`<button class="card" data-nav="${i[0]}" style="text-align:left;border:1px solid #dde5ef"><div style="font-size:28px">${i[1]}</div><h3>${i[2]}</h3></button>`).join('')}</div>`,'More','All additional tools and records.');
}

function field(label,name,value='',type='text',extra=''){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}
function area(label,name,value='',span=true){return `<div class="field ${span?'span2':''}"><label>${label}</label><textarea name="${name}">${esc(value)}</textarea></div>`}
function selectField(label,name,options,value){return `<div class="field"><label>${label}</label><select name="${name}">${options.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`}

function openForm(type,id){
 const newInjuryId=type==='injuryLog'&&String(id||'').startsWith('new:')?String(id).slice(4):'';
 if(newInjuryId)id='';
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',receipt:'receipts',appointment:'appointments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 const arr=state[map[type]]||[], item=id?arr.find(x=>x.id===id):{};
 let body='', title=type==='injuryLog'?'Update Injury':(id?'Edit ':'Add ')+type[0].toUpperCase()+type.slice(1);
 if(type==='journal') body=`${field('Date','date',item.date||today(),'date')}${area('How was your day?','notes',item.notes||'')}${photoField('Photo (optional)','photos',item.photos||[],true)}`;
 if(type==='injury') body=`${field('Injury name','name',item.name||'')}${field('Short description (optional)','description',item.description||'')}${selectField('Status','active',['Active','Archived'],item.active===false?'Archived':'Active')}<div class="field span2"><label>Daily tracking fields</label><p class="small muted trackingHelp">Enable only the details that make sense for this injury. Enabled fields will appear in every Daily Log.</p><div class="trackingToggles"><label class="trackingToggle"><input type="checkbox" name="trackSwelling" ${item.trackSwelling?'checked':''}><span>Swelling</span></label><label class="trackingToggle"><input type="checkbox" name="trackStiffness" ${item.trackStiffness?'checked':''}><span>Stiffness</span></label><label class="trackingToggle"><input type="checkbox" name="trackRangeOfMotion" ${item.trackRangeOfMotion?'checked':''}><span>Range of motion</span></label></div></div>`;
 if(type==='injuryLog'){const injuryId=item.injuryId||newInjuryId; const injury=state.injuries.find(x=>x.id===injuryId); body=`<div class="field span2 summaryBox"><strong>${esc(injury?.name||'Injury')}</strong><div class="small muted">Update only what you want to record today.</div></div>${field('Date','date',item.date||today(),'date')}${field('Pain level (0-10)','pain',item.pain??0,'number','min="0" max="10"')}${selectField('Compared with last update','change',['Better','Same','Worse','Not sure'],item.change||'Same')}${area('Notes (optional)','notes',item.notes||'')}${photoField('Photo (optional)','photos',item.photos||[],true)}<input type="hidden" name="injuryId" value="${esc(injuryId)}">`; }
 if(type==='medication') body=`${field('Medication name','name',item.name||'')}${field('Dose','dose',item.dose||'')}${field('Frequency','frequency',item.frequency||item.schedule||'','text','placeholder="Example: Every 8 hours or 3 times daily"')}${field('Usual times','usualTimes',item.usualTimes||'','text','placeholder="Example: 7:00 AM, 3:00 PM, 11:00 PM"')}${selectField('Status','status',['Active','Inactive'],item.active===false?'Inactive':'Active')}${area('Instructions or notes','notes',item.notes||'')}`;
 if(type==='receipt') body=`${field('Date','date',item.date||today(),'date')}${field('Amount','amount',item.amount||'','number','step="0.01" min="0"')}${field('Description','description',item.description||'')}${selectField('Category','category',['Pharmacy','Physiotherapy','Parking','Mileage','Medical supplies','Legal','Other'],item.category||'Other')}${area('Notes','notes',item.notes||'')}${photoField('Receipt photo','photo',item.photo?[item.photo]:[],false)}`;
 if(type==='appointment') body=`${field('Date','date',item.date||today(),'date')}${field('Time','time',item.time||'','time')}${field('Appointment type','type',item.type||'')}${field('Provider / clinic','provider',item.provider||'')}${field('Location','location',item.location||'')}${selectField('Status','status',['Scheduled','Completed','Cancelled'],item.status||'Scheduled')}${area('Outcome / notes','notes',item.notes||'')}`;
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
   obj.active=obj.status==='Active';
   obj.schedule=obj.frequency||'';
 }
 if(type==='task') obj.done=obj.done==='Completed';
 if(type==='question') obj.answered=obj.answered==='Answered';
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',receipt:'receipts',appointment:'appointments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 const arr=state[map[type]], ix=arr.findIndex(x=>x.id===id); if(ix>=0)arr[ix]=obj;else arr.push(obj);
 save(); modal=null; render(); toast('Saved');
}

function del(type,id){
 const map={journal:'journal',injury:'injuries',injuryLog:'injuryLogs',medication:'medications',receipt:'receipts',appointment:'appointments',timeline:'timeline',task:'tasks',question:'questions',note:'notes'};
 if(!confirm('Delete this item?'))return;
 if(type==='journal'){const entry=state.journal.find(x=>x.id===id);if(entry)state.injuryLogs=state.injuryLogs.filter(x=>x.date!==entry.date)} state[map[type]]=state[map[type]].filter(x=>x.id!==id); if(type==='injury')state.injuryLogs=state.injuryLogs.filter(x=>x.injuryId!==id); if(type==='medication')state.doses=state.doses.filter(d=>d.medicationId!==id); save();render();
}

function printReport(){
 const win=window.open('','_blank');
 const sec=(title,body)=>`<section><h2>${title}</h2>${body||'<p>None recorded.</p>'}</section>`;
 const html=`<!doctype html><html><head><title>MVA Recovery Report</title><style>body{font-family:Arial,sans-serif;color:#1b2a3a;margin:36px;line-height:1.45}h1{color:#0b315f;border-bottom:4px solid #0b315f;padding-bottom:10px}h2{color:#174b7d;border-bottom:1px solid #ccd6e2;padding-bottom:5px;margin-top:28px}.item{margin:0 0 14px;padding:10px;border:1px solid #dce4ed;border-radius:8px}.meta{color:#65758a;font-size:12px}.photo{width:120px;height:120px;object-fit:cover;margin:4px}@media print{button{display:none}}</style></head><body>
 <h1>MVA Recovery Report</h1><p><strong>Prepared for:</strong> ${esc(state.profile.lawyer||'Lawyer')}<br><strong>Name:</strong> ${esc(state.profile.name||'')}<br><strong>Accident date:</strong> ${fmt(state.profile.accidentDate)}<br><strong>Claim number:</strong> ${esc(state.profile.claimNumber||'')}<br><strong>Generated:</strong> ${new Date().toLocaleString('en-CA')}</p>
 ${sec('Recovery Timeline',state.timeline.sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<div class="item"><strong>${fmt(x.date)} — ${esc(x.title)}</strong><div class="meta">${esc(x.type)}</div><p>${esc(x.notes||'')}</p></div>`).join(''))}
 ${sec('Daily Recovery Notes',state.journal.sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<div class="item"><strong>${fmt(x.date)}</strong><p>${esc(x.notes||'')}</p>${(x.photos||[]).map(p=>`<img class="photo" src="${p}">`).join('')}</div>`).join(''))}
 ${sec('Injury History',state.injuries.map(i=>`<div class="item"><strong>${esc(i.name)}</strong><div class="meta">${esc(i.description||'')}</div>${state.injuryLogs.filter(l=>l.injuryId===i.id).sort((a,b)=>a.date.localeCompare(b.date)).map(l=>`<p><strong>${fmt(l.date)} — Pain ${l.pain}/10${l.change?' — '+esc(l.change):''}</strong><br>${esc(l.notes||'')}</p>`).join('')}</div>`).join(''))}
 ${sec('Medications',state.medications.map(m=>`<div class="item"><strong>${esc(m.name)} ${esc(m.dose)}</strong><div class="meta">${esc(m.schedule||'')}</div><p>${esc(m.notes||'')}</p></div>`).join(''))}
 ${sec('Dose History',state.doses.sort((a,b)=>a.dateTime.localeCompare(b.dateTime)).map(d=>{const m=state.medications.find(x=>x.id===d.medicationId);return `<div>${new Date(d.dateTime).toLocaleString('en-CA')} — ${esc(m?.name||'Medication')} — ${esc(d.status)}</div>`}).join(''))}
 ${sec('Appointments',state.appointments.sort((a,b)=>a.date.localeCompare(b.date)).map(a=>`<div class="item"><strong>${fmt(a.date)} ${esc(a.time||'')} — ${esc(a.type)}</strong><div>${esc(a.provider||'')} ${esc(a.location||'')}</div><p>${esc(a.notes||'')}</p></div>`).join(''))}
 ${sec('Receipts and Expenses',`<p><strong>Total: ${money(state.receipts.reduce((s,r)=>s+Number(r.amount||0),0))}</strong></p>`+state.receipts.map(r=>`<div class="item"><strong>${fmt(r.date)} — ${esc(r.description)} — ${money(r.amount)}</strong><div class="meta">${esc(r.category)}</div>${r.photo?`<img class="photo" src="${r.photo}">`:''}</div>`).join(''))}
 ${sec('Tasks',state.tasks.map(t=>`<div>${t.done?'☑':'☐'} ${esc(t.title)} ${t.due?'— '+fmt(t.due):''}</div>`).join(''))}
 ${sec('Questions',state.questions.map(q=>`<div class="item"><strong>${esc(q.text)}</strong><div class="meta">For: ${esc(q.forWhom)} · ${q.answered?'Answered':'Open'}</div><p>${esc(q.answer||'')}</p></div>`).join(''))}
 ${sec('General Notes',state.notes.map(n=>`<div class="item"><strong>${fmt(n.date)} — ${esc(n.title)}</strong><p>${esc(n.text)}</p></div>`).join(''))}
 <button onclick="window.print()">Print / Save as PDF</button></body></html>`;
 win.document.write(html);win.document.close();setTimeout(()=>win.print(),500);
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
 document.querySelectorAll('[data-dose-now]').forEach(b=>b.onclick=()=>setState(s=>s.doses.push({id:uid(),medicationId:b.dataset.doseNow,status:b.dataset.status,dateTime:new Date().toISOString()})));
 document.querySelectorAll('[data-log-dose]').forEach(b=>b.onclick=()=>{
   const id=b.dataset.logDose;
   const time=document.querySelector(`[data-dose-time="${id}"]`)?.value;
   const status=document.querySelector(`[data-dose-status="${id}"]`)?.value||'Taken';
   if(!time){alert('Choose a date and time first.');return;}
   setState(s=>s.doses.push({id:uid(),medicationId:id,status,dateTime:new Date(time).toISOString()}));
 });
 document.querySelectorAll('[data-delete-dose]').forEach(b=>b.onclick=()=>{
   if(!confirm('Delete this dose record?'))return;
   state.doses=state.doses.filter(d=>d.id!==b.dataset.deleteDose);save();render();
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
 const f=document.getElementById('editForm');if(f)f.onsubmit=async e=>{e.preventDefault();await saveForm(f)};
 const pf=document.getElementById('profileForm');if(pf)pf.onsubmit=e=>{e.preventDefault();state.profile={...state.profile,...Object.fromEntries(new FormData(pf))};save();toast('Saved')};
 const p=document.getElementById('printReport');if(p)p.onclick=printReport;
 const bb=document.getElementById('backupBtn');if(bb)bb.onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download=`mva-record-keeper-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href)};
 const ri=document.getElementById('restoreInput');if(ri)ri.onchange=async()=>{try{const data=JSON.parse(await ri.files[0].text());state={...defaults,...data};save();render();toast('Backup restored')}catch{alert('That backup file could not be read.')}};
 const rb=document.getElementById('resetBtn');if(rb)rb.onclick=()=>{if(confirm('Erase all MVA app data on this device?')){state=structuredClone(defaults);save();render()}};
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
render();
})();
