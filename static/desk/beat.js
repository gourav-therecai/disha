import {distance} from './store.js';

export const pointOf=lead=>Number.isFinite(lead.lat)&&Number.isFinite(lead.lng)?[lead.lat,lead.lng]:null;
const km=(a,b)=>distance(...a,b);

export function arrangeBeat(candidates,start,target) {
 const remaining=[...candidates];
 const ordered=[];
 let point=start;
 while(remaining.length&&ordered.length<target) {
  const rank=lead=>lead.followUp?0:1;
  const gap=lead=>point&&pointOf(lead)?km(point,pointOf(lead)):Infinity;
  remaining.sort((a,b)=>rank(a)-rank(b)||(gap(a)-gap(b)||0));
  const lead=remaining.shift();
  ordered.push(lead);
  point=pointOf(lead)||point;
 }
 return ordered;
}

export function beatNodes(stops,start,originLabel,label) {
 const nodes=start?[{number:0,label:originLabel,point:start,km:0}]:[];
 for(const [index,lead] of stops.entries()) {
  const point=pointOf(lead);
  if(!point) continue;
  const previous=nodes.at(-1);
  nodes.push({number:index+1,label:label(lead),point,km:previous?km(previous.point,point):0});
 }
 return nodes;
}

export function drawCoordinateBeat(host,nodes) {
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 360 320');
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Coordinate route graph with numbered stops and straight-line distances');
 const angles=nodes.map(node=>[node.point[1],node.point[0]]);
 const x0=Math.min(...angles.map(point=>point[0])),y0=Math.min(...angles.map(point=>point[1]));
 const x1=Math.max(...angles.map(point=>point[0])),y1=Math.max(...angles.map(point=>point[1]));
 const correction=Math.max(.001,Math.cos((y0+y1)*Math.PI/360));
 const scale=Math.min(280/Math.max((x1-x0)*correction,.00001),240/Math.max(y1-y0,.00001));
 const project=([lng,lat])=>[180+(lng-(x0+x1)/2)*correction*scale,160-(lat-(y0+y1)/2)*scale];
 const add=(tag,attrs,caption)=>{
  const element=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
  if(caption!==undefined) element.textContent=caption;
  svg.append(element);
 };
 const points=angles.map(project);
 for(let i=1;i<points.length;i++) {
  const [x1,y1]=points[i-1], [x2,y2]=points[i];
  add('line',{x1,y1,x2,y2,class:'beat-edge'});
  add('text',{x:(x1+x2)/2,y:(y1+y2)/2-9,class:'beat-edge-text'},nodes[i].km.toFixed(2)+' km');
 }
 for(const [i,node] of nodes.entries()) {
  const [cx,cy]=points[i];
  add('circle',{cx,cy,r:13,class:node.number?'beat-node':'beat-start'});
  add('text',{x:cx,y:cy+4,class:'beat-node-text'},node.number);
 }
 host.replaceChildren(svg);
}

const DAY=1440, WEEK=7*DAY;
const weekMinute=p=>p.day*DAY+p.hour*60+p.minute;

export function openingSlot(lead,arrival,engagement,localDay) {
 if(['CLOSED_TEMPORARILY','CLOSED_PERMANENTLY','FUTURE_OPENING'].includes(lead.businessStatus)) return null;
 if(!Array.isArray(lead.hours)||!Number.isFinite(lead.utcOffset)) return {start:arrival,known:false};
 const shift=lead.utcOffset-330;
 let earliest=Infinity;
 for(const period of lead.hours) {
  if(!period.open) continue;
  if(!period.close) return {start:arrival,known:true};
  const open=weekMinute(period.open);
  let close=weekMinute(period.close);
  if(close<=open) close+=WEEK;
  for(const offset of [-WEEK,0,WEEK]) {
   const start=Math.max(arrival,open+offset-localDay*DAY-shift);
   const end=close+offset-localDay*DAY-shift;
   if(start+engagement<=end) earliest=Math.min(earliest,start);
  }
 }
 return Number.isFinite(earliest)?{start:earliest,known:true}:null;
}

export function scheduleBeat(existing,candidates,start,{startMinute,budget,engagement,speed,target,localDay}) {
 const deadline=startMinute+budget,stops=[],added=[],unscheduled=[];
 let point=start, clock=startMinute;
 function estimate(lead) {
  const location=pointOf(lead);
  if(!point||!location) return {reason:'Travel could not be estimated'};
  const travel=Math.ceil(km(point,location)*60/speed);
  const arrival=clock+travel;
  const slot=openingSlot(lead,arrival,engagement,localDay);
  if(!slot) return {reason:'Closed during the available visit window'};
  const end=slot.start+engagement;
  if(end>deadline) return {reason:slot.known&&slot.start>arrival?'Opening hours do not fit the time budget':'Outside the time budget'};
  return {timing:{arrival,start:slot.start,end,travel,engagement,wait:slot.start-arrival,known:slot.known}};
 }
 function commit(lead,timing) {
  const scheduled={...lead,timing};
  stops.push(scheduled);
  clock=timing.end;
  point=pointOf(lead);
  return scheduled;
 }
 for(const stop of existing) {
  const option=estimate(stop);
  if(option.timing) commit(stop,option.timing);
  else unscheduled.push({...stop,reason:option.reason});
 }
 const remaining=[...candidates];
 while(existing.length+added.length<target&&!unscheduled.length) {
  const options=remaining.map(lead=>({lead,...estimate(lead)})).filter(option=>option.timing);
  options.sort((a,b)=>Number(Boolean(b.lead.followUp))-Number(Boolean(a.lead.followUp))||
   a.timing.end-b.timing.end||a.timing.travel-b.timing.travel);
  if(!options.length) break;
  const {lead,timing}=options[0];
  remaining.splice(remaining.indexOf(lead),1);
  added.push(commit(lead,timing));
 }
 return {stops,added,unscheduled,remaining,deadline,finish:clock};
}
