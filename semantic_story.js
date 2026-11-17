// Experimental local semantic QA. Captions are imperfect: never treat them as ground truth.
export const SEMANTIC_VERSION='0.4.0';
const MODEL='Xenova/vit-gpt2-image-captioning';
let captionerPromise;
const ignore=new Set(['the','a','an','is','are','in','on','of','to','and','with','at','as','it','there','this','that','image','picture','view','front','background','some','many','lot','standing','sitting','looking','large','small','man','person','people']);
const words=s=>new Set(String(s).toLowerCase().match(/[a-z]{3,}/g)?.filter(w=>!ignore.has(w))||[]);
const sim=(a,b)=>{const x=words(a),y=words(b);if(!x.size||!y.size)return 0;let overlap=0;for(const w of x)if(y.has(w))overlap++;return overlap/Math.max(1,new Set([...x,...y]).size)};
function hasVisualDiscontinuity(ratio,captionDiff){return ratio>.12&&captionDiff>.77;}
function personLabel(caption){
 const x=String(caption).toLowerCase();
 if(/\b(woman|women|girl|female)\b/.test(x))return 'woman';
 if(/\b(man|men|boy|male|gentleman)\b/.test(x))return 'man';
 if(/\b(person|people|human)\b/.test(x))return 'person';
 return null;
}
export function checkCaptionContradictions(captions,times){
 const labels=captions.map(personLabel);
 const count={man:0,woman:0};
 labels.forEach(s=>{if(s==='man'||s==='woman')count[s]++});
 const majority=count.man>count.woman?'man':count.woman>count.man?'woman':null;
 const notes=[];
 if(majority&&count[majority]>=2){
  labels.forEach((label,i)=>{
   if(label&&label!=='person'&&label!==majority)notes.push({
     frame:i+1,time:+times[i].toFixed(2),
     reason:'Описание кадра противоречит другим описаниям персонажа ('+
       (majority==='man'?'man':'woman')+' → '+label+'). Это может быть ошибкой модели, а не изменением персонажа.',
     confidence:'низкая',autoRemove:false
   });
  });
 }
 return notes;
}

