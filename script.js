const $=s=>document.querySelector(s);
const stage=$("#stage"), sctx=stage.getContext("2d");
const preview=$("#preview"), pctx=preview.getContext("2d");
const wrap=$("#stageWrap"), crop=$("#cropBox"), adjustBox=$("#adjustBox");
let mode="sticker", img=null, selecting=false, selection=null, adjust=null;
let results=[], bgTransparent=false, whiteBorder=false;

const SPEC={
 sticker:{ratio:370/320,w:370,h:320,label:"370 × 320 px以内（スタンプ用）"},
 emoji:{ratio:1,w:180,h:180,label:"180 × 180 px（絵文字用）"}
};

function updateMode(){
  const s=SPEC[mode];
  $("#spec").textContent=`切り抜き比率：${mode==="sticker"?"370 : 320":"1 : 1"}　／　書き出し：${s.label}`;
  $("#total").textContent=$("#count").value;
  if(img) resetSelection();
}
document.querySelectorAll(".switch button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".switch button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");mode=b.dataset.mode;updateMode();
});
$("#count").onchange=()=>{$("#total").textContent=$("#count").value;};
$("#file").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const im=new Image();
  im.onload=()=>{img=im;results=[];bgTransparent=false;setupCanvas();renderSheet();$("#sheetStep").classList.remove("hidden");$("#adjustStep").classList.add("hidden");resetSelection();refresh();toast("シートを読み込みました");};
  im.src=URL.createObjectURL(f);
};

function setupCanvas(){
  const maxW=Math.min(wrap.clientWidth||800,900), scale=Math.min(1,maxW/img.naturalWidth);
  stage.width=Math.round(img.naturalWidth*scale);stage.height=Math.round(img.naturalHeight*scale);
}
function renderSheet(){sctx.clearRect(0,0,stage.width,stage.height);sctx.drawImage(img,0,0,stage.width,stage.height);}
function resetSelection(){selection=null;crop.classList.add("hidden");$("#adjustBtn").classList.add("hidden");$("#startSelect").classList.remove("hidden");$("#sheetProgress").textContent=`${results.length+1} / ${$("#count").value}`;}
$("#startSelect").onclick=()=>{selecting=true;crop.classList.remove("hidden");$("#startSelect").classList.add("hidden");$("#adjustBtn").classList.remove("hidden");toast("絵のまわりを指でドラッグしてください");};

