// Automatic visual anomaly flags for human review; NOT object removal / inpainting.
export const SCAN_VERSION='0.1.0';
const at=n=>Number(n).toFixed(2);
export async function scanClip({clip,asset,sample,distance,progress}){
 const dur=Math.max(0,clip.out-clip.in);
 if(dur<1.1)return {candidates:[],note:'Слишком короткий фрагмент для проверки'};
 const count=Math.min(24,Math.max(7,Math.ceil(dur/.55)));
 const times=Array.from({length:count},(_,i)=>clip.in+.05+(dur-.10)*i/(count-1));
 const signatures=[];
 for(let i=0;i<times.length;i++){
  progress?.('Проверяю кадр '+(i+1)+'/'+times.length+'…');
  signatures.push(await sample(asset,times[i]));
 }
 const transitions=signatures.slice(1).map((s,i)=>distance(signatures[i],s));
 const sorted=[...transitions].sort((a,b)=>a-b);
 const median=sorted[Math.floor(sorted.length/2)]||0;
 const candidates=[];
 // A high-contrast isolated jump which quickly returns to near the earlier appearance.
 for(let i=1;i<signatures.length-1;i++){
  const incoming=transitions[i-1],outgoing=transitions[i];
  const returnDistance=distance(signatures[i-1],signatures[i+1]);
  const threshold=Math.max(.085,median*2.6);
  if(incoming>threshold&&outgoing>threshold&&
     returnDistance<Math.min(incoming,outgoing)*.75){
   const half=Math.max(.10,(times[i+1]-times[i-1])*.42);
   candidates.push({start:+Math.max(clip.in+.05,times[i]-half).toFixed(2),
     end:+Math.min(clip.out-.05,times[i]+half).toFixed(2),
     score:+Math.min(incoming,outgoing).toFixed(3),
     reason:'Кратковременный визуальный скачок с возвратом к похожему изображению'});
  }
 }
 return {candidates:candidates.slice(0,5),note:candidates.length?
   'Это возможные вспышки/артефакты. Не все являются ошибками; проверь движение вручную.':
   'Резких одиночных скачков не обнаружено. Это НЕ означает, что в ролике нет лишних объектов или дефектов.'};
}
export function showScan(result,index){
 const safe=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 return '<div class="hint">'+safe(result.note)+'</div>'+
 result.candidates.map((s,i)=>'<div class="hint" style="margin:6px 0">'+safe(s.reason)+
 ' · '+at(s.start)+'–'+at(s.end)+' с <button type="button" class="mini" data-scan-choose="'+index+':'+i+'">Заполнить диапазон</button></div>').join('');
}
