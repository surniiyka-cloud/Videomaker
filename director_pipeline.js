// VIDEOMAKER DIRECTOR v1 — one-pass, conservative edit planning.
// Pure planning code: browser decode and UI orchestration live in index.html.
// Never claim a semantic defect was verified from image captions alone.
export const DIRECTOR_VERSION='1.3.0';
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
function optionsForJoin({visualDifference,beatDistance,hasMusic,semanticSimilarity}){
 const diff=num(visualDifference,0);
 const known=Number.isFinite(visualDifference);
 const storyChange=Number.isFinite(semanticSimilarity)&&semanticSimilarity<.26;
 const closeBeat=hasMusic&&beatDistance<.07;
 const opts=[{kind:'cut',transition:0,
   score:closeBeat?.10:0,
   reason:closeBeat?'Точная склейка на сильный музыкальный акцент.':'Чистая склейка без декоративной анимации.'}];
 // A restrained cinematic transition, not a PowerPoint push or wipe.
 // Avoid fade-on-fade across highly dissimilar frames to reduce ghosting.
 if(known&&diff<.23){
  opts.push({kind:'dissolve',transition:storyChange?.24:.32,
    score:(storyChange?.21:.14)+Math.min(.045,diff*.15)-(closeBeat?.055:0),
    reason:'Короткое кинематографическое растворение; планы мягко сменяются без перемещения экранных слоёв.'});
 }
 if(storyChange||(known&&diff>=.18)){
  opts.push({kind:'dip',transition:storyChange?.34:.26,
    score:(known&&diff>.22?.24:.13)-(closeBeat?.05:0),
    reason:'Смена места или композиции через краткое затемнение; избегает двоящихся контуров.'});
 }
 // A flash has a narrative motivation only on a strong beat AND markedly bright action.
 // Color-difference alone cannot establish that, so never add it automatically.
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
 let beam=[{cuts:[],score:0,last:'cut',totalEffects:0,shift:0}];
 const originalLayout=montageLayout(prepared);
 const baseLayout=montageLayout(prepared.map(c=>({...c,kind:'cut',transition:0})));
 for(let i=0;i<prepared.length-1;i++){
  const c=prepared[i],next=prepared[i+1],sig=signals[i]||{};
  const expanded=[];
  for(const prev of beam){
   const prelim=baseLayout.starts[i+1]-prev.shift;
   const currentBeat=nearbyBeat(peaks,prelim);
   const choices=optionsForJoin({visualDifference:sig.visualDifference,
     beatDistance:currentBeat?.distance??Infinity,semanticSimilarity:sig.semanticSimilarity,
     hasMusic:songDuration>0&&peaks.length>0});
   for(const choice of choices){
    if(choice.kind!=='cut'&&(duration(c)<1||duration(next)<1))continue;
    const overlap=choice.kind==='cut'?0:Math.min(choice.transition,duration(c)*.45,duration(next)*.45);
    const actualCut=prelim-overlap;
    const beat=nearbyBeat(peaks,actualCut);
    const beatDistance=beat?.distance??Infinity;
    const effects=prev.totalEffects+(choice.kind==='cut'?0:1);
    // Protect musical synchronization and avoid flashy effects in rapid succession.
    const repetition=choice.kind!=='cut'&&prev.last!=='cut'?.04:0;
    const abundance=effects>Math.max(1,Math.floor((prepared.length-1)/3))?.035*(effects-1):0;
    const beatCost=Number.isFinite(beatDistance)&&beatDistance<=.5?
      .22*limit(beatDistance,0,.5):0;
    expanded.push({cuts:[...prev.cuts,{...choice,cutAt:actualCut,beat,visualDifference:sig.visualDifference??null}],
      score:prev.score+choice.score-repetition-abundance-beatCost,
      last:choice.kind,totalEffects:effects,shift:prev.shift+overlap});
   }
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
   visualDifference:target.visualDifference===null?null:+target.visualDifference.toFixed(3),
   semanticSimilarity:Number.isFinite(signals[i]?.semanticSimilarity)?+signals[i].semanticSimilarity.toFixed(2):null});
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
  originalDuration:originalLayout.total,newDuration:layout.total,
  summary:'Сюжетный порядок и исходные границы кадров сохранены. Подобраны переходы для всей последовательности.'};
}
export function renderDirectorPlan(plan){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={cut:'Жёсткая склейка',push:'Кинематографический сдвиг',wipe:'Мягкое раскрытие',dip:'Короткое затемнение',flash:'Вспышка',wipe:'Мягкое раскрытие'};
 return '<div class="hint" style="margin:10px 0"><b>Режиссёрская сборка · '+plan.clips.length+' сцен · '+
  fmt(plan.newDuration)+' с</b><p>'+esc(plan.summary)+'</p></div>'+
 plan.joins.map(j=>'<div class="hint" style="padding:8px;margin:6px 0;border:1px solid #36465e;border-radius:7px">'+
 '<b>Стык '+j.join+' → '+(j.join+1)+' · '+esc(names[j.kind]||j.kind)+'</b>'+
 '<div>'+esc(j.reason)+'</div>'+
 '<button type="button" class="mini" style="margin:5px 0" data-one-join="'+(j.join-1)+'">▶ Посмотреть переход</button>'+
 (j.beat?'<small>Акцент: '+fmt(j.beat.time)+' с · расхождение '+fmt(j.beat.distance)+' с</small>':'')+
 (j.semanticSimilarity!==null?'<div><small>Смысловое сходство описаний кадров: '+j.semanticSimilarity.toFixed(2)+' (ориентир, не доказательство непрерывности)</small></div>':'')+
 '</div>').join('')+
 plan.warnings.map(w=>'<p class="hint" style="color:#efb783">'+esc(w)+'</p>').join('')+
 '<p class="hint muted">Это автоматическая композиция по доступным признакам. История, жесты и проблемные предметы не могут быть гарантированно распознаны браузерной моделью. Фрагменты не удалены.</p>';
}