function wrapPoint(e){const r=wrap.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function setCropFromRect(x,y,w,h){
  crop.style.left=(x/wrap.clientWidth*100)+"%";crop.style.top=(y/wrap.clientHeight*100)+"%";
  crop.style.width=(w/wrap.clientWidth*100)+"%";crop.style.height=(h/wrap.clientHeight*100)+"%";
}
function rectFromCrop(){
  const a=wrap.getBoundingClientRect(),b=crop.getBoundingClientRect();
  return{x:b.left-a.left,y:b.top-a.top,w:b.width,h:b.height};
}
let drawStart=null;
wrap.addEventListener("pointerdown",e=>{
  if(!selecting)return;
  if(e.target!==stage)return;
  e.preventDefault();wrap.setPointerCapture(e.pointerId);drawStart=wrapPoint(e);
});
wrap.addEventListener("pointermove",e=>{
  if(!drawStart)return;e.preventDefault();const p=wrapPoint(e),r=SPEC[mode].ratio;
  let dx=p.x-drawStart.x,dy=p.y-drawStart.y;
  let w=Math.abs(dx),h=Math.abs(dy);
  if(w/h>r)h=w/r;else w=h*r;
  if(w<40||h<40)return;
  let x=dx<0?drawStart.x-w:drawStart.x,y=dy<0?drawStart.y-h:drawStart.y;
  x=Math.max(0,Math.min(wrap.clientWidth-w,x));y=Math.max(0,Math.min(wrap.clientHeight-h,y));
  w=Math.min(w,wrap.clientWidth-x);h=w/r;if(y+h>wrap.clientHeight){h=wrap.clientHeight-y;w=h*r;}
  setCropFromRect(x,y,w,h);
});
wrap.addEventListener("pointerup",()=>{drawStart=null;if(crop.classList.contains("hidden")===false)selection=rectFromCrop()});

$("#adjustBtn").onclick=()=>{selection=rectFromCrop();openAdjust()};
$("#back").onclick=()=>{$("#adjustStep").classList.add("hidden");$("#sheetStep").classList.remove("hidden")};

function cropFromSheet(sel){
  const sx=sel.x/stage.clientWidth*stage.width,sy=sel.y/stage.clientHeight*stage.height;
  const sw=sel.w/stage.clientWidth*stage.width,sh=sel.h/stage.clientHeight*stage.height;
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(sw));c.height=Math.max(1,Math.round(sh));
  c.getContext("2d").drawImage(stage,sx,sy,c.width,c.height,0,0,c.width,c.height);return c;
}
function openAdjust(){
  const src=cropFromSheet(selection);adjust={src,scale:1,ox:0,oy:0};
  preview.width=src.width;preview.height=src.height;renderAdjust();
  adjustBox.innerHTML='<i class="handle-nw" data-h="nw"></i><i class="handle-ne" data-h="ne"></i><i class="handle-sw" data-h="sw"></i><i class="handle-se" data-h="se"></i>';
  adjustBox.style.left="5%";adjustBox.style.top="5%";adjustBox.style.width="90%";adjustBox.style.height="90%";
  $("#adjustStep").classList.remove("hidden");$("#sheetStep").classList.add("hidden");bgTransparent=false;whiteBorder=false;$("#whiteBorder").checked=false;$("#borderWidth").value=6;$("#borderWidthValue").textContent="6";updateTrans();
}
function renderAdjust(){pctx.clearRect(0,0,preview.width,preview.height);pctx.drawImage(adjust.src,0,0,preview.width*adjust.scale,preview.height*adjust.scale,adjust.ox,adjust.oy,preview.width*adjust.scale,preview.height*adjust.scale);}
function updateTrans(){ $("#transState").textContent=bgTransparent?"透過 ON":"透過 OFF";$("#transparent").textContent=bgTransparent?"↩️ 透過を解除":"✨ 背景を透過"; if(bgTransparent)showTransparentPreview();else $("#checkerPreview").classList.add("hidden");}

$("#plus").onclick=()=>{adjust.scale=Math.min(3,adjust.scale+0.1);renderAdjust()};
$("#minus").onclick=()=>{adjust.scale=Math.max(.4,adjust.scale-0.1);renderAdjust()};
$("#center").onclick=()=>{adjust.ox=(preview.width-preview.width*adjust.scale)/2;adjust.oy=(preview.height-preview.height*adjust.scale)/2;renderAdjust()};
$("#resetAdjust").onclick=()=>{adjust.scale=1;adjust.ox=0;adjust.oy=0;renderAdjust()};

