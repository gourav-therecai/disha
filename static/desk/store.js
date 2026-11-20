export const center = [28.5706,77.3245];
export const categories = ['Pharmacy','Restaurant','Retail','Apparel','Healthcare','Services','Wholesale'];
export const day = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function closeVisit(workspace,visit) {
  if(!workspace.leads[visit.leadId] || !['Hot','Warm','Cold'].includes(visit.rating) || !visit.remarks.trim()) throw new Error('Choose a rating and enter visit remarks.');
  workspace.visits.push(visit);
}
export function distance(lat,lng,origin=center) {
  const radians=Math.PI/180;
  const a=Math.sin((lat-origin[0])*radians/2)**2+Math.cos(origin[0]*radians)*Math.cos(lat*radians)*Math.sin((lng-origin[1])*radians/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1,a)));
}
