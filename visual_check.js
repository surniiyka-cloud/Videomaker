// Fast visual seam check. These are image-level heuristics, NOT camera continuity.
export const VISUAL_VERSION='0.1.0';
const W=80,H=45;
async function decode(source){
 const image=new Image();
 return await new Promise((resolve,reject)=>{
   image.onload=()=>{
     try{
       const c=document.createElement('canvas');c.width=W;c.height=H;
       const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0,W,H);
       resolve(g.getImageData(0,0,W,H).data);
     }catch(e){reject(e)}
   };image.onerror=()=>reject(Error('Не удалось прочитать изображение'));
   image.src=source;
 });
}
function describe(rgba){
 let colors=[0,0,0],edge=0;
 const tiles=Array.from({length:12},()=>[0,0,0,0]);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const p=(y*W+x)*4;
   const idx=Math.floor(y/H*3)*4+Math.floor(x/W*4);
   const t=tiles[idx];t[0]+=rgba[p];t[1]+=rgba[p+1];t[2]+=rgba[p+2];t[3]++;
   colors[0]+=rgba[p];colors[1]+=rgba[p+1];colors[2]+=rgba[p+2];
   if(x>0&&y>0){
     const q=p-4,o=p-4*W;
     edge+=(Math.abs(rgba[p]-rgba[q])+Math.abs(rgba[p+1]-rgba[q+1])+
            Math.abs(rgba[p]-rgba[o])+Math.abs(rgba[p+1]-rgba[o+1]))/4;
   }
 }
 const n=W*H;
 return {color:colors.map(x=>x/n),tiles:tiles.map(t=>t.slice(0,3).map(v=>v/t[3])),edge:edge/n};
}
function compare(a,b){
 const norm=(v,w)=>Math.abs(v-w)/255;
 let color=0,tiles=0;
 for(let k=0;k<3;k++)color+=norm(a.color[k],b.color[k])/3;
 for(let i=0;i<12;i++)for(let k=0;k<3;k++)tiles+=norm(a.tiles[i][k],b.tiles[i][k])/36;
 const edges=Math.min(1,Math.abs(a.edge-b.edge)/45);
 return {color:+color.toFixed(3),composition:+tiles.toFixed(3),texture:+edges.toFixed(3)};
}
export async function inspectJoints(items,onProgress){
 const all=[];
 for(let i=0;i<items.length;i++){
  const item=items[i];
  onProgress?.('Визуальная проверка '+(i+1)+'/'+items.length);
  try{
   const a=await decode(await item.captureLeft());
   const b=await decode(await item.captureRight());
   const diff=compare(describe(a),describe(b));
   // A descriptive tonal/layout category only. Can NEVER certify that camera motion matches.
   const score=diff.color*.35+diff.composition*.55+diff.texture*.10;
   const tonal=score<.09?'цвет и крупные формы похожи':score<.18?'умеренное различие изображения':'заметное различие изображения';
   all.push({join:i+1,diff,score:+score.toFixed(3),tonal,assessed:true});
  }catch(e){all.push({join:i+1,assessed:false,error:String(e?.message||e)})}
 }
 return all;
}
