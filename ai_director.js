// Videomaker AI Director. Optional semantic scene analysis in the browser.
// Downloads open model weights on first run. Source videos stay local.
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const CATEGORIES = [
  'a futuristic city skyline', 'skyscrapers and buildings',
  'a person standing on a rooftop', 'a close-up of a person',
  'a motorcycle', 'a road or highway', 'a dark building facade',
  'a vehicle chase', 'an indoor room', 'a bright abstract energy effect',
  'a night sky', 'a battle scene'
];
let classifierPromise;
function imageClassifier() {
  if (!classifierPromise) classifierPromise = import(CDN).then(async ({pipeline,env}) => {
    env.allowLocalModels = false;
    return pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {device:'wasm'});
  }).catch(e=>{classifierPromise=null;throw e});
  return classifierPromise;
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))}
async function classifyFrame(classifier,src){
  const out=await classifier(src,CATEGORIES);
  return out.slice(0,3).map(x=>({label:x.label,score:Number(x.score.toFixed(3))}));
}
export async function analyzeShots(shots,progress){
  if(!Array.isArray(shots)||!shots.length)throw Error('Нет видеокадров для анализа');
  progress?.('Загрузка модели CLIP в браузер…');
  const classifier=await imageClassifier();
  const results=[];
  for(let i=0;i<shots.length;i++){
    const shot=shots[i],frames=[];
    progress?.('Клип '+(i+1)+' / '+shots.length+': '+shot.label);
    for(const [position,src] of [['начало',shot.first],['конец',shot.last]]){
      if(!src){frames.push({position,labels:[]});continue}
      try{frames.push({position,labels:await classifyFrame(classifier,src)})}
      catch(e){frames.push({position,labels:[],error:String(e?.message||e)})}
    }
    results.push({order:i+1,label:shot.label,frames});
  }
  return results;
}
export function presentShotAnalysis(results){
  return results.map(item=>'<div class="ai-shot-result"><b>'+item.order+'. '+escapeHTML(item.label)+'</b>'+item.frames.map(f=>'<div><small>'+f.position+': '+(f.labels.length?f.labels.map(x=>escapeHTML(x.label)+' ('+Math.round(x.score*100)+'%)').join(', '):'Не определено')+'</small></div>').join('')+'</div>').join('');
}
