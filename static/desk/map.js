export function mountMap(host, leads, icon, {origin, labelText, mini=false, radius=5, externalIds=new Set()}) {
  let zoom=13;
  const tileSize=256;
  const draw=()=>{
    const width=host.clientWidth,height=host.clientHeight;
    if(!width || !height) return;
    const world=2**zoom*tileSize;
    const project=([lat,lng])=>[(lng+180)/360*world,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*world];
    const [cx,cy]=project(origin);
    const left=cx-width/2,top=cy-height/2;
    host.replaceChildren();
    for(let x=Math.floor(left/tileSize);x<=Math.floor((left+width)/tileSize);x++) {
      for(let y=Math.floor(top/tileSize);y<=Math.floor((top+height)/tileSize);y++) {
        const tile=new Image(tileSize,tileSize);
        tile.alt='';
        tile.style.left=x*tileSize-left+'px';
        tile.style.top=y*tileSize-top+'px';
        tile.addEventListener('error',()=>{tile.classList.add('failed'); label.textContent='Map tiles unavailable';});
        tile.src='https://tile.openstreetmap.org/'+zoom+'/'+x+'/'+y+'.png';
        host.append(tile);
      }
    }
    const overlay=(element,x,y)=>{
      element.style.left=x+'px';element.style.top=y+'px';host.append(element);
    };
    const circle=document.createElement('div');circle.className='radius';
    const diameter=radius*2000*world/(40075017*Math.cos(origin[0]*Math.PI/180));
    circle.style.width=circle.style.height=diameter+'px';
    overlay(circle,width/2,height/2);
    const originMarker=document.createElement('div');originMarker.className='origin';
    overlay(originMarker,width/2,height/2);
    for(const lead of leads) {
      if(lead.lat===null || lead.lng===null) continue;
      const [x,y]=project([lead.lat,lead.lng]);
      if(x-left<13 || y-top<13 || x-left>width-13 || y-top>height-13) continue;
      const pin=document.createElement('button');
      pin.className='pin';if(externalIds.has(lead.id)) {pin.dataset.act='previewPlace';pin.dataset.id=lead.id;} else pin.dataset.go='lead/'+lead.id;pin.title=lead.name;pin.setAttribute('aria-label',lead.name);pin.innerHTML=icon('pin');
      overlay(pin,x-left,y-top);
    }
    const label=document.createElement('div');label.className='maptag';label.textContent=mini?labelText:radius+' km radius · '+labelText;host.append(label);
    if(!mini) {
      const controls=document.createElement('div');controls.className='zoom';
      for(const [text,delta,name] of [['+',1,'Zoom in'],['−',-1,'Zoom out']]) {
        const button=document.createElement('button');button.textContent=text;button.setAttribute('aria-label',name);
        button.onclick=()=>{zoom=Math.max(11,Math.min(16,zoom+delta));draw();};controls.append(button);
      }
      host.append(controls);
    }
    const credit=document.createElement('a');credit.className='attribution';credit.href='https://www.openstreetmap.org/copyright';credit.target='_blank';credit.rel='noopener';credit.textContent='© OpenStreetMap contributors';
    host.append(credit);
  };
  draw();
  const observer=new ResizeObserver(draw);
  observer.observe(host);
  return ()=>observer.disconnect();
}
