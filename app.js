(function(){
"use strict";
const UNIT = 15*60000; // unidad base: 15 minutos
const VALUES = {alto:"Importante", urgente:"Urgente", bajo:"Prescindible", "":"Neutro"};
const VALUE_VARS = {alto:"var(--good)", urgente:"var(--warn)", bajo:"var(--bad)", "":"var(--none)"};
const DEFAULT_CATS = [
  {id:"c-violin", value:"alto", name:"Violín", color:"#2f4bd8"},
  {id:"c-formacion", value:"alto", name:"Formación", color:"#1f9e8f"},
  {id:"c-redes-util", value:"alto", name:"Redes útil", color:"#0f7cbd"},
  {id:"c-reuniones", value:"urgente", name:"Reuniones", color:"#8a4fd1"},
  {id:"c-correo", value:"urgente", name:"Correo y mensajes", color:"#d1781f"},
  {id:"c-organizar", value:"urgente", name:"Organizar", color:"#6b7a8f"},
  {id:"c-distracciones", value:"bajo", name:"Distracciones", color:"#d64561"},
  {id:"c-descanso", value:"", name:"Descanso", color:"#4c9a2a"},
  {id:"c-personal", value:"", name:"Personal", color:"#b58a1b"}
];

let settings = {categories: DEFAULT_CATS.map(c=>({...c})), running:null};
let days = {};          // "YYYY-MM-DD" -> {date, entries:[bloques de cronómetro], units:{"catId|valor": n}}
let mode = "local";     // "local" (solo este navegador) | "cloud" (Supabase)
let dayCursor = todayStr();
let weekCursor = weekStart(todayStr());
let currentTab = "hoy";
let popCat = null;

/* ---------- fechas y formato ---------- */
function pad(n){return String(n).padStart(2,"0")}
function dateStr(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function todayStr(){return dateStr(new Date())}
function parseDate(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}
function addDays(s,n){const d=parseDate(s);d.setDate(d.getDate()+n);return dateStr(d)}
function weekStart(s){const d=parseDate(s);const wd=(d.getDay()+6)%7;d.setDate(d.getDate()-wd);return dateStr(d)}
function hhmm(ts){const d=new Date(ts);return pad(d.getHours())+":"+pad(d.getMinutes())}
function fmtDur(ms){
  const m=Math.round(ms/60000);
  if(m<60) return m+" min";
  const h=Math.floor(m/60), r=m%60;
  return r? h+" h "+r+" min" : h+" h";
}
function fmtHours(ms){return (ms/3600000).toLocaleString("es-ES",{maximumFractionDigits:1, minimumFractionDigits:1})+" h"}
function fmtUnits(ms){const u=ms/UNIT; return (Math.round(u*10)/10).toLocaleString("es-ES")}
function fmtClock(ms){const s=Math.max(0,Math.floor(ms/1000));return pad(Math.floor(s/3600))+":"+pad(Math.floor(s/60)%60)+":"+pad(s%60)}
const DAYNAMES=["lun","mar","mié","jue","vie","sáb","dom"];
const MONTHS=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function longDay(s){
  const d=parseDate(s);
  const names=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const label = s===todayStr()? "Hoy" : s===addDays(todayStr(),-1)? "Ayer" : names[d.getDay()][0].toUpperCase()+names[d.getDay()].slice(1);
  return label+", "+d.getDate()+" "+MONTHS[d.getMonth()];
}
function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function catValue(id){ const c=settings.categories.find(c=>c.id===id); if(c && typeof c.value==="string") return c.value; const d=DEFAULT_CATS.find(c=>c.id===id); return d? d.value : ""; }
function catById(id){return settings.categories.find(c=>c.id===id) || {id, name:"Categoría borrada", color:"#9aa1b2"}}

/* ---------- guardado: copia local + Supabase ---------- */
const CFG = window.MEDIDOR_CONFIG || {};
let sb = null, userId = null, userEmail = "";
let settingsDirty = false;
const pendingDays = new Set();
const queues = {};
const dayTimers = {}, dayVer = {};
let online = navigator.onLine !== false;

function clone(o){return JSON.parse(JSON.stringify(o))}
function cacheKey(){return "medidor-v2:"+(userId||"local")}
function saveCache(){
  try{ localStorage.setItem(cacheKey(), JSON.stringify({settings, days, pending:[...pendingDays], settingsDirty})); }catch(e){}
}
function loadCache(){
  try{
    const raw=localStorage.getItem(cacheKey()); if(!raw) return false;
    const o=JSON.parse(raw);
    if(o.settings && Array.isArray(o.settings.categories)) settings=o.settings;
    if(o.days) days=o.days;
    (o.pending||[]).forEach(d=>pendingDays.add(d));
    settingsDirty=!!o.settingsDirty;
    return true;
  }catch(e){ return false; }
}
function setStatus(t, state){
  const el=document.getElementById("status"); el.textContent=t;
  el.style.setProperty("--sync", state==="ok"?"var(--good)":state==="warn"?"var(--warn)":"var(--none)");
}
function updateStatus(){
  if(mode!=="cloud"){ setStatus("Solo en este navegador","warn"); return; }
  if(!online) setStatus("Sin conexión: se guardará al volver","warn");
  else if(pendingDays.size||settingsDirty) setStatus("Guardando…","");
  else setStatus("Sincronizado","ok");
}
function enqueue(key, fn){
  const p=(queues[key]||Promise.resolve()).then(fn).catch(err=>{ console.warn(err); online=false; updateStatus(); });
  queues[key]=p; return p;
}
function flushSettings(){
  if(mode!=="cloud"||!settingsDirty) return;
  enqueue("settings", async()=>{
    const body=clone(settings);
    const {error}=await sb.from("settings").upsert({user_id:userId, data:body, updated_at:new Date().toISOString()});
    if(error) throw error;
    if(JSON.stringify(body)===JSON.stringify(settings)) settingsDirty=false;
    online=true; saveCache(); updateStatus();
  });
}
function flushDay(date){
  if(mode!=="cloud") return;
  const v=dayVer[date]||0;
  enqueue("day:"+date, async()=>{
    const d=days[date];
    let res;
    if(dayIsEmpty(d)) res=await sb.from("days").delete().eq("user_id",userId).eq("date",date);
    else res=await sb.from("days").upsert({user_id:userId, date, data:clone(d), updated_at:new Date().toISOString()});
    if(res.error) throw res.error;
    if((dayVer[date]||0)===v) pendingDays.delete(date);
    online=true; saveCache(); updateStatus();
  });
}
function flushAll(){ flushSettings(); [...pendingDays].forEach(flushDay); }
function saveSettings(){
  settingsDirty = mode==="cloud";
  saveCache(); flushSettings(); updateStatus();
}
function dayIsEmpty(d){return !d || (!(d.entries||[]).length && !Object.keys(d.units||{}).length)}
function saveDay(date, delay){
  if(mode==="cloud"){
    pendingDays.add(date);
    dayVer[date]=(dayVer[date]||0)+1;
    clearTimeout(dayTimers[date]);
    dayTimers[date]=setTimeout(()=>flushDay(date), delay||0);
  }
  saveCache(); updateStatus();
}
// Trae lo último de Supabase (al abrir y cada vez que vuelves a la app)
let refreshing=false;
async function refresh(){
  if(mode!=="cloud"||refreshing) return;
  refreshing=true;
  try{
    const [s, d] = await Promise.all([
      sb.from("settings").select("data").eq("user_id",userId).maybeSingle(),
      sb.from("days").select("date,data").eq("user_id",userId).order("date",{ascending:false}).limit(500)
    ]);
    if(s.error) throw s.error;
    if(d.error) throw d.error;
    online=true;
    if(s.data && s.data.data && !settingsDirty){
      const r=s.data.data;
      settings={categories: Array.isArray(r.categories)&&r.categories.length? r.categories : DEFAULT_CATS.map(c=>({...c})), running: r.running||null};
    } else if(!s.data){ settingsDirty=true; }
    const next={};
    (d.data||[]).forEach(row=>{ if(row.data && !dayIsEmpty(row.data)) next[row.date]=row.data; });
    pendingDays.forEach(date=>{ if(days[date]) next[date]=days[date]; else delete next[date]; });
    days=next;
    saveCache();
    flushAll();
    updateStatus();
    if(!dlg.open) renderAll(); else { renderNow(); renderReg(); }
  }catch(e){
    console.warn(e); online=false; updateStatus();
  }finally{ refreshing=false; }
}
function setStatusIdle(){ updateStatus(); }
function dayDoc(date){
  if(!days[date]) days[date]={date, entries:[], units:{}};
  if(!days[date].entries) days[date].entries=[];
  if(!days[date].units) days[date].units={};
  return days[date];
}
function cleanupDay(date){ if(dayIsEmpty(days[date])) delete days[date]; }

/* ---------- unidades ---------- */
function unitsOf(date, cat){
  const u=(days[date]&&days[date].units)||{}; let n=0;
  for(const k in u){ if(k.split("|")[0]===cat) n+=u[k]; }
  return n;
}
function addUnit(cat){
  if(dayCursor>todayStr()) return;
  const d=dayDoc(dayCursor); const key=cat+"|";
  d.units[key]=(d.units[key]||0)+1;
  popCat=cat;
  saveDay(dayCursor, 700);
  renderReg(); renderTab();
}
function removeUnit(cat){
  const d=days[dayCursor]; if(!d||!d.units) return;
  let key = d.units[cat+"|"] ? cat+"|" : Object.keys(d.units).find(k=>k.split("|")[0]===cat && d.units[k]>0);
  if(!key) return;
  d.units[key]--; if(d.units[key]<=0) delete d.units[key];
  saveDay(dayCursor, 700);
  cleanupDay(dayCursor);
  renderReg(); renderTab();
}

/* ---------- cronómetro ---------- */
function addEntry(e){
  const date=dateStr(new Date(e.start));
  const d=dayDoc(date);
  d.entries.push(e); d.entries.sort((a,b)=>a.start-b.start);
  saveDay(date);
}
function removeEntry(id){
  for(const date in days){
    const es=days[date].entries||[]; const i=es.findIndex(x=>x.id===id);
    if(i>=0){ es.splice(i,1); saveDay(date); cleanupDay(date); return; }
  }
}
function findEntry(id){
  for(const date in days){const e=(days[date].entries||[]).find(x=>x.id===id); if(e) return e;}
  return null;
}
function finishRunning(end){
  const r=settings.running; if(!r) return;
  settings.running=null;
  if(end-r.start>=30000) addEntry({id:uid(), cat:r.catId, note:r.note||"", start:r.start, end});
}
function toggleTimer(cat){
  const now=Date.now(); const r=settings.running;
  if(r && r.catId===cat) finishRunning(now);
  else { if(r) finishRunning(now); settings.running={catId:cat, note:"", start:now}; }
  saveSettings(); renderAll();
}

/* ---------- datos para resúmenes ---------- */
// Devuelve partidas {cat, value, ms, date, kind} entre dos fechas (fin excluido)
function itemsBetween(from, toExcl){
  const out=[];
  for(const date in days){
    if(date<from||date>=toExcl) continue;
    const d=days[date];
    for(const k in (d.units||{})){ const [cat,value]=k.split("|"); out.push({cat, value:catValue(cat), ms:d.units[k]*UNIT, date, kind:"unit", n:d.units[k]}); }
    (d.entries||[]).forEach(e=>out.push({cat:e.cat, value:catValue(e.cat), ms:e.end-e.start, date, kind:"timer", e}));
  }
  const r=settings.running;
  if(r){ const date=dateStr(new Date(r.start)); if(date>=from&&date<toExcl) out.push({cat:r.catId, value:catValue(r.catId), ms:Date.now()-r.start, date, kind:"live"}); }
  return out;
}
function catMsOn(date, cat){ return itemsBetween(date, addDays(date,1)).filter(i=>i.cat===cat).reduce((s,i)=>s+i.ms,0); }

/* ---------- render: cronómetro ---------- */
function renderNow(){
  const el=document.getElementById("now");
  const r=settings.running;
  const focused=document.activeElement;
  if(r && focused && focused.id==="note" && el.dataset.start===String(r.start)){
    return;
  }
  el.dataset.start = r? String(r.start) : "";
  if(!r){
    el.style.borderLeftColor="var(--line)";
    el.innerHTML='<div class="now-row"><div><div class="now-label">Cronómetro</div><div class="now-cat" style="color:var(--muted)">Parado</div></div><div class="clock" style="color:var(--muted)">00:00:00</div></div>'+
      '<p class="hint">Pulsa «Cronómetro» en una categoría para medir lo que estás haciendo ahora.</p>';
    return;
  }
  const c=catById(r.catId);
  el.style.borderLeftColor=c.color;
  el.innerHTML =
    '<div class="now-row"><div><div class="now-label">Cronómetro · desde las '+hhmm(r.start)+'</div><div class="now-cat">'+esc(c.name)+'</div></div><div style="text-align:right"><div class="clock" id="clock">'+fmtClock(Date.now()-r.start)+'</div><div class="now-units num" id="clock-u">'+fmtUnits(Date.now()-r.start)+' unidades</div></div></div>'+
    '<div class="now-row"><span class="pill '+(catValue(r.catId)||"neutro")+'">'+VALUES[catValue(r.catId)]+'</span><button class="btn primary" id="stop">Parar</button></div>'+
    '<input class="note" id="note" type="text" maxlength="140" placeholder="Nota rápida (opcional)" value="'+esc(r.note)+'">';
  document.getElementById("stop").addEventListener("click",()=>{finishRunning(Date.now()); saveSettings(); renderAll();});
  let t=null; const note=document.getElementById("note");
  note.addEventListener("input",()=>{ clearTimeout(t); t=setTimeout(()=>{ if(settings.running){settings.running.note=note.value; saveSettings();} },800); });
}
function tick(){
  if(!settings.running) return;
  const ms=Date.now()-settings.running.start;
  const c=document.getElementById("clock"); if(c) c.textContent=fmtClock(ms);
  const u=document.getElementById("clock-u"); if(u) u.textContent=fmtUnits(ms)+" unidades";
}

/* ---------- render: registro por unidades ---------- */
function renderReg(){
  const isToday = dayCursor===todayStr();
  document.getElementById("d-label").textContent=longDay(dayCursor);
  document.getElementById("d-next").disabled=isToday;
  const items=itemsBetween(dayCursor, addDays(dayCursor,1));
  const total=items.reduce((s,i)=>s+i.ms,0);
  document.getElementById("c-units").textContent=fmtDur(total);
  document.getElementById("c-lbl").textContent=fmtUnits(total)+(Math.abs(total/UNIT-1)<1e-9?" unidad":" unidades")+(isToday?" hoy":"");


  const running = settings.running && settings.running.catId;
  const el=document.getElementById("cats");
  el.innerHTML=settings.categories.map(c=>{
    const ms=items.filter(i=>i.cat===c.id).reduce((s,i)=>s+i.ms,0);
    const manual=unitsOf(dayCursor,c.id);
    const isRun = running===c.id;
    return '<div class="cat'+(ms>0?" has":"")+(isRun?" running":"")+'" style="--c:'+esc(c.color)+'">'+
      '<button class="cat-main" data-add="'+esc(c.id)+'" aria-label="Sumar 15 minutos a '+esc(c.name)+'">'+
        '<span style="min-width:0"><span class="cat-name"><span class="dot" style="background:'+esc(c.color)+'"></span><span class="cn">'+esc(c.name)+'</span></span>'+
        '<span class="cat-sub num">'+(ms>0?fmtDur(ms):"Toca: +15 min")+' · <span class="vtag '+(catValue(c.id)||"neutro")+'">'+VALUES[catValue(c.id)]+'</span></span></span>'+
        '<span class="count num'+(popCat===c.id?" pop":"")+'">'+fmtUnits(ms)+'</span>'+
      '</button>'+
      '<div class="cat-actions">'+
        '<button data-minus="'+esc(c.id)+'" '+(manual>0?"":"disabled")+' aria-label="Quitar una unidad de '+esc(c.name)+'">− 1</button>'+
        (isToday||isRun ? '<button data-timer="'+esc(c.id)+'" class="'+(isRun?"stop":"")+'" aria-label="'+(isRun?"Parar cronómetro de ":"Iniciar cronómetro en ")+esc(c.name)+'">'+(isRun?"■ Parar":"▶ Crono")+'</button>' : "")+
      '</div></div>';
  }).join("");
  popCat=null;
  el.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>addUnit(b.dataset.add));
  el.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>removeUnit(b.dataset.minus));
  el.querySelectorAll("[data-timer]").forEach(b=>b.onclick=()=>toggleTimer(b.dataset.timer));
}
document.getElementById("d-prev").onclick=()=>{dayCursor=addDays(dayCursor,-1); renderReg(); renderTab();};
document.getElementById("d-next").onclick=()=>{ if(dayCursor<todayStr()){dayCursor=addDays(dayCursor,1); renderReg(); renderTab();} };

/* ---------- pestaña Día ---------- */
function renderDay(){
  const el=document.getElementById("p-hoy");
  const items=itemsBetween(dayCursor, addDays(dayCursor,1));
  const total=items.reduce((s,i)=>s+i.ms,0);
  const byVal={alto:0,urgente:0,bajo:0,"":0}, byCat={};
  items.forEach(i=>{byVal[i.value]+=i.ms; byCat[i.cat]=(byCat[i.cat]||0)+i.ms;});
  byVal.prod=byVal.alto+byVal.urgente; // Productivo = Importante + Urgente
  const pct=v=>total?Math.round(byVal[v]/total*100):0;
  let html='<div class="tiles tiles-2">'+
    '<div class="tile"><div class="k">Total del día</div><div class="v num">'+fmtDur(total)+'</div></div>'+
    '<div class="tile"><div class="k">Neutro</div><div class="v num" style="color:var(--muted)">'+pct("")+'%</div><div class="k num">'+fmtDur(byVal[""])+'</div></div>'+
    '<div class="tile"><div class="k">Productivo</div><div class="v num" style="color:var(--good)">'+pct("prod")+'%</div><div class="k num">'+fmtDur(byVal.prod)+'</div></div>'+
    '<div class="tile"><div class="k">Prescindible</div><div class="v num" style="color:var(--bad)">'+pct("bajo")+'%</div><div class="k num">'+fmtDur(byVal.bajo)+'</div></div>'+
  '</div>';
  if(!items.length){
    html+='<div class="empty">'+(dayCursor===todayStr()?"Aún no hay nada hoy. Toca una categoría de arriba para sumar 15 minutos.":"No hay nada registrado este día. Puedes añadirlo ahora tocando las categorías de arriba.")+'</div>';
    el.innerHTML=html; return;
  }
  const cats=Object.keys(byCat).sort((a,b)=>byCat[b]-byCat[a]); const max=byCat[cats[0]];
  html+='<div class="card"><h2 style="margin-bottom:12px">Reparto del día</h2><div class="bars">'+cats.map(id=>{
    const c=catById(id), ms=byCat[id];
    return '<div class="bar-row"><span>'+esc(c.name)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+(ms/max*100).toFixed(1)+'%;background:'+esc(c.color)+'"></div></div><span class="bar-val">'+fmtUnits(ms)+' u · '+fmtDur(ms)+'</span></div>';
  }).join("")+'</div></div>';
  const timers=items.filter(i=>i.kind!=="unit").sort((a,b)=>(a.e?a.e.start:Infinity)-(b.e?b.e.start:Infinity));
  if(timers.length){
    html+='<div class="card" style="display:flex;flex-direction:column;gap:8px"><h2>Bloques de cronómetro</h2><div class="list">'+timers.map(i=>{
      const c=catById(i.cat); const live=i.kind==="live"; const e=i.e;
      return '<div class="entry" style="--c:'+esc(c.color)+'"><span class="time num">'+(live?hhmm(settings.running.start)+"–ahora":hhmm(e.start)+"–"+hhmm(e.end))+'</span>'+
        '<div><div class="name">'+esc(c.name)+(i.value?'<span class="pill '+i.value+'">'+VALUES[i.value]+'</span>':"")+(live?'<span class="pill live">En curso</span>':"")+'</div>'+
        '<div class="sub num">'+fmtDur(i.ms)+' · '+fmtUnits(i.ms)+' unidades'+(e&&e.note?" · "+esc(e.note):"")+'</div></div>'+
        (live?'<span></span>':'<button class="btn small" data-edit="'+esc(e.id)+'">Editar</button>')+'</div>';
    }).join("")+'</div></div>';
  }
  el.innerHTML=html;
  el.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openDialog(b.dataset.edit));
}

