// VIDEOMAKER DIRECTOR v1 — one-pass, conservative edit planning.
// Pure planning code: browser decode and UI orchestration live in index.html.
// Never claim a semantic defect was verified from image captions alone.
export const DIRECTOR_VERSION='1.0.0';
const fmt=n=>(+n).toFixed(2);
const limit=(x,a,b)=>Math.max(a,Math.min(b,x));
const duration=c=>Math.max(0,c.out-c.in);
export function montageLayout(clips){
 let t=0;const starts=[];
 for(let i=0;i<clips.length;i++){
   if(i){
     const p=clips[i-1],c=clips[i];
     if(p.kind!=='cut')t-=Math.max(0,Math.min(p.transition||0,duration(p)*.45,duration(c)*.45));
   }
   starts.push(t);t+=duration(clips[i]);
 }
 return {starts,total:t};
}
function nearbyBeat(peaks,t){
 let nearest=null;
 for(const p of peaks){
  if(!Number.isFinite(p)||p<0)continue;
  const diff=Math.abs(p-t);
  if(!nearest||diff<nearest.distance)nearest={time:p,distance:diff};
 }
 return nearest;
}
const num=(n,fallback)=>Number.isFinite(n)?n:fallback;
// One candidate means NO CHANGE to source duration; rhythm and visual continuity
// are balanced over the whole edit instead of greedily optimizing individual ends.
function optionsForJoin({visualDifference,beatDistance,hasMusic}){
 const opts=[{kind:'cut',transition:0,score:0,reason:'Чистая склейка сохраняет действие и не создаёт двойных контуров.'}];
 const diff=num(visualDifference,0);
 if(diff>.12){
  opts.push({kind:'dip',transition:.20,score:(diff-.12)*2.0-.025,
    reason:'Короткое затемнение смягчает заметную смену изображения без наложения планов.'});
 }
 if(hasMusic&&beatDistance<=.075&&diff>.20){
  opts.push({kind:'flash',transition:.12,score:(diff-.20)*.9-.045,
    reason:'Очень короткая вспышка попадает в музыкальный акцент; применять умеренно.'});
 }
 return opts;
}
export function planMontage({clips,assets=[],peaks=[],songDuration=0,signals=[]}){
 if(!Array.isArray(clips)||!clips.length)return {clips:[],changed:false,warnings:['Нет видео для монтажа'],joins:[],summary:'Добавь исходные видео.'};
 const sourceById=new Map(assets.map(a=>[a.id,a]));
 const prepared=clips.map(c=>({...c}));
 const warnings=[],joins=[];
 for(let i=0;i<prepared.length;i++){
  const c=prepared[i],src=sourceById.get(c.assetId);
  if(!src)warnings.push('Исходник сцены '+(i+1)+' отсутствует.');
  if(c.out<=c.in+.3)warnings.push('Сцена '+(i+1)+' слишком короткая для автоматической обработки.');
 }
 // Beam search through transition choices: penalize repetition of flash/dip,
 // avoid unnecessary length reduction and avoid transition stacking.
 let beam=[{cuts:[],score:0,last:'cut',totalEffects:0}];
 const baseLayout=montageLayout(prepared);
 for(let i=0;i<prepared.length-1;i++){
  const c=prepared[i],next=prepared[i+1],sig=signals[i]||{};
  const cutAt=baseLayout.starts[i+1];
  const beat=nearbyBeat(peaks,cutAt);
  const beatDistance=beat?.distance??Infinity;
  const choices=optionsForJoin({visualDifference:sig.visualDifference,
    beatDistance,hasMusic:songDuration>0&&peaks.length>0});
  const expanded=[];
  for(const prev of beam)for(const choice of choices){
   if(choice.kind!=='cut'&&(duration(c)<1||duration(next)<1))continue;
   const effects=prev.totalEffects+(choice.kind==='cut'?0:1);
   // prefer clean cuts; suppress sequences of cosmetic transitions.
   const repetition=choice.kind!=='cut'&&prev.last!=='cut'?.15:0;
   const abundance=effects>Math.max(1,Math.floor((prepared.length-1)/3))?.12*(effects-1):0;
   // Penalty for shifting musical placement by overlap duration.
   const displaced=choice.kind==='cut'?0:choice.transition;
   const beatCost=(Number.isFinite(beatDistance)&&beatDistance<=.18)?
      .22*limit(beatDistance+displaced,.0,.5):0;
   expanded.push({cuts:[...prev.cuts,{...choice,cutAt,beat,visualDifference:sig.visualDifference??null}],
     score:prev.score+choice.score-repetition-abundance-beatCost,
     last:choice.kind,totalEffects:effects});
  }
  beam=expanded.sort((a,b)=>b.score-a.score).slice(0,12);
 }
 const chosen=beam[0]||{cuts:[]};
 for(let i=0;i<chosen.cuts.length;i++){
  const target=chosen.cuts[i],left=prepared[i];
  // Preserve already selected valid transitions when they are harmless?
  // For one-shot directing, recompute only transitions, never trim source in/out.
  left.kind=target.kind;
  left.transition=target.transition;
  joins.push({join:i+1,time:+target.cutAt.toFixed(2),
   originalKind:clips[i].kind||'cut',kind:target.kind,transition:target.transition,
   reason:target.reason,beat:target.beat?{time:+target.beat.time.toFixed(2),distance:+target.beat.distance.toFixed(2)}:null,
   visualDifference:target.visualDifference===null?null:+target.visualDifference.toFixed(3)});
 }
 // Terminal transition is not meaningful.
 const last=prepared[prepared.length-1];last.kind='cut';last.transition=0;
 const layout=montageLayout(prepared);
 if(songDuration>layout.total+1){
  warnings.push('Исходников хватает только на '+fmt(layout.total)+' с из '+fmt(songDuration)+' с песни. '+ 
    'Не будем заполнять остальное повторами или растягиванием кадров без твоего согласия.');
 }
 if(!peaks.length)warnings.push('Музыкальные акценты не найдены; выбор основан на изображении и сохранении действия.');
 if(signals.some(s=>s?.error))warnings.push('Часть кадров не прочитана — для них выбраны безопасные склейки.');
 const changed=prepared.some((c,i)=>c.kind!==clips[i].kind||Math.abs((c.transition||0)-(clips[i].transition||0))>.001);
 return {clips:prepared,joins,warnings,changed,
  originalDuration:baseLayout.total,newDuration:layout.total,
  summary:'Сюжетный порядок и исходные границы кадров сохранены. Подобраны переходы для всей последовательности.'};
}
export function renderDirectorPlan(plan){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={cut:'Жёсткая склейка',dip:'Короткое затемнение',flash:'Вспышка'};
 return '<div class="hint" style="margin:10px 0"><b>Режиссёрская сборка · '+plan.clips.length+' сцен · '+
  fmt(plan.newDuration)+' с</b><p>'+esc(plan.summary)+'</p></div>'+
 plan.joins.map(j=>'<div class="hint" style="padding:8px;margin:6px 0;border:1px solid #36465e;border-radius:7px">'+
 '<b>Стык '+j.join+' → '+(j.join+1)+' · '+esc(names[j.kind]||j.kind)+'</b>'+
 '<div>'+esc(j.reason)+'</div>'+
 (j.beat?'<small>Акцент: '+fmt(j.beat.time)+' с · расхождение '+fmt(j.beat.distance)+' с</small>':'')+
 '</div>').join('')+
 plan.warnings.map(w=>'<p class="hint" style="color:#efb783">'+esc(w)+'</p>').join('')+
 '<p class="hint muted">Это автоматическая композиция по доступным признакам. История, жесты и проблемные предметы не могут быть гарантированно распознаны браузерной моделью. Фрагменты не удалены.</p>';
}
