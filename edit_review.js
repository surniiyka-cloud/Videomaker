// Videomaker: non-destructive editing review. No AI result is treated as certain.
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function absTime(t){return (Math.floor(t/60)).toString().padStart(2,'0')+':'+(t%60).toFixed(2).padStart(5,'0')}
function clean(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function semanticLabels(shot,pos){
 const frame=shot?.frames?.find(x=>x.position===pos);
 return frame?.labels?.slice(0,2)?.filter(x=>x.score>.15)?.map(x=>x.label)||[];
}
function matchSemantic(a,b){
 if(!a||!b)return null;
 const l=semanticLabels(a,'конец'),r=semanticLabels(b,'начало');
 if(!l.length||!r.length)return null;
 return l.some(x=>r.includes(x));
}
function nearestBeat(beats,t){
 if(!beats?.length)return null;
 let best=null;
 for(const b of beats){
  const dt=Math.abs(t-b);
  if(!best||dt<best.distance)best={time:b,distance:dt};
 }
 return best;
}
export function reviewMontage({clips,peaks=[],motions=[],scenes=[]}){
 if(!Array.isArray(clips)||clips.length<2)return [];
 let t=0;
 const times=[];
 for(let i=0;i<clips.length;i++){
  if(i){
   const previous=clips[i-1],d=Math.max(.1,previous.out-previous.in),
     thisDur=Math.max(.1,clips[i].out-clips[i].in);
   t-=previous.kind==='dissolve'?clamp(+previous.transition||0,0,Math.min(d,thisDur)*.45):0;
  }
  times.push(t);
  t+=Math.max(.1,clips[i].out-clips[i].in);
 }
 return clips.slice(0,-1).map((left,i)=>{
  const right=clips[i+1],time=times[i+1],
    motionA=motions[i]?.movement,motionB=motions[i+1]?.movement;
  const reliableA=motionA?.confidence==='средняя',reliableB=motionB?.confidence==='средняя';
  const sameMovement=reliableA&&reliableB&&motionA?.direction===motionB?.direction;
  const mismatch=reliableA&&reliableB&&!sameMovement;
  const semantic=matchSemantic(scenes[i],scenes[i+1]);
  const beat=nearestBeat(peaks,time);
  const messages=[];
  let risk='не проверено';
  if(left.kind==='dissolve'){
   risk='проверить вручную';
   messages.push('Растворение может двоить здания или персонажей. Без подтверждённой совместимости движения безопаснее жёсткая склейка.');
  }else messages.push('Жёсткая склейка не создаёт артефактов наложения.');
  if(mismatch){risk='возможный скачок движения';messages.push('Направление движения изображения меняется; проверить склейку по действию или на музыкальном ударе.')}
  else if(sameMovement)messages.push('Направление движения согласуется, но геометрия перспективы не подтверждена.');
  else messages.push('Данных о движении недостаточно для уверенного решения — не применять автоматический зум.');
  if(semantic===false)messages.push('Ведущие темы кадров различаются; это может быть допустимой сменой плана.');
  if(semantic===true)messages.push('Ведущие темы кадров похожи, но пространственную непрерывность это не гарантирует.');
  if(beat){
    if(beat.distance<=.25)messages.push('Рядом музыкальный акцент: '+absTime(beat.time)+' (расхождение '+beat.distance.toFixed(2)+' с).');
    else messages.push('Ближайший найденный акцент: '+absTime(beat.time)+' (расхождение '+beat.distance.toFixed(2)+' с); сдвигать склейку без просмотра нельзя.');
  }else messages.push('Музыкальные акценты ещё не найдены.');
  return {join:i+1,time:+time.toFixed(3),risk,beat:beat&&{time:+beat.time.toFixed(3),distance:+beat.distance.toFixed(3)},messages,
    action:left.kind==='dissolve'?'Проверить, не заменить ли растворение жёсткой склейкой':'Оставить жёсткую склейку до визуальной проверки'};
 });
}
export function renderReview(items){
 return items.map(r=>'<article style="border:1px solid #353c54;padding:10px;border-radius:8px;margin-top:9px">'+
 '<b>Стык '+r.join+' → '+(r.join+1)+' · '+absTime(r.time)+'</b>'+
 '<div style="margin:5px 0;color:#d3ba92">Статус: '+clean(r.risk)+'</div>'+
 '<div><strong>'+clean(r.action)+'</strong></div>'+
 '<ul style="margin:6px 0 0;padding-left:18px">'+r.messages.map(x=>'<li>'+clean(x)+'</li>').join('')+'</ul></article>').join('');
}
