// Conservative scan of a few local source frames around each edit.
// This is frame-composition matching, not action recognition or camera tracking.
export const OPTIMIZER_VERSION='0.2.1';
const round=n=>+n.toFixed(3);
function valid(c,asset,trim,side){
 if(!c||!asset)return false;
 return side==='left'?c.out-trim>=c.in+.6:c.in+trim<=c.out-.6;
}
export async function suggestBoundaries({clips,assets,review,signature,distance,onProgress}){
 const lookup=new Map(assets.map(a=>[a.id,a]));
 const cache=new Map(),suggestions=[];
 async function feature(c,t){
   const a=lookup.get(c.assetId);if(!a)throw Error('Не найден видеоисходник');
   const key=a.id+':'+t.toFixed(3);
   if(!cache.has(key))cache.set(key,await signature(a,t));
   return cache.get(key);
 }
 const leftOffsets=[0,.18,.36,.60],rightOffsets=[0,.18,.36,.60];
 for(let i=0;i<clips.length-1;i++){
   onProgress?.('Подбираю монтажную точку '+(i+1)+'/'+(clips.length-1));
   const left=clips[i],right=clips[i+1],a=lookup.get(left.assetId),b=lookup.get(right.assetId),report=review[i];
   if(!a||!b){suggestions.push({join:i+1,choice:'keep',reason:'Отсутствует исходник'});continue}
   try{
     const optsL=leftOffsets.filter(n=>valid(left,a,n,'left'));
     const optsR=rightOffsets.filter(n=>valid(right,b,n,'right'));
     const fa=await Promise.all(optsL.map(async n=>feature(left,Math.max(left.in+.04,left.out-n-.05))));
     const fb=await Promise.all(optsR.map(async n=>feature(right,Math.min(right.out-.04,right.in+n+.05))));
     const base=distance(fa[0],fb[0]);
     // Candidate score weights: composition + cost of removing footage + optional beat proximity.
     const beat=report?.beat?.time;
     let best={endTrim:0,startTrim:0,visual:base,score:base};
     const scored=[];
     for(let x=0;x<optsL.length;x++)for(let y=0;y<optsR.length;y++){
       const endTrim=optsL[x],startTrim=optsR[y],visual=distance(fa[x],fb[y]);
       const beatTime=(report?.time||0)-endTrim;
       // Never move a cut already near a found accent outside its musical window.
       if(Number.isFinite(beat)&&Math.abs((report?.time||0)-beat)<=.12&&Math.abs(beatTime-beat)>.12)continue;
       const beatPenalty=Number.isFinite(beat)?Math.min(.6,Math.abs(beatTime-beat))*.12:0;
       const score=visual+.018*(endTrim+startTrim)+beatPenalty;
       const candidate={endTrim,startTrim,visual,score};
       scored.push(candidate);
       if(score<best.score)best=candidate;
     }
     const gain=base-best.visual;
     const appreciable=gain>.025&&gain/Math.max(.05,base)>.18&&best.endTrim+best.startTrim>.01;
     if(!appreciable){
       suggestions.push({join:i+1,choice:'keep',baseline:round(base),reason:'Проверенные варианты обрезки не дали достаточно убедительного улучшения композиции. Оставить исходную склейку.'});
     }else{
       suggestions.push({join:i+1,choice:'visual',baseline:round(base),after:round(best.visual),
         trimLeft:best.endTrim,trimRight:best.startTrim,
         time:round(report?.time||0),targetTime:round((report?.time||0)-best.endTrim),
         reason:'Пограничные кадры могут стать ближе по цвету и композиции. Подрезать конец на '+best.endTrim.toFixed(2)+' с и начало следующего на '+best.startTrim.toFixed(2)+' с. Это НЕ оценка сюжета или движения.'});
     }
   }catch(e){suggestions.push({join:i+1,choice:'keep',reason:'Анализ не удался: '+String(e?.message||e)})}
 }
 return suggestions;
}
export function renderBoundarySuggestions(items){
 const clean=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<h3 style="margin:14px 0 7px">Подбор кадров у стыка · экспериментально</h3>'+
  items.map((s,i)=>'<div style="padding:9px;margin:7px 0;border:1px solid #35425b;border-radius:8px">'+
  '<b>Стык '+s.join+' → '+(s.join+1)+'</b><div class="hint">'+clean(s.reason)+'</div>'+
  (s.choice==='visual'?'<div class="hint">Различие композиции/цвета: '+s.baseline.toFixed(3)+' → '+s.after.toFixed(3)+'</div>'+
  '<button type="button" class="mini" data-visual-proposal="'+i+'">▶ Предпросмотр предложенной обрезки</button>':'')+
  '</div>').join('');
}