/* ---------- pestaña Semana ---------- */
function exampleWeek(ws){
  const plan=[
    [["c-violin",8,"alto"],["c-correo",4,"urgente"],["c-reuniones",4,""],["c-distracciones",3,"bajo"],["c-organizar",2,""]],
    [["c-reuniones",6,""],["c-violin",6,"alto"],["c-correo",4,"urgente"],["c-redes-util",3,"alto"],["c-distracciones",4,"bajo"]],
    [["c-violin",10,"alto"],["c-formacion",4,"alto"],["c-correo",3,"urgente"],["c-distracciones",2,"bajo"]],
    [["c-reuniones",5,""],["c-violin",6,"alto"],["c-correo",4,"bajo"],["c-organizar",3,""],["c-distracciones",5,"bajo"]],
    [["c-violin",8,"alto"],["c-redes-util",4,"alto"],["c-correo",3,"urgente"],["c-descanso",2,""]],
    [["c-violin",4,"alto"],["c-personal",10,"alto"],["c-distracciones",4,"bajo"]],
    [["c-personal",10,"alto"],["c-formacion",3,"alto"],["c-descanso",4,""]]
  ];
  const out=[];
  plan.forEach((bl,i)=>bl.forEach(([cat,n,value])=>out.push({cat,value:catValue(cat),ms:n*UNIT,date:addDays(ws,i),kind:"unit"})));
  return out;
}
function renderWeek(){
  const el=document.getElementById("p-semana");
  const ws=weekCursor, we=addDays(ws,7);
  const demo = Object.keys(days).length===0;
  const items = demo ? exampleWeek(ws) : itemsBetween(ws,we);
  const total=items.reduce((s,i)=>s+i.ms,0);
  const byCat={}, byVal={alto:0,urgente:0,bajo:0,"":0,prod:0}, byDay=Array.from({length:7},()=>({}));
  items.forEach(i=>{
    byCat[i.cat]=(byCat[i.cat]||0)+i.ms; byVal[i.value]+=i.ms; byVal.prod=(byVal.prod||0)+((i.value==="alto"||i.value==="urgente")?i.ms:0);
    const di=Math.round((parseDate(i.date)-parseDate(ws))/86400000);
    if(di>=0&&di<7) byDay[di][i.cat]=(byDay[di][i.cat]||0)+i.ms;
  });
  const cats=Object.keys(byCat).sort((a,b)=>byCat[b]-byCat[a]);
  const d0=parseDate(ws), d6=parseDate(addDays(ws,6));
  const isThisWeek = ws===weekStart(todayStr());
  let html='';
  if(demo) html+='<div class="banner"><strong>Datos de ejemplo.</strong> Así se verá tu semana. En cuanto sumes tu primera unidad, aparecerán aquí tus datos reales.</div>';
  html+='<div class="nav"><button class="btn small" id="w-prev" aria-label="Semana anterior">←</button><strong>'+(isThisWeek?"Esta semana":"Semana")+' · '+d0.getDate()+' '+MONTHS[d0.getMonth()]+' – '+d6.getDate()+' '+MONTHS[d6.getMonth()]+'</strong><button class="btn small" id="w-next" aria-label="Semana siguiente" '+(isThisWeek?"disabled":"")+'>→</button></div>';
  if(!items.length){ html+='<div class="empty">No hay nada registrado esta semana.</div>'; el.innerHTML=html; bindWeekNav(); return; }
  const activeDays=byDay.filter(d=>Object.keys(d).length).length||1;
  html+='<div class="tiles">'+
    '<div class="tile"><div class="k">Total registrado</div><div class="v num">'+fmtHours(total)+'</div></div>'+
    '<div class="tile"><div class="k">Unidades de 15 min</div><div class="v num">'+fmtUnits(total)+'</div></div>'+
    '<div class="tile"><div class="k">Productivo</div><div class="v num" style="color:var(--good)">'+Math.round(byVal.prod/total*100)+'%</div></div>'+
    '<div class="tile"><div class="k">Prescindible</div><div class="v num" style="color:var(--bad)">'+Math.round(byVal.bajo/total*100)+'%</div></div>'+
  '</div>';
  const top=catById(cats[0]); const ins=[];
  ins.push('Donde más tiempo se te fue: <strong>'+esc(top.name)+'</strong>, con '+fmtHours(byCat[cats[0]])+' ('+Math.round(byCat[cats[0]]/total*100)+'% del total).');
  if(byVal.bajo>0) ins.push('Marcaste como prescindible <strong>'+fmtHours(byVal.bajo)+'</strong> ('+fmtUnits(byVal.bajo)+' unidades). Es el primer tiempo que puedes recuperar.');
  if(settings.categories.some(c=>c.id==="c-violin")){ const vi=byCat["c-violin"]||0; ins.push('Violín: <strong>'+fmtHours(vi)+'</strong> en la semana ('+fmtHours(vi/activeDays)+' de media por día registrado).'); }
  if(byCat["c-distracciones"]) ins.push('Distracciones: <strong>'+fmtHours(byCat["c-distracciones"])+'</strong> ('+fmtUnits(byCat["c-distracciones"])+' unidades).');
  html+='<div class="card"><h2 style="margin-bottom:8px">Qué te dice esta semana</h2><ul class="insights">'+ins.map(i=>'<li>'+i+'</li>').join("")+'</ul></div>';
  const maxCat=byCat[cats[0]];
  html+='<div class="card"><h2 style="margin-bottom:12px">Por categoría</h2><div class="bars">'+cats.map(id=>{
    const c=catById(id), ms=byCat[id];
    return '<div class="bar-row"><span>'+esc(c.name)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+(ms/maxCat*100).toFixed(1)+'%;background:'+esc(c.color)+'"></div></div><span class="bar-val">'+fmtHours(ms)+' · '+Math.round(ms/total*100)+'%</span></div>';
  }).join("")+'</div></div>';
  const vorder=["prod","","bajo"];
  const VNAME={prod:"Productivo","":"Neutro",bajo:"Prescindible"}, VCOL={prod:"var(--good)","":"var(--none)",bajo:"var(--bad)"};
  html+='<div class="card"><h2 style="margin-bottom:12px">Por valor</h2><div class="stack" role="img" aria-label="Reparto del tiempo por valor">'+
    vorder.filter(v=>byVal[v]>0).map(v=>'<div title="'+VNAME[v]+': '+fmtHours(byVal[v])+'" style="width:'+(byVal[v]/total*100).toFixed(2)+'%;background:'+VCOL[v]+'"></div>').join("")+
    '</div><div class="legend" style="margin-top:10px">'+vorder.map(v=>'<span style="--sw:'+VCOL[v]+'">'+VNAME[v]+' · <span class="num">'+fmtHours(byVal[v])+' · '+Math.round(byVal[v]/total*100)+'%</span></span>').join("")+'</div></div>';
  const dayTotals=byDay.map(d=>Object.values(d).reduce((a,b)=>a+b,0));
  const maxH=Math.max(1,Math.ceil(Math.max(...dayTotals)/3600000));
  html+='<div class="card"><h2 style="margin-bottom:12px">Por día</h2><div class="days">'+
    '<div class="axis num"><span>'+maxH+' h</span><span>'+(maxH/2).toLocaleString("es-ES")+' h</span><span>0 h</span></div>'+
    byDay.map((d,i)=>{
      const parts=Object.keys(d).sort((a,b)=>d[b]-d[a]);
      return '<div class="daycol"><div class="daystack" style="height:'+(dayTotals[i]/(maxH*3600000)*140).toFixed(1)+'px" title="'+fmtHours(dayTotals[i])+'">'+
        parts.map(id=>'<div style="flex:'+d[id]+' 0 0;background:'+esc(catById(id).color)+'"></div>').join("")+
        '</div><span class="daylbl">'+DAYNAMES[i]+'</span></div>';
    }).join("")+'</div><div class="legend" style="margin-top:10px">'+cats.map(id=>'<span style="--sw:'+esc(catById(id).color)+'">'+esc(catById(id).name)+'</span>').join("")+'</div></div>';
  el.innerHTML=html; bindWeekNav();
}
function bindWeekNav(){
  document.getElementById("w-prev").onclick=()=>{weekCursor=addDays(weekCursor,-7);renderWeek();};
  document.getElementById("w-next").onclick=()=>{ if(weekCursor<weekStart(todayStr())){weekCursor=addDays(weekCursor,7);renderWeek();} };
}

