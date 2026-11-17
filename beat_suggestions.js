// Beat-driven edit suggestions; reversible and non-destructive until user confirms.
// This module does not infer stories, camera continuity, or true downbeats.
export const SUGGEST_VERSION='0.1.0';
const f=n=>Number(n).toFixed(2);
export function makeSuggestions({clips,assets,review}){
 const lookup=new Map(assets.map(a=>[a.id,a]));
 return review.map((r,i)=>{
   const left=clips[i],right=clips[i+1],asset=lookup.get(left.assetId);
   const beat=r.beat;
   const base={join:i+1,time:r.time,originalTime:r.time,choice:'keep',change:0,
     explanation:'Сохранить текущую склейку. Движение камеры не подтверждено.'};
   if(!beat)return base;
   const shift=beat.time-r.time;
   if(Math.abs(shift)>.2)return {...base,explanation:'Музыкальный акцент '+f(Math.abs(shift))+' с от склейки — корректировка слишком велика для автоматического предложения.'};
   if(Math.abs(shift)<.035)return {...base,explanation:'Склейка уже достаточно близко к музыкальному акценту.'};
   if(shift<0){
     if(left.out+shift-left.in<.6)return base;
     return {...base,choice:'trim',change:+shift.toFixed(3),targetTime:beat.time,
       explanation:'Укоротить конец клипа '+(i+1)+' на '+f(-shift)+' с для попадания в акцент. Только ритмическая коррекция; сюжет не оценён.'};
   }
   // Extending may reveal unreviewed material. Never silently lengthen source footage.
   if(!asset||left.out+shift>asset.duration-.04)return {...base,explanation:'Для сдвига на акцент потребовалось бы продлить предыдущий клип за предел доступного материала.'};
   return {...base,choice:'extend',change:+shift.toFixed(3),targetTime:beat.time,
      explanation:'Возможность продлить клип '+(i+1)+' на '+f(shift)+' с есть, но это может изменить действие. Применять только после просмотра.'};
 });
}
export function previewSuggestionHtml(items){
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<h3 style="margin:12px 0 6px">Предложения по музыкальным точкам (не применены)</h3>'+
 items.map((s,i)=>'<div style="padding:9px;border:1px solid #35425b;border-radius:9px;margin:7px 0">'+
 '<b>Стык '+s.join+' → '+(s.join+1)+'</b><div style="font-size:12px;margin:5px 0">'+escape(s.explanation)+'</div>'+
 (s.choice==='keep'?'': '<button type="button" class="mini" data-beat-proposal="'+i+'">Предпросмотр сдвига на '+f(Math.abs(s.change))+' с</button>')+
 '</div>').join('');
}
