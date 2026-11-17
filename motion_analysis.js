// Videomaker / Screen Motion v1
// Estimates apparent visual motion from consecutive frames in local browser.
// No network request, and no promise of true camera tracking.
const W=96,H=54;
function luminance(src){
  const im=new Image();
  return new Promise((resolve,reject)=>{
    im.onload=()=>{
      const c=document.createElement('canvas');c.width=W;c.height=H;
      const x=c.getContext('2d',{willReadFrequently:true});
      x.drawImage(im,0,0,W,H);
      const rgba=x.getImageData(0,0,W,H).data;
      const pix=new Uint8Array(W*H);
      for(let i=0;i<pix.length;i++)pix[i]=Math.round(.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2]);
      resolve(pix);
    };
    im.onerror=()=>reject(Error('Frame decode error'));
    im.src=src;
  });
}
function shift(a,b,x0,y0,x1,y1){
  // block search: compare reference a[x,y] to next frame b[x+dx,y+dy]
  let best={err:Infinity,dx:0,dy:0},zero=0;
  const score=(dx,dy)=>{
    let sum=0,n=0;
    for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=W||yy<0||yy>=H)continue;
      sum+=Math.abs(a[y*W+x]-b[yy*W+xx]);n++;
    }
    return n?sum/n:Infinity;
  };
  zero=score(0,0);
  for(let dy=-8;dy<=8;dy++)for(let dx=-12;dx<=12;dx++){
    let err=score(dx,dy);
    // tiny preference for stable translation on low-information images
    err+=.05*(Math.abs(dx)+Math.abs(dy));
    if(err<best.err)best={dx,dy,err};
  }
  return {...best,zero,improvement:Math.max(0,zero-best.err)};
}
const direction=(x,y)=>{
  if(Math.hypot(x,y)<1.1)return 'почти статичный';
  const sx=x>1?'вправо':x< -1?'влево':'';
  const sy=y>1?'вниз':y< -1?'вверх':'';
  return [sx,sy].filter(Boolean).join(' и ')||'слабое движение';
};
function classifyPairs(motion){
  const valid=motion.filter(x=>x.confident);
  if(!valid.length)return {title:'Движение не определено',note:'Недостаточно текстуры или есть сильная смена картинки',direction:'не определено',confidence:'низкая'};
  const sx=valid.reduce((a,x)=>a+x.dx,0)/valid.length;
  const sy=valid.reduce((a,x)=>a+x.dy,0)/valid.length;
  const divergence=valid.filter(x=>x.inconsistent).length;
  return {
    title:direction(sx,sy),
    direction:direction(sx,sy),
    confidence:valid.length>=2&&divergence===0?'средняя':'низкая',
    note:'Направление движения объектов по экрану; движение камеры часто противоположно. Смена масштаба и параллакс отдельно не измеряются.',
    x:+sx.toFixed(1),y:+sy.toFixed(1)
  };
}
export async function analyzeMotion(shots,progress){
  const output=[];
  for(let i=0;i<shots.length;i++){
    const shot=shots[i],duration=Math.max(.25,shot.out-shot.in);
    const points=[.1,.32,.54,.76,.94].map(t=>shot.in+t*duration);
    const gray=[];
    progress?.('Движение: '+(i+1)+'/'+shots.length+' · '+shot.label);
    for(const t of points){
      try{gray.push(await luminance(await shot.capture(t)));}
      catch(e){gray.push(null)}
    }
    const pairs=[];
    for(let j=0;j<gray.length-1;j++){
      if(!gray[j]||!gray[j+1])continue;
      const a=gray[j],b=gray[j+1];
      const global=shift(a,b,15,10,W-15,H-10);
      const left=shift(a,b,10,12,42,H-12);
      const right=shift(a,b,54,12,86,H-12);
      const disagree=Math.hypot(left.dx-right.dx,left.dy-right.dy);
      pairs.push({
        from:+points[j].toFixed(2),to:+points[j+1].toFixed(2),
        dx:global.dx,dy:global.dy,
        confident:global.improvement>1.5,
        inconsistent:disagree>6,
        left:[left.dx,left.dy],right:[right.dx,right.dy],
        improvement:+global.improvement.toFixed(2)
      });
    }
    output.push({order:i+1,label:shot.label,movement:classifyPairs(pairs),samples:pairs});
  }
  return output;
}
export function describeMotion(results){
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return results.map(s=>'<div style="padding:8px;border:1px solid #353a53;border-radius:7px"><b>'+
    s.order+'. '+esc(s.label)+'</b><div>Смещение изображения: '+esc(s.movement.title)+
    ' · уверенность: '+esc(s.movement.confidence)+'</div><small>'+esc(s.movement.note)+
    '</small></div>').join('');
}


// Adjacent transition check: estimate motion near OUT and IN separately.
// Vectors describe pixel displacement; they are not verified camera trajectories.
export async function analyzeJointMotion(items,progress){
  const output=[];
  for(let i=0;i<items.length;i++){
    progress?.('Проверка движения у стыка '+(i+1)+'/'+items.length);
    const item=items[i];
    try{
      const sample=async(capture,times)=>{
        const images=await Promise.all(times.map(t=>capture(t).then(luminance)));
        const measurements=[];
        for(let k=0;k<images.length-1;k++){
          const a=images[k],b=images[k+1];
          const mid=shift(a,b,17,12,W-17,H-12);
          const left=shift(a,b,10,12,42,H-12);
          const right=shift(a,b,54,12,86,H-12);
          const disparity=Math.hypot(left.dx-right.dx,left.dy-right.dy);
          const magnitude=Math.hypot(mid.dx,mid.dy);
          const reliable=mid.improvement>1.5&&disparity<=6&&magnitude>=1.1;
          measurements.push({dx:mid.dx,dy:mid.dy,reliable,disparity,improvement:mid.improvement});
        }
        const good=measurements.filter(x=>x.reliable);
        if(!good.length)return {confidence:'низкая',direction:'не определено',vector:null,measurements};
        const dx=good.reduce((sum,p)=>sum+p.dx,0)/good.length;
        const dy=good.reduce((sum,p)=>sum+p.dy,0)/good.length;
        const agreement=good.length>1?good.every(v=>(v.dx*dx+v.dy*dy)>0):false;
        const confidence=good.length>=2&&agreement?'средняя':'низкая';
        return {confidence,direction:direction(dx,dy),vector:{dx,dy},measurements};
      };
      const left=await sample(item.captureLeft,item.leftTimes);
      const right=await sample(item.captureRight,item.rightTimes);
      let verdict='недостаточно данных для сравнения движения',confidence='низкая',cosine=null;
      if(left.vector&&right.vector){
        const a=left.vector,b=right.vector;
        cosine=(a.dx*b.dx+a.dy*b.dy)/(Math.hypot(a.dx,a.dy)*Math.hypot(b.dx,b.dy));
        if(left.confidence==='средняя'&&right.confidence==='средняя'){
          confidence='средняя';
          verdict=cosine>.65?'похожие направления экранного движения':
            cosine<-.4?'возможный разворот экранного движения':
            'различающиеся направления экранного движения';
        }else verdict='направления измерены с низкой уверенностью';
      }
      output.push({join:i+1,assessed:true,left:{direction:left.direction,confidence:left.confidence},
        right:{direction:right.direction,confidence:right.confidence},
        verdict,confidence,cosine:cosine===null?null:+cosine.toFixed(2)});
    }catch(err){
      output.push({join:i+1,assessed:false,error:String(err?.message||err)});
    }
  }
  return output;
}
