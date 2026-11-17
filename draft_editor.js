// Browser-only draft timeline builder. Never deletes source files or rewrites footage.
export const DRAFT_VERSION='0.2.0';
const f=x=>Number(x).toFixed(2);
const clone=x=>({...x});
const span=c=>Math.max(0,c.out-c.in);
function starts(clips){
 const result=[];let pos=0;
 for(let i=0;i<clips.length;i++){
  if(i){
   const a=clips[i-1],b=clips[i];
   const ov=a.kind==='dissolve'?Math.max(0,Math.min(+a.transition||0,span(a)*.45,span(b)*.45)):0;
   pos-=ov;
  }
  result.push(pos);pos+=span(clips[i]);
 }
 return {times:result,total:pos};
}
function bestBeat(beats,time){
 let chosen=null;
 for(const t of beats){
  const d=Math.abs(t-time);
  if(chosen===null||d<chosen.distance)chosen={time:t,distance:d};
 }
 return chosen;
}
export function buildDraft({clips,assets,peaks=[],edits={}}){
 const media=new Map(assets.map(a=>[a.id,a]));
 const warnings=[],actions=[],draft=[];
 for(let i=0;i<clips.length;i++){
  const c=clone(clips[i]),asset=media.get(c.assetId),e=edits[i]||{};
  if(!asset){warnings.push('Клип '+(i+1)+': исходник не найден');continue}
  if(e.exclude){
   actions.push('Исключена сцена '+(i+1)+' «'+c.label+'» по выбору пользователя');
   continue;
  }
  if(e.skipStart!==''&&e.skipEnd!==''&&e.skipStart!==undefined&&e.skipEnd!==undefined){
   const start=Number(e.skipStart),end=Number(e.skipEnd);
   if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||
      start<c.in||end>c.out||start-c.in<.24||c.out-end<.24){
     warnings.push('Сцена '+(i+1)+': диапазон исключения должен находиться внутри клипа, оставляя минимум 0,24 с с каждой стороны. Пропуск не применён.');
     draft.push(c);
   }else{
     const before={...c,out:start,kind:'cut',transition:0,label:c.label+' · до вырезки'};
     const after={...c,in:end,label:c.label+' · после вырезки'};
     draft.push(before,after);
     actions.push('Сцена '+(i+1)+': исключён интервал источника '+f(start)+'–'+f(end)+' с');
     warnings.push('После удаления середины сцены '+(i+1)+' возникнет склейка внутри исходного ролика. Проверь, не стало ли движение резким.');
   }
  }else draft.push(c);
 }
 // The user-ordered story sequence is authoritative; never reorder scenes.
 if(!draft.length)return {clips:[],warnings:[...warnings,'Не осталось ни одной сцены'],actions,changed:false};
 const before=starts(draft);
 for(let i=1;i<draft.length;i++){
  const t=starts(draft).times[i],b=bestBeat(peaks,t),left=draft[i-1];
  if(!b||b.distance<.025||b.distance>.16)continue;
  // Only shorten the OUT of an earlier clip. Never extend or remove an unreviewed
  // section in the middle and never change a dissolving transition silently.
  const delta=t-b.time;
  if(delta<=0||span(left)-delta<.65||left.kind!=='cut')continue;
  // Do not remove part of the user's chosen split boundary.
  if(left.label.includes('· до вырезки'))continue;
  left.out-=delta;
  actions.push('Стык '+i+' → '+(i+1)+': конец предыдущего клипа укорочен на '+f(delta)+' с для музыкального акцента '+f(b.time)+' с');
 }
 // Avoid a montage longer than the available track; do not synthesize or loop footage.
 const after=starts(draft);
 const compare=clips.length!==draft.length||draft.some((c,i)=>c.in!==clips[i]?.in||c.out!==clips[i]?.out||c.assetId!==clips[i]?.assetId||c.label!==clips[i]?.label);
 return {clips:draft,actions,warnings,changed:compare,originalDuration:starts(clips).total,
   newDuration:after.total,missingSongPart:null};
}
export function draftPanel(clips){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<div class="toolbar" style="align-items:center;justify-content:space-between;margin-top:12px">'+
 '<h3 style="margin:0">Черновой монтаж · сцены и очистка</h3><small>v'+DRAFT_VERSION+'</small></div>'+
 '<p class="hint muted">Порядок сохраняется. Отметь ненужные сцены или укажи интервал <b>в секундах исходного файла</b>, который надо вырезать. Без отметок ничего не удаляется.</p>'+
 clips.map((c,i)=>'<div style="border:1px solid #38455c;padding:10px;border-radius:8px;margin:7px 0" data-draft-item="'+i+'">'+
 '<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-draft-exclude="'+i+'"> Исключить сцену '+(i+1)+': '+esc(c.label)+'</label>'+
 '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px"><small>Вырезать внутри:</small>'+
 '<input type="number" step="0.01" min="'+c.in+'" max="'+c.out+'" placeholder="Начало, с" data-draft-start="'+i+'" style="width:115px">'+
 '<span>—</span><input type="number" step="0.01" min="'+c.in+'" max="'+c.out+'" placeholder="Конец, с" data-draft-end="'+i+'" style="width:115px">'+
 '<small>Диапазон ролика: '+f(c.in)+'–'+f(c.out)+' с</small></div>'+
 '<button type="button" class="mini" style="margin-top:7px" data-draft-inspect="'+i+'">◈ Найти визуальные аномалии</button><div data-draft-scan-result="'+i+'" class="hint muted"></div></div>').join('')+
 '<div class="toolbar"><button type="button" class="primary" id="draftGenerate">✦ Собрать предложение</button></div>'+
 '<div id="draftResult" aria-live="polite" class="hint"></div>';
}
export function draftSummary(result){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<p><b>Предложенный монтаж:</b> '+result.clips.length+' фрагментов · '+f(result.originalDuration)+' → '+f(result.newDuration)+' с</p>'+
 '<p>'+(!result.actions.length?'Обрезки не нужны: оставлен текущий порядок и длительности.':result.actions.map(esc).join('<br>'))+'</p>'+
 (result.warnings.length?'<p style="color:#f0b17e">'+result.warnings.map(esc).join('<br>')+'</p>':'')+
 (result.clips.length?'<div class="toolbar"><button type="button" id="draftTry" class="mini primary">▶ Предпросмотр черновика</button></div>':'');
}
