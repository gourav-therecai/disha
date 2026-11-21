import {categories,day,closeVisit,distance,center} from './store.js';
import {mountMap} from './map.js';
import {configureGoogleMaps,googleConfigured,searchGoogle,getGooglePlace,resolveBeatArea,drawGoogleBeat} from './google-map.js';
import {arrangeBeat,beatNodes,drawCoordinateBeat,pointOf} from './beat.js';

const paths={
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 pin:'M20 10c0 5-8 11-8 11s-8-6-8-11a8 8 0 1 1 16 0Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
 calendar:'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
 users:'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9.5 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M17 4a4 4 0 0 1 0 8 M18 15a4 4 0 0 1 3 4v2',
 book:'M12 6v15 M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Z',
 chart:'M4 20v-6 M9 20V9 M14 20v-9 M19 20V4',
 add:'M12 5v14 M5 12h14',
 cross:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
 food:'M4 3v6a3 3 0 0 0 6 0V3 M7 3v18 M18 3c-3 2-4 5-4 9h4 M18 3v18',
 cart:'M2 3h3l3 12h11l2-8H6 M9 19h.01 M18 19h.01',
 bag:'M5 7h14l2 14H3z M9 8V6a3 3 0 1 1 6 0v2',
 layers:'m12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5',
 fire:'M12 22c-8 0-9-8-4-12 0 3 2 3 2 3 2-3 3-6 2-10 5 3 8 7 8 12a8 7 0 0 1-8 7Z',
 check:'m4 12 5 5L20 6',
 compass:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z m16 8-2 6-6 2 2-6z'
};
const icon=(name)=>'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.pin)+'"/></svg>';
const nameOf=lead=>lead.name||'Google business · '+lead.category;
const safe=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nav=[['home','Home','grid'],['beat','Beat Plan','calendar'],['leads','Leads','users'],['learn','Learn','book'],['reports','Reports','chart']];
const lessons=[
 ['products','Product Knowledge','Our banking products','Know what to ask before recommending a current account.','layers','Ask about monthly transactions, cash deposits, and payment collections. Explain the balance requirement and charges clearly before the owner decides.','What should you confirm before recommending an account?',['Monthly transaction needs','The shop’s opening time'],'Monthly transaction needs'],
 ['pitch','Pitch & Visit Guides','How to pitch','A short field pitch for busy business owners.','users','Introduce yourself and ask for two minutes. Start with a question about payments or deposits. Explain one relevant benefit and agree on a specific next step.','How should you open a first visit?',['List every product feature','Ask for time and one relevant question'],'Ask for time and one relevant question'],
 ['playbooks','Resources','Visit playbooks','Use a checklist for your next visit.','book','Before the visit, review the category and prior notes. During the visit, confirm the decision-maker and their needs. After the visit, save the outcome and a follow-up if needed.','When should you save the follow-up?',['After the visit','Only after the account opens'],'After the visit'],
 ['practice','Practice','Role play & quizzes','Practise a common objection.','compass','The owner says they already use another bank. Acknowledge the relationship and ask what works well and what could be easier. Only discuss a switch if your product addresses a real need.','What is the best response to this objection?',['Ask what could be easier','Tell them they must switch'],'Ask what could be easier']
];
const kind={Pharmacy:['cross',''],Restaurant:['food','warm'],Retail:['cart','cool'],Apparel:['bag','rose'],Healthcare:['cross','cool'],Services:['layers','warm'],Wholesale:['bag','']};
const main=document.querySelector('#main'),modal=document.querySelector('#modal'),toast=document.querySelector('#toast');
const csrf=document.querySelector('meta[name="csrf-token"]').content;
let data, revision, user, saving=false;
let query='',category='All',radius=5,learnFilter='All',tab='Overview',mapCleanup=()=>{},timer;
let origin=center, locationMode='loading', locationRequest=0;
const locationLabel=()=>({live:'Your location',loading:'Locating you…',fallback:'Location unavailable · map centred on Noida'})[locationMode];
function useCurrentLocation() {
 const request=++locationRequest;
 const finish=(mode,coords=center)=>{
  if(request!==locationRequest) return;
  locationMode=mode;origin=coords;
  refreshLocation();
 };
 if(!navigator.geolocation) {finish('fallback');return;}
 locationMode='loading';
 refreshLocation();
 navigator.geolocation.getCurrentPosition(({coords})=>{
  finish('live',[Math.max(-85,Math.min(85,coords.latitude)),coords.longitude]);
 },()=>finish('fallback'),{timeout:8000,maximumAge:60000});
}
function refreshLocation() {
 // Keep active forms and search input intact during an asynchronous location update.
 updateBeatLocation();
 for(const label of main.querySelectorAll('[data-distance]')) {
  const lead=data.leads[label.dataset.distance];
  if(lead) label.textContent=locationMode==='live'?distanceLabel(lead):'';
 }
 const map=document.querySelector('#map');
 if(map) {mapCleanup();mapCleanup=mountMap(map,nearbyLeads(),icon,{origin,labelText:locationLabel(),mini:true,radius});}
}
const displayDate=(iso)=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',weekday:'short'}).format(new Date(iso+'T12:00:00+05:30'));
const btn=(label,{go,act,id,extra=''}={})=>'<button type="button" class="btn '+extra+'" '+(go?'data-go="'+go+'"':'data-act="'+act+'"')+(id?' data-id="'+id+'"':'')+'>'+label+'</button>';
const tile=(name,tone='')=>'<span class="tile '+tone+'">'+icon(name)+'</span>';
const badge=(status)=>'<span class="pill '+status.toLowerCase()+'">'+status+'</span>';
const latest=(id)=>data.visits.findLast(v=>v.leadId===id);
const status=(lead)=>lead.openedAt?'Opened':latest(lead.id)?.rating||'Fresh';
const plan=(date=day())=>data.plans[date]||[];
const visits=(date=day())=>data.visits.filter(v=>v.date===date);
const visited=(id,date=day())=>visits(date).some(v=>v.leadId===id);
const leadTitle=(lead)=>'<button class="lead-link" data-go="lead/'+lead.id+'">'+safe(nameOf(lead))+'</button>';
const km=(lead)=>lead.lat===null?null:distance(lead.lat,lead.lng,origin);
const nearbyLeads=()=>Object.values(data.leads).filter(l=>km(l)!==null&&km(l)<=radius);
const firstName=()=>safe(user.name.split(/[ @]/)[0]||'there');
const initials=()=>safe(user.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase());
const distanceLabel=(lead)=>km(lead)===null?'':' · '+km(lead).toFixed(1)+' km';
const info=(lead)=>safe(lead.category)+' · '+safe(lead.area||(lead.googlePlaceId?'Google Maps':''))+'<span data-distance="'+lead.id+'">'+distanceLabel(lead)+'</span>';
const row=(lead,action='',pill=true)=>'<div class="row">'+tile(...kind[lead.category])+'<div class="grow"><strong>'+leadTitle(lead)+'</strong><small>'+info(lead)+'</small></div>'+(pill?badge(status(lead)):'')+action+'</div>';
const heading=(title,description,action='')=>'<div class="section heading"><div><h1>'+title+'</h1><div class="sub">'+description+'</div></div>'+action+'</div>';
const empty=(message)=>'<div class="empty">'+message+'</div>';
const metrics=()=>{
 const done=plan().filter(id=>visited(id)).length;
 const coverage=new Set(visits().map(v=>data.leads[v.leadId]?.category)).size;
 const leads=Object.values(data.leads);
 const rows=[['Visits done',done+' / '+plan().length,'Today’s planned stops','pin',''],['Hot leads',leads.filter(l=>status(l)==='Hot').length,'Ready for follow-up','fire','rose'],['Categories',coverage+' / '+categories.length,'Covered today','layers','cool'],['Accounts opened',leads.filter(l=>l.openedAt===day()).length,'Opened today','chart','warm']];
 return '<div class="metrics">'+rows.map(([label,value,note,i,tone])=>'<div class="metric"><div class="label">'+tile(i,tone)+label+'</div><strong>'+value+'</strong><small>'+note+'</small></div>').join('')+'</div>';
};
const section=(title,note='',action='')=>'<div class="section"><div><h2>'+title+'</h2>'+(note?'<small>'+note+'</small>':'')+'</div>'+action+'</div>';
const quick=(label,i,attrs)=>'<button '+attrs+'>'+icon(i)+label+'</button>';
const visitButton=(id,date=day())=>date===day()&&!visited(id)?btn('Start visit',{act:'visit',id,extra:'primary'}):visited(id,date)?badge('Visited'):'';
function home() {
 const ids=plan();
 const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hourCycle:'h23',timeZone:'Asia/Kolkata'}).format(new Date()));
 return '<section class="hero"><div><p class="eyebrow">FIELD SALES WORKSPACE</p><h1>Good '+(hour<12?'morning':hour<17?'afternoon':'evening')+', '+firstName()+'.</h1><p>Plan your stops, meet local businesses, and track every conversation.</p></div>'+btn(icon('pin')+' Plan today’s beat',{go:'beat',extra:'light'})+'</section>'+metrics()+
 '<div class="layout"><section class="card pad">'+section('Today’s plan',ids.length+' planned visits',btn('View plan',{go:'beat'}))+
 (ids.slice(0,5).map(id=>row(data.leads[id],visitButton(id),false)).join('')||empty('Add nearby leads to start your day.'))+
 '</section><div class="stack"><section class="card pad">'+section('Quick actions')+'<div class="quick">'+quick('Build a beat','calendar','data-go="beat"')+quick('Learn & practice','book','data-go="learn"')+quick('Add a new lead','add','data-act="add"')+'</div></section><section class="card pad">'+section('Territory map','Browse businesses near your starting point',btn('Open map',{go:'beat'}))+'<div class="map mini" id="map" aria-label="Territory map"></div></section></div></div>';
}
function listPage() {
 return heading('Lead management','Manage profiles, visit history and follow-ups.',btn(icon('add')+' Add lead',{act:'add',extra:'primary'}))+
 '<div class="toolbar"><input id="search" type="search" aria-label="Search establishments" placeholder="Search name, area or category" value="'+safe(query)+'"></div>'+
 '<div class="toolbar">'+['All',...categories].map(c=>'<button class="chip '+(c===category?'active':'')+'" data-act="category" data-id="'+c+'">'+c+'</button>').join('')+'</div>'+
 '<section class="card pad"><div id="results"></div></section>';
}
function updateResults() {
 const match=Object.values(data.leads).filter(l=>(category==='All'||category===l.category)&&[l.name,l.area,l.category].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 document.querySelector('#results').innerHTML=section(match.length+(match.length===1?' establishment':' establishments'))+
 (match.map(l=>row(l,btn('Open',{go:'lead/'+l.id}))).join('')||empty('No matching leads. Add a business to get started.'));
}
const beatSettings={area:'',target:8,radius:5,category:'All',followups:true};
let beatDraft=null, beatBusy=false, savedRoute=null;
const beatRoute=()=>['beat','discover','plan'].includes(location.hash.slice(1));

function beatPage() {
 const ids=plan();
 const form='<form id="beat-form" class="card pad beat-form">'+section('Set up today’s beat')+
  field('Area','<input name="area" maxlength="120" autocomplete="off" placeholder="e.g. Andheri East, Mumbai" value="'+safe(beatSettings.area)+'">')+
  '<p class="sub" id="beat-location">Leave blank to use your current location.</p>'+btn('Use my location',{act:'locate'})+
  '<div class="beat-fields">'+field('Visit target','<input name="target" type="number" min="1" max="40" value="'+beatSettings.target+'" required>')+
  field('Search radius','<select name="radius">'+[1,2,5].map(n=>'<option value="'+n+'" '+(n===beatSettings.radius?'selected':'')+'>'+n+' km</option>').join('')+'</select>')+'</div>'+
  field('New business category','<select name="category">'+['All',...categories].map(c=>'<option '+(c===beatSettings.category?'selected':'')+'>'+c+'</option>').join('')+'</select>')+
  '<label class="beat-check"><input type="checkbox" name="followups" '+(beatSettings.followups?'checked':'')+'> Include due and overdue follow-ups</label>'+
  '<button class="btn primary" type="submit">Preview beat</button><p id="beat-status" class="sub" role="status"></p></form>';
 return heading('Beat Plan',displayDate(day())+' · Find businesses and plan your visits',btn('Add business',{act:'add'}))+
  '<div class="beat-layout">'+form+'<div class="beat-output"><div id="beat-preview"></div>'+
  '<section class="card pad">'+section('Today’s saved stops',ids.filter(id=>visited(id)).length+' of '+ids.length+' visited',
    ids.length?btn('Show saved route',{act:'showSavedBeat'}):'')+
  (ids.map(id=>row(data.leads[id],visitButton(id)+(visited(id)?'':btn('Remove',{act:'planRemove',id})),false)).join('')||empty('Save a preview to build today’s beat.'))+
  '</section></div></div>';
}
function updateBeatLocation() {
 const label=document.querySelector('#beat-location');
 if(label) label.textContent=locationMode==='live'?'Your location is ready. Leave area blank to search nearby.':
  locationMode==='loading'?'Waiting for device location. You can also enter an area.':'Enter an area or allow location access.';
}
function setBeatStatus(message) {
 const label=document.querySelector('#beat-status');
 if(label) label.textContent=message;
}
function nearbyForBeat(leads,point,area,radius) {
 return leads.filter(lead=>{
  const location=pointOf(lead);
  if(location&&point) return distance(...location,point)<=radius;
  return Boolean(area&&lead.area.toLowerCase().includes(area.toLowerCase()));
 });
}
async function previewBeat(form) {
 if(beatBusy) return;
 const values=new FormData(form);
 beatSettings.area=values.get('area').trim();
 beatSettings.target=Number(values.get('target'));
 beatSettings.radius=Number(values.get('radius'));
 beatSettings.category=values.get('category');
 beatSettings.followups=values.has('followups');
 const settings={...beatSettings};
 for(const field of form.elements) field.disabled=true;beatBusy=true;beatDraft=null;savedRoute=null;
 renderBeatPreview();
 setBeatStatus('Finding available businesses…');
 try {
  const device=locationMode==='live'?origin:null;
  let areaPoint=settings.area?null:device,areaLabel=settings.area;
  let note='';
  if(settings.area&&googleConfigured()) {
   try {
    const resolved=await resolveBeatArea(settings.area);
    areaPoint=resolved.point;areaLabel=resolved.label;
   } catch {note='Could not locate that area on Google Maps. Showing saved leads whose address matches.';}
  }
  if(!areaPoint&&!settings.area) throw new Error('Allow location access or enter an area to preview your beat.');
  let candidates=[],source=new Map();
  if(areaPoint&&googleConfigured()) {
   try {
    const search=await searchGoogle(areaPoint,settings.radius,settings.category);
    if(!form.isConnected) return;
    source=new Map(search.places.map(place=>[place.googlePlaceId,place]));
    const availability=await api('/api/beat/availability',{method:'POST',headers:{'X-CSRFToken':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({place_ids:[...source.keys()]})});
    for(const id of availability.unavailable) source.delete(id);
    if(search.failures.length) note='Some business categories could not be searched.';
   } catch {source.clear();note='Google discovery is unavailable. Showing saved leads where possible.';}
  }
  const due=lead=>{
   const followUp=latest(lead.id)?.followUpDate;
   return Boolean(followUp&&followUp<=day());
  };
  const owned=Object.values(data.leads);
  // A linked follow-up can be absent from a category-limited nearby search.
  const unresolved=owned.filter(lead=>settings.followups&&googleConfigured()&&areaPoint&&
   lead.googlePlaceId&&!source.has(lead.googlePlaceId)&&!pointOf(lead)&&!lead.allocationBlocked&&
   !visited(lead.id)&&due(lead)).slice(0,settings.target);
  for(let i=0;i<unresolved.length;i+=5) {
   await Promise.all(unresolved.slice(i,i+5).map(async lead=>{
    try {source.set(lead.googlePlaceId,await getGooglePlace(lead.googlePlaceId));} catch {}
   }));
   if(!form.isConnected) return;
  }
  const ownedGoogle=new Set(owned.map(lead=>lead.googlePlaceId).filter(Boolean));
  const saved=owned.filter(lead=>!lead.allocationBlocked&&!visited(lead.id)).map(lead=>{
   const listing=source.get(lead.googlePlaceId);
   return {...lead,followUp:due(lead),googleRoute:Boolean(listing),
    lat:lead.lat??listing?.lat,lng:lead.lng??listing?.lng,
    name:lead.name||listing?.name||'',area:lead.area||listing?.area||''};
  });
  const nearby=nearbyForBeat(saved,areaPoint,settings.area,settings.radius);
  candidates=nearby.filter(lead=>lead.followUp?settings.followups:
   !latest(lead.id)&&(settings.category==='All'||lead.category===settings.category));
  for(const place of source.values()) {
   if(place.googlePlaceId&&!ownedGoogle.has(place.googlePlaceId)&&pointOf(place)&&distance(place.lat,place.lng,areaPoint)<=settings.radius) {
    candidates.push({...place,googleRoute:true});
   }
  }
  const already=new Set(plan());
  const remaining=Math.max(0,settings.target-already.size);
  const start=device||areaPoint;
  const existing=plan().map(id=>{
   const lead=data.leads[id],listing=source.get(lead.googlePlaceId);
   return {...lead,name:lead.name||listing?.name||'',lat:lead.lat??listing?.lat,lng:lead.lng??listing?.lng,googleRoute:Boolean(listing)};
  });
  const from=existing.map(pointOf).filter(Boolean).at(-1)||start;
  const added=arrangeBeat(candidates.filter(lead=>!already.has(lead.id)),from,remaining);
  if(!form.isConnected) return;
  beatDraft={stops:[...existing,...added],added,start,label:device?'Your location':'Area centre',area:areaLabel,
   google:Boolean(settings.area&&areaPoint)||[...existing,...added].some(lead=>lead.googleRoute),
   notice:note||(!added.length?(remaining?'No additional eligible businesses for these settings.':'Today’s saved stops already meet your target.'):'')};
  renderBeatPreview();
  setBeatStatus(added.length+' additional '+(added.length===1?'stop':'stops')+' found.');
  document.querySelector('#beat-preview')?.scrollIntoView({block:'start'});
 } catch(error) {
  setBeatStatus(error.message);
 } finally {
  beatBusy=false;
  for(const field of form.elements) field.disabled=false;
 }
}
function renderBeatPreview() {
 const host=document.querySelector('#beat-preview'),beat=beatDraft||savedRoute;
 if(!host) return;
 if(!beat) {host.replaceChildren();return;}
 const nodes=beatNodes(beat.stops,beat.start,beat.label,nameOf);
 const legs=new Map(nodes.filter((node,index)=>node.number&&index>0).map(node=>[node.number,node.km]));
 const total=nodes.reduce((sum,node)=>sum+node.km,0);
 host.innerHTML='<section class="card pad beat-preview">'+section(beatDraft?'Beat preview':'Saved beat route',
   (beat.area?safe(beat.area)+' · ':'')+beat.stops.length+' stops · '+total.toFixed(2)+' km straight-line')+
  (nodes.length?'<div class="beat-map" id="beat-map"></div>':'<p class="sub">No coordinates available for this route.</p>')+
  '<p class="sub">'+(beat.start?'0 = '+safe(beat.label)+'. ':'Device location unavailable. ')+'Distances are estimates from coordinates. Stops without coordinates are listed below.</p>'+
  (beat.notice?'<p class="sub">'+safe(beat.notice)+'</p>':'')+
  '<ol class="beat-stops">'+beat.stops.map((lead,i)=>'<li><strong>'+safe(nameOf(lead))+'</strong><span>'+
   (lead.followUp?'Follow-up · ':'')+(legs.has(i+1)?legs.get(i+1).toFixed(2)+' km from previous mapped point':pointOf(lead)?'First mapped stop':'Coordinates unavailable')+'</span></li>').join('')+'</ol>'+
  (beatDraft?.added.length?btn('Save '+beatDraft.added.length+' new stops',{act:'saveBeat',extra:'primary'}):'')+'</section>';
 const graph=host.querySelector('#beat-map');
 if(graph) {
  if(beat.google) drawGoogleBeat(graph,nodes).catch(()=>{if(graph.isConnected) graph.textContent='Google map unavailable. Distances are listed below.';});
  else drawCoordinateBeat(graph,nodes);
 }
}
async function saveBeat() {
 const draft=beatDraft;
 if(!draft?.added.length||saving) return;
 const kept=await save(w=>{
  const ids=w.plans[day()]??=[];
  for(const stop of draft.added) {
   let id=stop.id;
   if(!w.leads[id]) {
    id=crypto.randomUUID();
    w.leads[id]={id,name:'',area:'',category:stop.category,lat:null,lng:null,owner:'',phone:'',openedAt:null,googlePlaceId:stop.googlePlaceId};
   }
   if(!ids.includes(id)) ids.push(id);
  }
 },'Beat saved.');
 if(kept) {
  beatDraft=null;savedRoute={...draft,notice:''};
  renderBeatPreview();
 } else {
  beatDraft=null;
  renderBeatPreview();
  setBeatStatus('The beat was not saved. Preview again to check availability.');
 }
}
async function showSavedBeat(button) {
 const host=document.querySelector('#beat-preview');
 if(!host) return;
 button.disabled=true;
 setBeatStatus('Loading saved route…');
 try {
  const stops=await Promise.all(plan().map(async id=>{
   const lead=data.leads[id];
   if(!lead.googlePlaceId||!googleConfigured()) return lead;
   try {
    const place=await getGooglePlace(lead.googlePlaceId);
    return {...lead,name:lead.name||place.name,lat:lead.lat??place.lat,lng:lead.lng??place.lng,googleRoute:true};
   } catch {return lead;}
  }));
  if(!host.isConnected) return;
  beatDraft=null;savedRoute={stops,start:locationMode==='live'?origin:null,label:'Your location',google:stops.some(lead=>lead.googleRoute)};
  renderBeatPreview();
  setBeatStatus('');
 } finally {
  button.disabled=false;
 }
}
function visitPhoto(visit) {
 return visit?.hasPhoto?'<img class="visit-photo" loading="lazy" alt="Business photo from this visit" src="/api/visits/'+encodeURIComponent(visit.id)+'/photo">':'';
}
function googleFields(place,category,asForm=false) {
 const entries=[['Business name',place.name],['Address',place.area],['Latitude',place.lat],['Longitude',place.lng]];
 if(category) entries.push(['Category',category]);
 return '<div class="google-preview"><dl class="details">'+entries.map(([label,value])=>
  '<dt>'+label+'</dt><dd>'+(asForm?'<input readonly aria-label="'+label+'" value="'+safe(value??'Unavailable')+'">':safe(value??'Unavailable'))+'</dd>').join('')+'</dl><small>Source: Google Maps</small></div>';
}
function populateGoogleDetails(lead,id) {
 const host=document.querySelector('#google-business-details');
 if(!host||!lead?.googlePlaceId) return;
 if(!googleConfigured()) {host.textContent='Google Maps is not configured on this device.';return;}
 getGooglePlace(lead.googlePlaceId).then(place=>{
  if(!host.isConnected||location.hash!=='#lead/'+id) return;
  host.innerHTML=googleFields(place);
  const title=main.querySelector('h1');
  if(title&&!lead.name&&place.name) title.textContent=place.name;
 }).catch(()=>{
  if(host.isConnected) host.textContent='Google listing details are temporarily unavailable.';
 });
}
const selectedProduct=new Map();
const panelOptions=new WeakMap();
function pitchPanel(id) {
 return '<section class="previsit-pitch" data-pitch-id="'+id+'"><h2>Prepare your pitch</h2>'+
  '<div class="pitch-setup" aria-busy="true">Loading products and suggested contact…</div>'+
  '<div class="pitch-result" aria-live="polite"></div></section>';
}
async function loadPitchOptions(host,id) {
 if(!host||!id) return;
 const setup=host.querySelector('.pitch-setup');
 try {
  const options=await api('/api/leads/'+encodeURIComponent(id)+'/pitch-options');
  if(!host.isConnected) return;
  panelOptions.set(host,options.products);
  const who='<div class="pitch-contact"><h3>Who to ask for</h3><p><strong>'+safe(options.primary)+
   '</strong></p><p class="sub">If unavailable, ask for the '+safe(options.alternate.toLowerCase())+'.</p></div>';
  if(!options.products.length) {
   setup.innerHTML=who+'<p class="sub">There are no active products. Ask your administrator to add one.</p>';
   return;
  }
  const choices=options.products.map(product=>'<option value="'+product.id+'">'+safe(product.name)+'</option>').join('');
  const catalog=options.products.length>1?'<details class="pitch-catalog"><summary>View all '+options.products.length+
   ' products</summary><ul>'+options.products.map(product=>'<li><strong>'+safe(product.name)+
   '</strong><p>'+safe(product.description)+'</p></li>').join('')+'</ul></details>':'';
  setup.innerHTML=who+'<div class="pitch-product"><label class="field">Product to pitch<select data-pitch-product>'+
   choices+'</select></label><p class="sub" data-product-description></p>'+catalog+
   btn('Generate pitch',{act:'generatePitch',id,extra:'primary'})+'</div>';
  const select=setup.querySelector('[data-pitch-product]');
  if(options.products.some(product=>String(product.id)===selectedProduct.get(id))) select.value=selectedProduct.get(id);
  updatePitchProduct(host,select.value);
 } catch(error) {
  if(host.isConnected) setup.innerHTML='<p class="sub">'+safe(error.message)+'</p>'+btn('Reload products',{act:'loadPitchOptions',id});
 } finally {
  setup.setAttribute('aria-busy','false');
 }
}
function updatePitchProduct(host,value) {
 const product=panelOptions.get(host)?.find(item=>String(item.id)===value);
 if(!product) return;
 const id=host.dataset.pitchId;
 selectedProduct.set(id,value);
 host.querySelector('[data-product-description]').textContent=product.description;
 host.querySelector('.pitch-result').replaceChildren();
}
async function readPitch(host,id,button) {
 const product=host?.querySelector('[data-pitch-product]');
 if(!product||button.disabled) return;
 const requested=product.value;
 const result=host.querySelector('.pitch-result');
 product.disabled=true;
 button.disabled=true;
 result.textContent='Preparing English and Hindi scripts…';
 try {
  const pitch=await api('/api/leads/'+encodeURIComponent(id)+'/pitch',{
   method:'POST',headers:{'X-CSRFToken':csrf,'Content-Type':'application/json'},
   body:JSON.stringify({product_id:Number(requested)})
  });
  if(!host.isConnected) return;
  const title=product.options[product.selectedIndex].text;
  result.innerHTML='<h3>'+safe(title)+'</h3><div class="pitch-switch" role="group" aria-label="Pitch language">'+
   '<button type="button" class="chip active" aria-pressed="true" data-act="pitchLanguage" data-id="en">English</button>'+
   '<button type="button" class="chip" aria-pressed="false" data-act="pitchLanguage" data-id="hi" lang="hi">हिन्दी</button></div>'+
   '<div class="pitch-script" lang="en"><p>'+safe(pitch.english)+'</p></div>'+
   '<div class="pitch-script" lang="hi" hidden><p>'+safe(pitch.hindi)+'</p></div>';
 } catch(error) {
  if(host.isConnected) result.textContent=error.message;
 } finally {
  product.disabled=false;
  button.disabled=false;
 }
}
function changePitchLanguage(button,language) {
 const panel=button.closest('.pitch-result');
 for(const option of panel.querySelectorAll('[data-act="pitchLanguage"]')) {
  const active=option.dataset.id===language;
  option.classList.toggle('active',active);
  option.setAttribute('aria-pressed',String(active));
 }
 for(const script of panel.querySelectorAll('.pitch-script')) script.hidden=script.lang!==language;
}
function profile(id) {
 const lead=data.leads[id];
 if(!lead) return heading('Lead unavailable','Open the lead list to choose an establishment.',btn('Leads',{go:'leads'}));
 const history=data.visits.filter(v=>v.leadId===id).slice().reverse(),last=history[0];
 const actions=btn('Edit details',{act:'editLead',id})+' '+btn('Log visit',{act:'visit',id,extra:'primary'})+(plan().includes(id)?' '+badge('Planned'):' '+btn('Add to plan',{act:'planAdd',id}));
 const mapLink=lead.googlePlaceId
  ? 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lead.name||'Google business')+'&query_place_id='+encodeURIComponent(lead.googlePlaceId)
  : lead.lat===null?'':'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lead.lat+','+lead.lng);
 const directions=mapLink?'<a class="btn" target="_blank" rel="noopener" href="'+safe(mapLink)+'">Open location</a>':'';
 const phone=lead.phone?'<a class="btn" href="tel:'+safe(lead.phone)+'">Call</a>':'';
 let content;
 if(tab==='Visit history'||tab==='Notes') content='<section class="card pad">'+section(tab)+(history.map(v=>'<div class="row"><div class="grow"><strong>'+displayDate(v.date)+'</strong><p style="margin:3px 0">'+safe(v.remarks)+'</p>'+visitPhoto(v)+(v.nextAction||v.followUpDate?'<small>'+safe(v.nextAction)+(v.followUpDate?' · '+displayDate(v.followUpDate):'')+'</small>':'')+'</div>'+badge(v.rating)+'</div>').join('')||empty('Log a visit to add the first entry.'))+'</section>';
 else content='<div class="layout"><section class="card pad">'+section('Business details','',badge(status(lead)))+
 '<dl class="details"><dt>Owner</dt><dd>'+safe(lead.owner||'Not provided')+'</dd><dt>Phone</dt><dd>'+safe(lead.phone||'Not provided')+'</dd><dt>Address</dt><dd>'+safe(lead.area)+'</dd><dt>Category</dt><dd>'+safe(lead.category)+'</dd></dl>'+(lead.googlePlaceId?'<div id="google-business-details" class="sub" aria-live="polite">Loading Google listing…</div>':'')+'<div class="toolbar">'+phone+directions+(!lead.openedAt?btn('Mark account opened',{act:'openAccount',id}):badge('Opened'))+'</div></section><div class="stack"><section class="card pad">'+section('Relationship summary')+(last?'<p>'+safe(last.remarks)+'</p><small>Last visit · '+displayDate(last.date)+'</small>'+visitPhoto(history.find(v=>v.hasPhoto)):empty('No visits recorded yet.'))+'</section><section class="card pad">'+section('Next action')+(last&&(last.nextAction||last.followUpDate)?'<p>'+safe(last.nextAction||'Follow up')+'</p>'+(last.followUpDate?'<small>'+displayDate(last.followUpDate)+'</small>':''):empty('No follow-up scheduled.'))+'</section></div></div>';
 return '<button class="quiet" data-go="leads">All leads</button>'+heading(safe(nameOf(lead)),info(lead))+'<div class="toolbar">'+actions+'</div>'+(tab==='Overview'?pitchPanel(id):'')+'<div class="toolbar">'+['Overview','Visit history','Notes'].map(t=>'<button class="chip '+(tab===t?'active':'')+'" data-act="profileTab" data-id="'+t+'">'+t+'</button>').join('')+'</div>'+content;
}
function learning() {
 return heading('Learning & Development','Product knowledge, pitch guides and field practice.')+'<div class="toolbar">'+['All','Product Knowledge','Pitch & Visit Guides','Practice','Resources'].map(c=>'<button class="chip '+(c===learnFilter?'active':'')+'" data-act="learnFilter" data-id="'+c+'">'+c+'</button>').join('')+'</div><div class="learn">'+lessons.filter(l=>learnFilter==='All'||l[1]===learnFilter).map(([id,category,title,note,i])=>'<section class="card pad">'+tile(i)+'<small>'+category+'</small><h2>'+title+'</h2><p class="sub">'+note+'</p>'+btn(data.completedLessons.includes(id)?'Review lesson':'Start lesson',{act:'lesson',id,extra:'primary'})+(data.completedLessons.includes(id)?' '+badge('Completed'):'')+'</section>').join('')+'</div>';
}
function reports() {
 const all=Object.values(data.leads),logged=all.filter(l=>latest(l.id)).length,opened=all.filter(l=>l.openedAt).length;
 const converted=all.filter(l=>l.openedAt&&latest(l.id)).length;
 return heading('Reports','Daily activity, lead outcomes and account progress.')+metrics()+'<div class="layout"><section class="card pad">'+section('Lead outcomes','Current status across all '+all.length+' leads')+['Fresh','Hot','Warm','Cold','Opened'].map(s=>{
 const count=all.filter(l=>status(l)===s).length;
 return '<div class="row"><div class="grow">'+badge(s)+'<div class="bar"><span style="width:'+100*count/Math.max(1,all.length)+'%"></span></div></div><strong>'+count+'</strong></div>';
 }).join('')+'</section><div class="stack"><section class="card pad">'+section('Account conversion','Visited leads that opened an account')+'<h2>'+ (logged?Math.round(100*converted/logged)+'%':'—')+'</h2><small>'+converted+' of '+logged+' visited leads · '+opened+' total accounts opened</small></section><section class="card pad">'+section('Recent visits')+(data.visits.slice(-5).reverse().map(v=>'<div class="row"><div class="grow"><strong>'+leadTitle(data.leads[v.leadId])+'</strong><small>'+displayDate(v.date)+'</small></div>'+badge(v.rating)+'</div>').join('')||empty('No visits recorded yet.'))+'</section></div></div>';
}
function render() {
 mapCleanup();
 const [page,id]=(location.hash.slice(1)||'home').split('/');
 const active=page==='lead'?'leads':beatRoute()?'beat':page;
 document.querySelector('#side').innerHTML='<div class="brand"><span class="tile logo">'+icon('compass')+'</span><div><strong>Disha</strong><small>Field sales workspace</small></div></div><p class="nav-label">WORKSPACE</p><nav aria-label="Workspace">'+nav.map(([route,label,i])=>'<button data-go="'+route+'" '+(active===route?'class="active" aria-current="page"':'')+'>'+icon(i)+label+'</button>').join('')+'</nav><div class="agent"><span class="avatar">'+initials()+'</span><div><strong>'+safe(user.name)+'</strong><small>Field Sales Executive</small></div></div>';
 document.querySelector('#top').innerHTML='<div><span>Workspace</span><strong>'+ (nav.find(x=>x[0]===active)?.[1]||'Home')+'</strong></div><div><span>'+icon('calendar')+' '+displayDate(day())+'</span><form method="post" action="/accounts/logout/"><input type="hidden" name="csrfmiddlewaretoken" value="'+safe(csrf)+'"><button class="btn" type="submit">Sign out</button></form></div>';
 const screens={home,beat:beatPage,discover:beatPage,plan:beatPage,leads:listPage,learn:learning,reports,lead:()=>profile(id)};
 main.innerHTML=(screens[page]||home)();
 if(page==='leads') updateResults();
 if(beatRoute()) {
  updateBeatLocation();
  if(!locationRequest) useCurrentLocation();
  renderBeatPreview();
 }
 if(page==='lead') {
  loadPitchOptions(main.querySelector('[data-pitch-id]'),id);
  populateGoogleDetails(data.leads[id],id);
 }
 if(page==='home') mapCleanup=mountMap(document.querySelector('#map'),nearbyLeads(),icon,{origin,labelText:locationLabel(),mini:true,radius});
}
function notify(message) {
 toast.textContent=message;
 clearTimeout(timer);timer=setTimeout(()=>toast.textContent='',3200);
}
async function api(path,options) {
 const response=await fetch(path,options);
 const body=await response.json().catch(()=>({}));
 if(!response.ok) throw Object.assign(new Error(body.error||'Request failed.'),{status:response.status});
 return body;
}
async function save(change,message,quiz,attachment) {
 if(saving) return false;
 saving=true;
 const form=modal.open?modal.querySelector('form'):null;
 const submitButton=form?.querySelector('[type="submit"]');
 if(submitButton) submitButton.disabled=true;
 try {
  const next=structuredClone(data);
  change(next);
  const payload=JSON.stringify({revision,data:next,quiz});
  const headers={'X-CSRFToken':csrf};
  let method='PUT',body=payload;
  if(attachment) {
   method='POST';body=new FormData();
   body.append('payload',payload);
   body.append('photo_visit',attachment.visitId);
   body.append('photo',attachment.file);
  } else headers['Content-Type']='application/json';
  const result=await api('/api/workspace',{method,headers,body});
  ({data,revision}=result);
  if(modal.open) modal.close();
  render();notify(message);return true;
 } catch(e) {
  if(e.status===409) {
   try {({data,revision}=await api('/api/workspace'));render();} catch {}
  }
  if(form?.isConnected&&modal.open) form.querySelector('.form-error').textContent=e.message;
  else notify(e.message);
  return false;
 } finally {
  if(submitButton) submitButton.disabled=false;
  saving=false;
 }
}
function navigate(go) {
 if(location.hash==='#'+go) return;
 tab='Overview';query='';category='All';location.hash=go;
}
const field=(label,html)=>'<label class="field">'+label+html+'</label>';
const submit=(label)=>'<div class="foot-actions">'+btn('Cancel',{act:'dismiss'})+'<button class="btn primary" type="submit">'+label+'</button></div>';
function dialog(title,description,body,method) {
 modal.innerHTML='<h2 id="dialog-title">'+title+'</h2><p class="sub">'+description+'</p><form>'+body+'<p class="form-error" role="alert"></p></form>';
 modal.setAttribute('aria-labelledby','dialog-title');
 modal.querySelector('form').onsubmit=(event)=>{event.preventDefault();method(new FormData(event.currentTarget));};
 modal.showModal();
}
function addLead(existing, linkedPlace) {
 const val=(key)=>safe(existing?.[key]??'');
 const isLinked=Boolean(existing?.googlePlaceId||linkedPlace);
 const required=isLinked?'':' required';
 dialog(existing?'Edit business details':linkedPlace?'Link Google place as a lead':'Add a new lead',linkedPlace?'Google Maps has filled the listing details below. Save to link this business. Add a local label or contact details if useful.':'Enter business details. Add coordinates to place the business on the map.',
 (linkedPlace?googleFields(linkedPlace,linkedPlace.category,true):'')+
 field(isLinked?'Local business label (optional)':'Business name','<input name="name" value="'+val('name')+'" maxlength="100"'+required+'>')+
 field('Category','<select name="category">'+categories.map(c=>'<option '+((existing?.category||linkedPlace?.category||category)===c?'selected':'')+'>'+c+'</option>').join('')+'</select>')+
 field(isLinked?'Your address notes (optional)':'Address or area','<input name="area" value="'+val('area')+'" maxlength="140"'+required+'>')+
 field('Owner','<input name="owner" value="'+val('owner')+'" maxlength="80">')+
 field('Phone','<input name="phone" value="'+val('phone')+'" type="tel" maxlength="24">')+
 (linkedPlace?'':field('Latitude','<input name="lat" value="'+val('lat')+'" type="number" step="any" min="-85" max="85">')+
 field('Longitude','<input name="lng" value="'+val('lng')+'" type="number" step="any" min="-180" max="180">')+(locationMode==='live'?btn('Use my current position for this business',{act:'fillPosition'}):''))+submit('Save lead'),async f=>{
 const vals={lat:'',lng:'',...Object.fromEntries([...f].map(([k,v])=>[k,v.trim()]))};
 if((!isLinked&&(!vals.name||!vals.area))||Boolean(vals.lat)!==Boolean(vals.lng)||!/^[+0-9 ()-]*$/.test(vals.phone)) {
  modal.querySelector('.form-error').textContent='Enter a name, address, valid phone if provided, and both coordinates or neither.';return;
 }
 const id=existing?.id||crypto.randomUUID();
 if(await save(w=>{w.leads[id]={...vals,id,lat:vals.lat===''?null:Number(vals.lat),lng:vals.lng===''?null:Number(vals.lng),openedAt:w.leads[id]?.openedAt??null,...((existing?.googlePlaceId||linkedPlace?.googlePlaceId)?{googlePlaceId:existing?.googlePlaceId||linkedPlace.googlePlaceId}:{})};},existing?'Lead updated.':'Lead added.')) {tab='Overview';location.hash='lead/'+id;}
 });
}
function logVisit(id) {
 dialog('Close visit',safe(nameOf(data.leads[id])),
 pitchPanel(id)+ '<fieldset><legend>How promising is this lead?</legend><div class="choices">'+['Hot','Warm','Cold'].map(r=>'<label><input type="radio" name="rating" value="'+r+'" required>'+r+'</label>').join('')+'</div></fieldset>'+
 field('Visit remarks','<textarea name="remarks" rows="3" maxlength="1500" required placeholder="What was discussed?"></textarea>')+
 field('Follow-up date (optional)','<input name="followUpDate" type="date" min="'+day()+'">')+
 field('Next action (optional)','<select name="nextAction"><option value="">Select next action</option><option>Call back</option><option>Share product details</option><option>Revisit business</option><option>Collect documents</option></select>')+field('Business photo (optional, up to 5 MB)','<input name="photo" type="file" accept="image/jpeg,image/png,image/webp">')+submit('Save visit'), f=>{
 const visit={id:crypto.randomUUID(),leadId:id,date:day(),createdAt:new Date().toISOString(),rating:f.get('rating'),remarks:f.get('remarks').trim(),followUpDate:f.get('followUpDate')||null,nextAction:f.get('nextAction')||null};
 const file=f.get('photo');
 if(file?.size>5*1024*1024) {modal.querySelector('.form-error').textContent='Choose a photo that is 5 MB or smaller.';return;}
 save(w=>closeVisit(w,visit),'Visit saved.',undefined,file?.size?{file,visitId:visit.id}:undefined);
 });
 loadPitchOptions(modal.querySelector('[data-pitch-id]'),id);
}
function showLesson(id) {
 const [,,title,note,,body,question,answers,correct]=lessons.find(l=>l[0]===id);
 dialog(title,note,'<p>'+body+'</p><fieldset><legend>'+question+'</legend><div class="choices">'+answers.map(a=>'<label><input name="answer" type="radio" value="'+safe(a)+'" required>'+safe(a)+'</label>').join('')+'</div></fieldset><p id="feedback" role="status"></p>'+submit('Check answer'),f=>{
 if(f.get('answer')!==correct) {document.querySelector('#feedback').textContent='Try again. Review the guidance above.';return;}
 save(w=>{if(!w.completedLessons.includes(id)) w.completedLessons.push(id);},'Correct. Lesson completed.',{lesson:id,answer:f.get('answer')});
 });
}
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-go],[data-act]');
 if(!button) return;
 const {go,act,id}=button.dataset;
 if(go) {navigate(go);return;}
 const actions={
  locate:useCurrentLocation,saveBeat,showSavedBeat:()=>showSavedBeat(button),
  loadPitchOptions:()=>loadPitchOptions(button.closest('[data-pitch-id]'),id),
  generatePitch:()=>readPitch(button.closest('[data-pitch-id]'),id,button),
  pitchLanguage:()=>changePitchLanguage(button,id),
  fillPosition:()=>{const form=modal.querySelector('form');form.elements.lat.value=origin[0];form.elements.lng.value=origin[1];},
  add:()=>addLead(),editLead:()=>addLead(data.leads[id]),visit:()=>logVisit(id),dismiss:()=>modal.close(),lesson:()=>showLesson(id),
  planAdd:()=>save(w=>{const date=day();const ids=w.plans[date]??=[];if(!ids.includes(id)) ids.push(id);},'Added to today’s plan.'),
  planRemove:async()=>{if(await save(w=>{w.plans[day()]=(w.plans[day()]||[]).filter(x=>x!==id);},'Removed from plan.')) {beatDraft=null;savedRoute=null;renderBeatPreview();}},
  openAccount:()=>dialog('Mark account opened',safe(nameOf(data.leads[id])),'<p>Record the account opening for today.</p>'+submit('Confirm opening'),()=>save(w=>{w.leads[id].openedAt=day();},'Account opening recorded.')),
  category:()=>{if(category===id) return;category=id;for(const chip of main.querySelectorAll('[data-act="category"]')) {chip.classList.toggle('active',chip.dataset.id===id);chip.setAttribute('aria-pressed',String(chip.dataset.id===id));}updateResults();},profileTab:()=>{tab=id;render();},learnFilter:()=>{learnFilter=id;render();}
 };
 actions[act]?.();
});
document.addEventListener('submit',e=>{
 if(e.target.id==='beat-form') {e.preventDefault();previewBeat(e.target);}
});
document.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;updateResults();}});
document.addEventListener('change',e=>{
 if(e.target.closest('#beat-form')) {beatDraft=null;savedRoute=null;renderBeatPreview();}
 if(e.target.matches('[data-pitch-product]')) updatePitchProduct(e.target.closest('[data-pitch-id]'),e.target.value);
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
try {
 const [account,workspace,mapConfig]=await Promise.all([api('/api/session'),api('/api/workspace'),api('/api/maps-config')]);
 user=account;({data,revision}=workspace);configureGoogleMaps(mapConfig);
 render();
} catch(error) {
 main.innerHTML=heading('Disha workspace',safe(error.message),'<a class="btn primary" href="/">Reload workspace</a>');
}