// 調整画面：枠自体は固定比率。ドラッグで位置変更、四隅でサイズ変更。
let adrag=null;
adjustBox.addEventListener("pointerdown",e=>{
  e.preventDefault();const a=$("#adjustStep .adjustArea").getBoundingClientRect(),b=adjustBox.getBoundingClientRect();
  const p={x:e.clientX-a.left,y:e.clientY-a.top};const h=e.target.dataset.h;
  adrag={kind:h||"move",start:p,orig:{x:b.left-a.left,y:b.top-a.top,w:b.width,h:b.height},area:a};
  adjustBox.setPointerCapture(e.pointerId);
});
adjustBox.addEventListener("pointermove",e=>{
  if(!adrag)return;e.preventDefault();const p={x:e.clientX-adrag.area.left,y:e.clientY-adrag.area.top},o=adrag.orig,r=SPEC[mode].ratio,W=adrag.area.width,H=adrag.area.height;
  let x=o.x,y=o.y,w=o.w,h=o.h,dx=p.x-adrag.start.x,dy=p.y-adrag.start.y;
  if(adrag.kind==="move"){x=Math.max(0,Math.min(W-w,o.x+dx));y=Math.max(0,Math.min(H-h,o.y+dy));}
  else{
    if(adrag.kind.includes("w")){x=o.x+dx;w=o.w-dx} if(adrag.kind.includes("e"))w=o.w+dx;
    if(adrag.kind.includes("n")){y=o.y+dy;h=o.h-dy} if(adrag.kind.includes("s"))h=o.h+dy;
    // 比率固定：幅を基準に高さを決定
    if(w<60)w=60;h=w/r;
    if(adrag.kind.includes("w"))x=o.x+o.w-w;
    if(adrag.kind.includes("n"))y=o.y+o.h-h;
    if(x<0){x=0;w=o.x+o.w;h=w/r;if(adrag.kind.includes("n"))y=o.y+o.h-h}
    if(y<0){y=0;h=o.y+o.h;w=h*r;if(adrag.kind.includes("w"))x=o.x+o.w-w}
    if(x+w>W){w=W-x;h=w/r}
    if(y+h>H){h=H-y;w=h*r}
  }
  adjustBox.style.left=x/W*100+"%";adjustBox.style.top=y/H*100+"%";adjustBox.style.width=w/W*100+"%";adjustBox.style.height=h/H*100+"%";
});
adjustBox.addEventListener("pointerup",()=>adrag=null);adjustBox.addEventListener("pointercancel",()=>adrag=null);

function adjustedCanvas(){
  const a=$("#adjustStep .adjustArea").getBoundingClientRect(),b=adjustBox.getBoundingClientRect();
  const sx=(b.left-a.left)/a.width*preview.width,sy=(b.top-a.top)/a.height*preview.height;
  const sw=b.width/a.width*preview.width,sh=b.height/a.height*preview.height;
  const out=document.createElement("canvas");out.width=SPEC[mode].w;out.height=SPEC[mode].h;
  out.getContext("2d").drawImage(preview,sx,sy,sw,sh,0,0,out.width,out.height);return out;
}