/* ---------- pestaña Ajustes ---------- */
let confirmWipe=false;
function renderSettings(){
  const el=document.getElementById("p-ajustes");
  el.innerHTML =
    '<div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Categorías</h2><p class="hint">Cada categoría tiene su valor: Importante, Urgente, Prescindible o Neutro. Si cambias el valor de una categoría, se recalcula también todo lo que ya registraste en ella.</p>'+
    settings.categories.map((c,i)=>
      '<div class="catedit"><input type="color" id="cc-'+i+'" value="'+esc(c.color)+'" aria-label="Color de '+esc(c.name)+'">'+
      '<input type="text" id="cn-'+i+'" value="'+esc(c.name)+'" maxlength="40" aria-label="Nombre de la categoría">'+
      '<select id="cv-'+i+'" class="vselect" aria-label="Valor de '+esc(c.name)+'">'+["alto","urgente","bajo",""].map(v=>'<option value="'+v+'"'+(catValue(c.id)===v?" selected":"")+'>'+VALUES[v]+'</option>').join("")+'</select>'+
      '<button class="btn small danger" data-del="'+i+'" '+(settings.categories.length<=1?"disabled":"")+'>Quitar</button></div>'
    ).join("")+
    '<div class="row"><button class="btn" id="cat-add">Añadir categoría</button></div>'+
    '<p class="hint">Si quitas una categoría, lo que ya registraste se conserva y aparece como «Categoría borrada».</p></div>'+
    '<div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Exportar tus datos</h2><p class="hint">Copia todo en formato CSV para pegarlo en Excel o Google Sheets. Cada fila es una categoría en un día, con sus unidades y minutos.</p>'+
    '<div class="row"><button class="btn" id="csv-copy">Copiar CSV</button><span class="hint" id="csv-msg"></span></div><textarea id="csv-box" hidden readonly aria-label="Datos en CSV"></textarea></div>'+
    '<div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Tu cuenta</h2><p class="hint">'+
    (mode==="cloud" ? "Has entrado como <strong>"+esc(userEmail)+"</strong>. Tus datos se guardan en tu base de datos de Supabase y los verás igual en el móvil y en el ordenador." :
     "Ahora mismo se guarda solo en este navegador, porque falta configurar Supabase en el archivo config.js.")+
    '</p><div class="row"><button class="btn primary" id="app-update">Actualizar la app</button>'+(mode==="cloud"?'<button class="btn" id="logout">Cerrar sesión</button>':'')+'<button class="btn danger" id="wipe">'+(confirmWipe?"Pulsa otra vez para borrarlo todo":"Borrar todos los registros")+'</button></div></div>';
  settings.categories.forEach((c,i)=>{
    const n=document.getElementById("cn-"+i), col=document.getElementById("cc-"+i);
    n.addEventListener("change",()=>{ const v=n.value.trim(); if(v){settings.categories[i].name=v; saveSettings(); renderNow(); renderReg();} else n.value=settings.categories[i].name; });
    col.addEventListener("change",()=>{ settings.categories[i].color=col.value; saveSettings(); renderNow(); renderReg(); });
    const sel=document.getElementById("cv-"+i);
    sel.addEventListener("change",()=>{ settings.categories[i].value=sel.value; saveSettings(); renderNow(); renderReg(); });
  });
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
    const i=+b.dataset.del; const c=settings.categories[i];
    if(settings.running && settings.running.catId===c.id) finishRunning(Date.now());
    settings.categories.splice(i,1); saveSettings(); renderAll();
  });
  document.getElementById("cat-add").onclick=()=>{
    const palette=["#0f7cbd","#c2410c","#7c3aed","#0e9f6e","#be185d","#a16207"];
    settings.categories.push({id:"c-"+uid(), name:"Nueva categoría", value:"", color:palette[settings.categories.length%palette.length]});
    saveSettings(); renderAll();
    const last=document.getElementById("cn-"+(settings.categories.length-1)); if(last){last.focus(); last.select();}
  };
  document.getElementById("csv-copy").onclick=async()=>{
    const csv=buildCsv(); const box=document.getElementById("csv-box"); const msg=document.getElementById("csv-msg");
    try{ await navigator.clipboard.writeText(csv); msg.textContent="Copiado. Pégalo en una hoja de cálculo."; }
    catch(e){ box.hidden=false; box.value=csv; box.focus(); box.select(); msg.textContent="Tu navegador no deja copiar automáticamente: selecciona el texto y cópialo."; }
  };
  const lo=document.getElementById("logout"); if(lo) lo.onclick=logout;
  document.getElementById("app-update").onclick=updateApp;
  document.getElementById("wipe").onclick=()=>{
    if(!confirmWipe){ confirmWipe=true; renderSettings(); setTimeout(()=>{confirmWipe=false; if(currentTab==="ajustes") renderSettings();},5000); return; }
    confirmWipe=false;
    const dates=Object.keys(days); days={}; settings.running=null;
    dates.forEach(d=>saveDay(d)); saveSettings(); renderAll();
  };
}
function buildCsv(){
  const rows=[["fecha","categoria","valor","origen","inicio","fin","unidades","minutos","nota"]];
  Object.keys(days).sort().forEach(d=>{
    const day=days[d];
    Object.keys(day.units||{}).forEach(k=>{ const [cat,v]=k.split("|"); const n=day.units[k]; rows.push([d,catById(cat).name,VALUES[catValue(cat)],"unidades","","",n,n*15,""]); });
    (day.entries||[]).forEach(e=>{ const m=(e.end-e.start)/60000; rows.push([d,catById(e.cat).name,VALUES[catValue(e.cat)],"cronómetro",hhmm(e.start),hhmm(e.end),(Math.round(m/15*10)/10),Math.round(m),e.note||""]); });
  });
  return rows.map(r=>r.map(v=>{v=String(v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(",")).join("\n");
}

/* ---------- diálogo de edición de bloques ---------- */
let editingId=null;
const dlg=document.getElementById("dlg");
function openDialog(id){
  const e=findEntry(id); if(!e) return;
  editingId=id;
  document.getElementById("f-cat").innerHTML=settings.categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("")+
    (!settings.categories.some(c=>c.id===e.cat)?'<option value="'+esc(e.cat)+'">Categoría borrada</option>':"");
  document.getElementById("f-cat").value=e.cat;
  document.getElementById("f-date").value=dateStr(new Date(e.start));
  document.getElementById("f-start").value=hhmm(e.start);
  document.getElementById("f-end").value=hhmm(e.end);
  document.getElementById("f-note").value=e.note||"";
  document.getElementById("f-err").textContent="";
  try{ dlg.showModal(); }catch(err){ dlg.setAttribute("open",""); }
}
document.getElementById("f-cancel").onclick=()=>dlg.close();
document.getElementById("f-del").onclick=()=>{ if(editingId) removeEntry(editingId); dlg.close(); renderAll(); };
document.getElementById("dlg-form").addEventListener("submit",ev=>{
  ev.preventDefault();
  const date=document.getElementById("f-date").value, s=document.getElementById("f-start").value, en=document.getElementById("f-end").value;
  if(!date||!s||!en){ document.getElementById("f-err").textContent="Rellena fecha, inicio y fin."; return; }
  const base=parseDate(date); const [sh,sm]=s.split(":").map(Number), [eh,em]=en.split(":").map(Number);
  const start=new Date(base); start.setHours(sh,sm,0,0);
  const end=new Date(base); end.setHours(eh,em,0,0);
  if(end<=start) end.setDate(end.getDate()+1);
  if(end-start>16*3600000){ document.getElementById("f-err").textContent="El bloque dura más de 16 horas. Revisa las horas."; return; }
  const entry={id:editingId, cat:document.getElementById("f-cat").value, note:document.getElementById("f-note").value.trim(), start:start.getTime(), end:end.getTime()};
  removeEntry(editingId); addEntry(entry);
  dlg.close(); renderAll();
});

/* ---------- pestañas ---------- */
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
  currentTab=t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x=>x.setAttribute("aria-selected", String(x===t)));
  ["hoy","semana","ajustes"].forEach(p=>document.getElementById("p-"+p).hidden = p!==currentTab);
  renderTab();
}));
function renderTab(){ if(currentTab==="hoy") renderDay(); else if(currentTab==="semana") renderWeek(); else renderSettings(); }
function renderAll(){ renderNow(); renderReg(); renderTab(); }