async function getCaptioner(progress){
 if(!captionerPromise){
  captionerPromise=import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2')
    .then(async({pipeline,env})=>{env.allowLocalModels=false;progress?.('Загружаю модель смыслового описания кадров (первый раз может быть долго)…');return pipeline('image-to-text',MODEL,{device:'wasm'})})
    .catch(e=>{captionerPromise=null;throw e});
 }
 return captionerPromise;
}
export async function verifyContradictions({clip,asset,notes,capture,signature,distance,model,progress}){
 const checked=[];
 for(const note of notes){
  // Sample a tighter temporal neighborhood around the flagged frame.
  const t=note.time,step=Math.min(.30,Math.max(.10,(clip.out-clip.in)/40));
  const times=[-2,-1,0,1,2].map(k=>Math.min(clip.out-.04,Math.max(clip.in+.04,t+k*step)));
  const desc=[],vectors=[];
  for(let i=0;i<times.length;i++){
   progress?.('Повторная проверка '+(i+1)+'/5 у '+t.toFixed(2)+' с');
   const [frame,vec]=await Promise.all([capture(asset,times[i]),signature(asset,times[i])]);
   const output=await model(frame,{max_new_tokens:36});
   desc.push(String(output?.[0]?.generated_text||'').trim());
   vectors.push(vec);
  }
  const labels=desc.map(personLabel);
  const core=personLabel(desc[2]);
  const opposite=core==='man'?'woman':core==='woman'?'man':null;
  const incoming=distance(vectors[1],vectors[2]),outgoing=distance(vectors[2],vectors[3]);
  const returnDistance=distance(vectors[1],vectors[3]);
  const isolatedVisualJump=incoming>.12&&outgoing>.12&&returnDistance<Math.min(incoming,outgoing)*.75;
  // Find consecutive descriptions of the flagged subject; do not interpret
  // classification words as ground truth about the character's appearance.
  let first=2,last=2;
  if(core==='man'||core==='woman'){
   while(first>0&&labels[first-1]===core)first--;
   while(last<labels.length-1&&labels[last+1]===core)last++;
  }
  const repeated=core!==null&&core!=='person'&&last>first;
  const others=labels.filter((v,i)=>i<first||i>last);
  const opposed=!!opposite&&others.some(v=>v===opposite);
  const interval=repeated?{
   start:+Math.max(clip.in,times[first]-(times[1]-times[0])*.3).toFixed(2),
   end:+Math.min(clip.out,times[last]+(times[4]-times[3])*.3).toFixed(2)
  }:null;
  let conclusion='Одиночное противоречие в текстовом описании; визуальный дефект не подтверждён.';
  let severity='низкая';
  if(repeated&&opposed){
   severity='повышенная';
   conclusion='Подозрительное изменение описания повторяется на '+(last-first+1)+
      ' соседних кадрах ('+times[first].toFixed(2)+'–'+times[last].toFixed(2)+
      ' с). Это повод проверить изображение, но не доказательство смены персонажа.';
  }else if(repeated){
   conclusion='Соседние кадры описаны сходно; исходный единичный результат не выглядит изолированным.';
  }
  if(isolatedVisualJump){
   severity='повышенная';
   conclusion+=' Дополнительно обнаружен локальный скачок изображения.';
  }
  checked.push({...note,followUp:{times,captions:desc,isolatedVisualJump,
    repeated,interval,severity,conclusion,autoRemove:false}});
 }
 return checked;
}
export async function inspectStory({clips,assets,capture,signature,distance,progress}){
 const model=await getCaptioner(progress);
 const media=new Map(assets.map(a=>[a.id,a]));
 const shots=[],flags=[];
 for(let i=0;i<clips.length;i++){
  const c=clips[i],a=media.get(c.assetId);if(!a)continue;
  const d=c.out-c.in;
  // temporal storyboard: 5 spaced frames per shot, not a single middle frame
  const times=[.08,.27,.50,.73,.92].map(x=>c.in+d*x);
  const captions=[],signatures=[];
  for(let j=0;j<times.length;j++){
   progress?.('Сцена '+(i+1)+'/'+clips.length+': смысловой кадр '+(j+1)+'/5');
   const [frame,sg]=await Promise.all([capture(a,times[j]),signature(a,times[j])]);
   const output=await model(frame,{max_new_tokens:36});
   captions.push(String(output?.[0]?.generated_text||'').trim());
   signatures.push(sg);
  }
  const anomalies=[];
  for(let j=1;j<times.length-1;j++){
   const continuity=sim(captions[j-1],captions[j+1]);
   const difference=1-Math.max(sim(captions[j],captions[j-1]),sim(captions[j],captions[j+1]));
   const pixelJump=Math.min(distance(signatures[j-1],signatures[j]),distance(signatures[j],signatures[j+1]));
   const blink=distance(signatures[j-1],signatures[j+1]);
   // flag only isolated semantic and pixel excursions with return to preceding look
   if(continuity>.33&&hasVisualDiscontinuity(pixelJump,difference)&&blink<pixelJump*.75){
    const start=+(times[j]-(times[j]-times[j-1])*.45).toFixed(2);
    const end=+(times[j]+(times[j+1]-times[j])*.45).toFixed(2);
    anomalies.push({start,end,description:captions[j],reason:'Кратковременное изменение содержания и композиции; нужен просмотр'});
   }
  }
  const initialContradictions=checkCaptionContradictions(captions,times);
  const contradictions=initialContradictions.length?
    await verifyContradictions({clip:c,asset:a,notes:initialContradictions,capture,signature,distance,model,progress}):[];
  const item={index:i,label:c.label||a.file?.name||'Сцена',captions,times,anomalies,contradictions};
  shots.push(item);
  for(const z of anomalies)flags.push({clipIndex:i,...z});
 }
 const joins=shots.slice(0,-1).map((c,i)=>{
  const next=shots[i+1],s=sim(c.captions[4],next.captions[0]);
  return {index:i,similarity:+s.toFixed(2),description:s>.32?'Похожие смысловые объекты; ракурс и действие могут отличаться':'Переход содержания; возможно осознанная смена плана'};
 });
 return {shots,flags,joins};
}
export function renderStory(result){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return result.shots.map(s=>'<div style="margin:8px 0;padding:9px;border:1px solid #33445d;border-radius:8px"><b>'+esc(s.label)+'</b>'+
  '<div class="hint">'+s.captions.map((c,i)=>(i+1)+'. '+esc(c)).join('<br>')+'</div>'+
  (s.contradictions?.length?'<div class="hint" style="color:#f5b37f">Перепроверенные противоречия: '+s.contradictions.map(a=>
    '<p>Кадр '+a.frame+' ('+a.time+' с): '+esc(a.reason)+'<br><b>Повторная проверка:</b> '+esc(a.followUp?.conclusion||'Не проводилась')+
    (a.followUp?.interval?'<br><b>Подозрительный интервал:</b> '+a.followUp.interval.start+'–'+a.followUp.interval.end+' с':'')+
    '<br>'+a.followUp?.captions?.map((c,i)=>Number(a.followUp.times[i]).toFixed(2)+' с: '+esc(c)).join('<br>')+'</p>').join('')+'</div>':'')+
  (s.anomalies.length?'<p class="hint" style="color:#f5b37f">Подозрительные участки: '+s.anomalies.map(a=>a.start+'–'+a.end+' с').join(', ')+'</p>':'<p class="hint muted">Изолированных визуально-смысловых скачков по редким кадрам не найдено. Непроверенные дефекты возможны.</p>')+'</div>').join('')+
 '<h3 style="margin:12px 0 4px">Связность соседних сцен</h3>'+
 result.joins.map(j=>'<div class="hint">Стык '+(j.index+1)+' → '+(j.index+2)+': '+esc(j.description)+'</div>').join('')+
 '<p class="hint muted">Модель делает вероятностные описания отдельных изображений. Она может не увидеть плащ, искажение рук и геометрии. ИИ пока не удаляет объекты из видео.</p>';
}
