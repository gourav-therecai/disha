import {categories} from './store.js';

const typesByCategory={
 Pharmacy:['pharmacy','drugstore'],
 Restaurant:['restaurant','cafe','fast_food_restaurant','bakery','bar'],
 Retail:['store','supermarket','grocery_store','convenience_store','electronics_store','hardware_store','furniture_store','department_store','shopping_mall','book_store','pet_store','jewelry_store'],
 Apparel:['clothing_store','shoe_store','sportswear_store','womens_clothing_store'],
 Healthcare:['hospital','doctor','dentist','physiotherapist','medical_clinic'],
 Services:['electrician','plumber','laundry','travel_agency','hair_salon','lawyer','real_estate_agency','insurance_agency','courier_service','tailor','beauty_salon','consultant','car_repair'],
 Wholesale:['wholesaler','warehouse_store']
};
let loader;
let config;
const mapsByHost=new WeakMap();

function load(key) {
 if(loader) return loader;
 loader=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  const callback='dishaGoogleMapsReady';
  const timer=setTimeout(()=>fail('Google Maps did not finish loading.'),15000);
  function fail(message) {
   clearTimeout(timer);script.remove();delete window[callback];
   reject(new Error(message));
  }
  window[callback]=()=>{clearTimeout(timer);delete window[callback];resolve(window.google.maps);};
  window.gm_authFailure=()=>{fail('Google Maps could not authorize the key. Check billing, enabled APIs and website restrictions.');};
  script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,v:'weekly',loading:'async',callback});
  script.async=true;
  script.onerror=()=>fail('Unable to load Google Maps.');
  document.head.append(script);
 }).catch(error=>{loader=undefined;throw error;});
 return loader;
}

export function configureGoogleMaps(value) { config=value; }
export function googleConfigured() { return Boolean(config?.key); }

export async function searchGoogle(origin,radius,category) {
 const maps=await load(config.key);
 const {Place,SearchNearbyRankPreference}=await maps.importLibrary('places');
 const [lat,lng]=origin;
 const groups=category==='All'?categories:[category];
 const settled=await Promise.allSettled(groups.map(async group=>{
  const {places}=await Place.searchNearby({
   fields:['id','displayName','formattedAddress','location'],
   locationRestriction:{center:{lat,lng},radius:radius*1000},
   includedTypes:typesByCategory[group],
   maxResultCount:20,
   rankPreference:SearchNearbyRankPreference.DISTANCE
  });
  return places.filter(place=>place.id&&place.displayName&&place.location).map(place=>({
   googlePlaceId:place.id,name:place.displayName,area:place.formattedAddress||'',
   category:group,lat:place.location.lat(),lng:place.location.lng()
  }));
 }));
 const failures=groups.filter((_,index)=>settled[index].status==='rejected');
 if(failures.length===groups.length) throw new Error('Google Places search failed. Check Places API (New), billing, key restrictions and quota, then retry.');
 const found=new Map();
 for(const result of settled) {
  if(result.status!=='fulfilled') continue;
  for(const place of result.value) {
   const current=found.get(place.googlePlaceId);
   if(!current) found.set(place.googlePlaceId,{...place,categories:[place.category]});
   else {
    current.categories.push(place.category);
    if(current.category==='Retail') current.category=place.category;
   }
  }
 }
 return {places:[...found.values()].map((place,index)=>({...place,id:'google-result-'+index})),failures};
}

export function mountGoogleMap(host,leads,{origin,radius,onSelect,onError}) {
 let active=true;
 let markers=[];
 let circle;
 async function draw() {
  const maps=await load(config.key);
  const [{Map,Circle},{AdvancedMarkerElement}]=await Promise.all([maps.importLibrary('maps'),maps.importLibrary('marker')]);
  if(!active) return;
  const [lat,lng]=origin;
  const center={lat,lng};
  let map=mapsByHost.get(host);
  if(!map) {
   map=new Map(host,{center,zoom:13,mapId:config.mapId||'DEMO_MAP_ID',mapTypeControl:false,streetViewControl:false,fullscreenControl:false,clickableIcons:false});
   mapsByHost.set(host,map);
  }
  circle=new Circle({map,center,radius:radius*1000,strokeColor:'#167553',strokeOpacity:.6,strokeWeight:2,fillColor:'#70c69e',fillOpacity:.12});
  map.fitBounds(circle.getBounds(),28);
  markers=[new AdvancedMarkerElement({map,position:center,title:'Search centre',zIndex:1000})];
  for(const lead of leads) {
   if(!Number.isFinite(lead.lat)||!Number.isFinite(lead.lng)) continue;
   const marker=new AdvancedMarkerElement({map,position:{lat:lead.lat,lng:lead.lng},title:lead.name});
   marker.addListener('click',()=>onSelect(lead));
   markers.push(marker);
  }
 }
 draw().catch(error=>{if(active) onError(error);});
 return ()=>{
  active=false;
  if(circle) circle.setMap(null);
  for(const marker of markers) marker.map=null;
 };
}

export async function getGooglePlace(googlePlaceId) {
 const maps=await load(config.key);
 const {Place}=await maps.importLibrary('places');
 const place=new Place({id:googlePlaceId});
 await place.fetchFields({fields:['displayName','formattedAddress','location']});
 return {name:place.displayName||'',area:place.formattedAddress||'',
  lat:place.location?.lat(),lng:place.location?.lng()};
}

export async function resolveBeatArea(address) {
 const maps=await load(config.key);
 const {Geocoder}=await maps.importLibrary('geocoding');
 const {results}=await new Geocoder().geocode({address,region:'IN'});
 const result=results[0];
 if(!result||result.partial_match) throw new Error('Enter a more specific area, including the city.');
 return {point:[result.geometry.location.lat(),result.geometry.location.lng()],label:result.formatted_address};
}

export async function drawGoogleBeat(host,nodes) {
 const maps=await load(config.key);
 const [{Map,Polyline},{AdvancedMarkerElement,PinElement},{LatLngBounds}]=await Promise.all([
  maps.importLibrary('maps'),maps.importLibrary('marker'),maps.importLibrary('core')
 ]);
 if(!host.isConnected) return;
 const position=point=>({lat:point[0],lng:point[1]});
 const map=new Map(host,{mapId:config.mapId||'DEMO_MAP_ID',center:position(nodes[0].point),zoom:14,
  mapTypeControl:false,streetViewControl:false,clickableIcons:false});
 const bounds=new LatLngBounds();
 let previous;
 for(const node of nodes) {
  const at=position(node.point);
  bounds.extend(at);
  const pin=new PinElement({glyphText:String(node.number),background:node.number?'#147354':'#245b93',borderColor:'#fff',glyphColor:'#fff'});
  const marker=new AdvancedMarkerElement({map,position:at,title:node.label});
  marker.append(pin);
  if(previous) {
   new Polyline({map,path:[position(previous.point),at],geodesic:true,strokeColor:'#147354',strokeWeight:4});
   const label=document.createElement('span');
   label.className='beat-edge-label';
   label.textContent=node.km.toFixed(2)+' km';
   const mid=[(previous.point[0]+node.point[0])/2,(previous.point[1]+node.point[1])/2];
   const edge=new AdvancedMarkerElement({map,position:position(mid),title:label.textContent,zIndex:100});
   edge.append(label);
  }
  previous=node;
 }
 if(nodes.length>1) map.fitBounds(bounds,50);
}