setInterval(tick,1000);
// Cada minuto refresca contadores con el tiempo del cronómetro en curso (no escribe nada)
setInterval(()=>{ if(settings.running && !dlg.open){ renderReg(); if(currentTab!=="ajustes") renderTab(); } },60000);

/* ---------- arranque y acceso ---------- */
document.getElementById("app-update-top").addEventListener("click",()=>updateApp());
function showApp(){ document.getElementById("auth").classList.add("hidden"); document.getElementById("app").classList.remove("hidden"); }
function showAuth(){ document.getElementById("app").classList.add("hidden"); document.getElementById("auth").classList.remove("hidden"); }

async function startCloud(session){
  userId=session.user.id; userEmail=session.user.email||"";
  mode="cloud";
  days={}; settings={categories: DEFAULT_CATS.map(c=>({...c})), running:null}; pendingDays.clear(); settingsDirty=false;
  loadCache();
  showApp(); renderAll(); updateStatus();
  await refresh();
}
function startLocal(){
  mode="local"; userId=null;
  loadCache();
  showApp(); renderAll(); updateStatus();
}

const authErr=document.getElementById("a-err");
function authMsg(e){
  const m=(e&&e.message)||"";
  if(/invalid login/i.test(m)) return "Email o contraseña incorrectos.";
  if(/already registered/i.test(m)) return "Ese email ya tiene cuenta. Pulsa «Entrar».";
  if(/signups? not allowed|disabled/i.test(m)) return "Las cuentas nuevas están desactivadas en Supabase.";
  if(/confirm/i.test(m)) return "Confirma tu email con el enlace que te ha llegado y vuelve a entrar.";
  return m || "No se pudo conectar. Revisa tu conexión.";
}
document.getElementById("auth-form").addEventListener("submit", async ev=>{
  ev.preventDefault(); authErr.textContent="";
  const email=document.getElementById("a-email").value.trim(), password=document.getElementById("a-pass").value;
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error){ authErr.textContent=authMsg(error); return; }
  startCloud(data.session);
});
document.getElementById("a-signup").addEventListener("click", async ()=>{
  authErr.textContent="";
  const email=document.getElementById("a-email").value.trim(), password=document.getElementById("a-pass").value;
  if(!email||password.length<6){ authErr.textContent="Escribe tu email y una contraseña de al menos 6 caracteres."; return; }
  const {data,error}=await sb.auth.signUp({email,password});
  if(error){ authErr.textContent=authMsg(error); return; }
  if(data.session) startCloud(data.session);
  else authErr.textContent="Cuenta creada. Revisa tu email para confirmarla y luego pulsa «Entrar».";
});

// Borra la copia guardada de la app y la vuelve a cargar con la última versión publicada
async function updateApp(){
  ["app-update","app-update-top"].forEach(id=>{ const b=document.getElementById(id); if(b){ b.disabled=true; b.textContent="Actualizando…"; } });
  try{ flushAll(); await Promise.all(Object.values(queues)); }catch(e){}
  try{ if(window.caches){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } }catch(e){}
  try{ if(navigator.serviceWorker){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.update().catch(()=>{}))); } }catch(e){}
  location.reload();
}
async function logout(){
  if(sb) await sb.auth.signOut();
  mode="local"; userId=null; days={}; showAuth();
}

window.addEventListener("online",()=>{ online=true; refresh(); });
window.addEventListener("offline",()=>{ online=false; updateStatus(); });
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") { refresh(); renderAll(); } });

async function init(){
  if(CFG.supabaseUrl && CFG.supabaseKey && window.supabase){
    sb=window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth:{persistSession:true, autoRefreshToken:true}});
    const {data}=await sb.auth.getSession();
    if(data && data.session) startCloud(data.session); else showAuth();
  } else {
    startLocal();
  }
  if("serviceWorker" in navigator && location.protocol==="https:"){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
}
init();
})();
