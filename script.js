const $=s=>document.querySelector(s);
const stage=$("#stage"), ctx=stage.getContext("2d");
const box=$("#cropBox"), editor=$("#editor"), file=$("#file"), countEl=$("#count");
let img=null, mode="sticker", current=0, results=[], drag=null, bgTransparent=false;

document.querySelectorAll(".type-switch button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".type-switch button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active"); mode=b.dataset.type; resetBox(); updateStatus();
});
countEl.onchange=()=>{current=results.length; updateStatus();};
file.onchange=e=>{const f=e.target.files[0]; if(!f)return; const im=new Image();
  im.onload=()=>{img=im; results=[]; current=0; editor.classList.remove("hidden"); setupCanvas(); render(); resetBox(); refreshResults(); toast("読み込みました");};
  im.src=URL.createObjectURL(f);
};
function setupCanvas(){const maxW=Math.min($("#stageWrap").clientWidth,900);const scale=Math.min(1,maxW/img.naturalWidth);
  stage.width=Math.round(img.naturalWidth*scale); stage.height=Math.round(img.naturalHeight*scale);}
function render(){if(!img)return;ctx.clearRect(0,0,stage.width,stage.height);ctx.drawImage(img,0,0,stage.width,stage.height);}
function resetBox(){if(!img)return; box.style.left="10%";box.style.top="10%";box.style.width="35%";box.style.height="35%";}
function updateStatus(){ $("#progress").textContent=`カット ${Math.min(current+1,Number(countEl.value))} / ${countEl.value}`;}
$("#reset").onclick=resetBox;

function point(e){const r=$("#stageWrap").getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function begin(e){e.preventDefault();const p=point(e), r=box.getBoundingClientRect(), w=$("#stageWrap").getBoundingClientRect();
  const local={x:r.left-w.left,y:r.top-w.top,w:r.width,h:r.height};
  const hx=e.target.dataset.handle;if(hx) drag={kind:hx,start:p,orig:local}; else if(p.x>=local.x&&p.x<=local.x+local.w&&p.y>=local.y&&p.y<=local.y+local.h) drag={kind:"move",start:p,orig:local};
  if(drag)e.currentTarget.setPointerCapture(e.pointerId);
}
function move(e){if(!drag)return;e.preventDefault();const p=point(e),o=drag.orig,dx=p.x-drag.start.x,dy=p.y-drag.start.y;
  const W=$("#stageWrap").clientWidth,H=$("#stageWrap").clientHeight;let x=o.x,y=o.y,w=o.w,h=o.h;
  if(drag.kind==="move"){x=Math.max(0,Math.min(W-w,o.x+dx));y=Math.max(0,Math.min(H-h,o.y+dy));}
  else {if(drag.kind.includes("w")){x=o.x+dx;w=o.w-dx} if(drag.kind.includes("e"))w=o.w+dx;if(drag.kind.includes("n")){y=o.y+dy;h=o.h-dy}if(drag.kind.includes("s"))h=o.h+dy;
    if(w<35){w=35;x=o.x+(drag.kind.includes("w")?o.w-w:0)} if(h<35){h=35;y=o.y+(drag.kind.includes("n")?o.h-h:0)}
    x=Math.max(0,Math.min(W-w,x));y=Math.max(0,Math.min(H-h,y));w=Math.min(w,W-x);h=Math.min(h,H-y);}
  box.style.left=x/W*100+"%";box.style.top=y/H*100+"%";box.style.width=w/W*100+"%";box.style.height=h/H*100+"%";
}
function end(){drag=null}
box.addEventListener("pointerdown",begin);box.addEventListener("pointermove",move);box.addEventListener("pointerup",end);box.addEventListener("pointercancel",end);

function cropCanvas(){const sw=$("#stageWrap").getBoundingClientRect(), br=box.getBoundingClientRect();
  const sx=(br.left-sw.left)/stage.clientWidth*stage.width, sy=(br.top-sw.top)/stage.clientHeight*stage.height;
  const cw=br.width/stage.clientWidth*stage.width,ch=br.height/stage.clientHeight*stage.height;
  const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(cw));c.height=Math.max(1,Math.round(ch));
  c.getContext("2d").drawImage(stage,sx,sy,c.width,c.height,0,0,c.width,c.height); return c;
}
// 白〜薄い背景を透明にする簡易方式。線画や白い部分まで消しすぎないよう、外周から連結した色だけを対象にする。
function makeTransparent(src){
  const c=document.createElement("canvas");c.width=src.width;c.height=src.height;const x=c.getContext("2d");
  x.drawImage(src,0,0);const d=x.getImageData(0,0,c.width,c.height), a=d.data,w=c.width,h=c.height;
  const seen=new Uint8Array(w*h), q=[]; const threshold=35;
  function near(i){return a[i]<=(255)&&a[i+1]<=255&&a[i+2]<=255&&(Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])<threshold);}
  for(let xx=0;xx<w;xx++){q.push(xx, (h-1)*w+xx)} for(let yy=0;yy<h;yy++){q.push(yy*w, yy*w+w-1)}
  let head=0;while(head<q.length){const p=q[head++];if(seen[p]||!near(p*4))continue;seen[p]=1;
    const n=[p-1,p+1,p-w,p+w];for(const z of n)if(z>=0&&z<w*h&&!seen[z])q.push(z);}
  for(let p=0;p<w*h;p++)if(seen[p])a[p*4+3]=0;x.putImageData(d,0,0);return c;
}
function getCanvas(){let c=cropCanvas();return bgTransparent?makeTransparent(c):c}
$("#transparent").onclick=()=>{bgTransparent=!bgTransparent;$("#transparent").textContent=bgTransparent?"↩️ 透過を解除":"✨ 背景を透過";toast(bgTransparent?"背景透過をONにしました":"背景透過をOFFにしました");};
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function saveCurrent(){
  if(!img)return;const c=getCanvas();c.toBlob(b=>{const idx=results.length+1;results.push({blob:b,url:URL.createObjectURL(b),name:`${mode}_${String(idx).padStart(2,"0")}.png`});refreshResults();downloadBlob(b,results.at(-1).name);current=results.length;updateStatus();}, "image/png");
}
$("#saveOne").onclick=saveCurrent;
$("#next").onclick=()=>{if(results.length<Number(countEl.value)){saveCurrent();}else toast("設定したカット数に達しました");};
function refreshResults(){ $("#done").textContent=results.length;$("#zip").disabled=!results.length;$("#thumbs").innerHTML="";
  results.forEach((r,i)=>{const d=document.createElement("div");d.className="thumb";d.innerHTML=`<span>${i+1}</span><img src="${r.url}">`;$("#thumbs").appendChild(d);});
  updateStatus();
}
$("#zip").onclick=async()=>{const zip=new JSZip();results.forEach(r=>zip.file(r.name,r.blob));const b=await zip.generateAsync({type:"blob"});downloadBlob(b,`${mode}_images.zip`);};
function toast(t){const x=$("#toast");x.textContent=t;x.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove("show"),1600)}
window.addEventListener("resize",()=>{if(img){setupCanvas();render();}});