// 外周とつながった背景を透明化。色差許容値を上げ、白〜薄い背景に対応。
// キャラクター内部の白は外周と連結していない限り残す。
function removeBackground(src){
  const c=document.createElement("canvas");c.width=src.width;c.height=src.height;const x=c.getContext("2d");
  x.drawImage(src,0,0);const d=x.getImageData(0,0,c.width,c.height),a=d.data,w=c.width,h=c.height;
  const seen=new Uint8Array(w*h),q=[],T=48;
  const isBg=p=>{const i=p*4;if(a[i+3]<10)return true;const mx=Math.max(a[i],a[i+1],a[i+2]),mn=Math.min(a[i],a[i+1],a[i+2]);return mx-mn<T && mx>205};
  for(let x0=0;x0<w;x0++){q.push(x0,(h-1)*w+x0)}for(let y0=0;y0<h;y0++){q.push(y0*w,y0*w+w-1)}
  let head=0;while(head<q.length){const p=q[head++];if(p<0||p>=w*h||seen[p]||!isBg(p))continue;seen[p]=1;
    const xx=p%w,yy=(p/w)|0;if(xx>0)q.push(p-1);if(xx<w-1)q.push(p+1);if(yy>0)q.push(p-w);if(yy<h-1)q.push(p+w);
  }
  for(let p=0;p<w*h;p++)if(seen[p])a[p*4+3]=0;
  x.putImageData(d,0,0);return c;
}
function addWhiteBorder(src, px){
  const c=document.createElement("canvas");c.width=src.width;c.height=src.height;
  const x=c.getContext("2d"), s=src.width*src.height;
  const d=src.getContext("2d").getImageData(0,0,src.width,src.height);
  // 白縁は透明化後のアルファ形状を膨張させ、その下に白を描く。
  // 元画像の白い部分を白縁として扱わないため、アルファ値だけを基準にする。
  const radius=Math.max(1,Math.round(px*src.width/SPEC[mode].w));
  const mask=new Uint8Array(s);
  for(let p=0;p<s;p++) mask[p]=d.data[p*4+3]>10?1:0;
  const border=new Uint8Array(s);
  const r2=radius*radius,w=src.width,h=src.height;
  for(let y=0;y<h;y++){
    for(let xx=0;xx<w;xx++){
      const p=y*w+xx;
      if(!mask[p])continue;
      const minY=Math.max(0,y-radius),maxY=Math.min(h-1,y+radius);
      const minX=Math.max(0,xx-radius),maxX=Math.min(w-1,xx+radius);
      for(let yy=minY;yy<=maxY;yy++){
        const dy=yy-y;
        for(let xxx=minX;xxx<=maxX;xxx++){
          const dx=xxx-xx;
          if(dx*dx+dy*dy<=r2)border[yy*w+xxx]=1;
        }
      }
    }
  }
  const out=x.createImageData(w,h), a=out.data;
  for(let p=0;p<s;p++){
    if(border[p] && !mask[p]){a[p*4]=255;a[p*4+1]=255;a[p*4+2]=255;a[p*4+3]=255;}
  }
  x.putImageData(out,0,0);
  x.globalCompositeOperation="source-over";x.drawImage(src,0,0);
  return c;
}
async function getFinalCanvas(){
  let c=adjustedCanvas();
  if(bgTransparent)c=removeBackground(c);
  if(whiteBorder && bgTransparent)c=addWhiteBorder(c,Number($("#borderWidth").value));
  return c;
}
$("#transparent").onclick=async()=>{bgTransparent=!bgTransparent;updateTrans();if(bgTransparent)showTransparentPreview()};
$("#whiteBorder").onchange=async e=>{whiteBorder=e.target.checked;if(whiteBorder&&!bgTransparent){bgTransparent=true;updateTrans()}if(bgTransparent)showTransparentPreview()};
$("#borderWidth").oninput=async e=>{$("#borderWidthValue").textContent=e.target.value;if(bgTransparent)showTransparentPreview()};
async function showTransparentPreview(){const c=await getFinalCanvas();const url=c.toDataURL("image/png");$("#checkerPreview").innerHTML=`<img src="${url}">`;$("#checkerPreview").classList.remove("hidden")}

function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200)}
$("#save").onclick=async()=>{
  if(results.length>=Number($("#count").value)){toast("設定した個数に達しています");return}
  const c=await getFinalCanvas();
  c.toBlob(blob=>{
    const n=results.length+1;const item={blob,url:URL.createObjectURL(blob),name:`${mode}_${String(n).padStart(2,"0")}.png`};
    results.push(item);download(blob,item.name);refresh();
    $("#adjustStep").classList.add("hidden");$("#sheetStep").classList.remove("hidden");resetSelection();
    toast(`${n}個目を保存しました`);
  },"image/png");
};

function refresh(){
  $("#done").textContent=results.length;$("#total").textContent=$("#count").value;$("#zip").disabled=!results.length;
  $("#thumbs").innerHTML="";
  results.forEach((r,i)=>{const d=document.createElement("div");d.className="thumb";d.innerHTML=`<span>${i+1}</span><img src="${r.url}">`;$("#thumbs").appendChild(d)});
  const bad=results.filter(r=>r.blob.size>1024*1024).length;
  $("#checks").innerHTML=`<div class="${bad?'warn':'ok'}">${bad?'⚠️ 1MBを超える画像があります':'✅ PNG形式・指定キャンバスサイズで保存済み'}</div>`;
}
$("#zip").onclick=async()=>{if(!window.JSZip){toast("ZIP機能の読み込みに失敗しました");return}const z=new JSZip();results.forEach(r=>z.file(r.name,r.blob));const b=await z.generateAsync({type:"blob"});download(b,`${mode}_LINE用画像.zip`)};
function toast(t){const x=$("#toast");x.textContent=t;x.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove("show"),1700)}
updateMode();
