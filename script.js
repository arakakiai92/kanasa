const $ = s => document.querySelector(s);
const stage = $("#stage"), sctx = stage.getContext("2d");
const preview = $("#preview"), pctx = preview.getContext("2d");
const wrap = $("#stageWrap"), crop = $("#cropBox"), adjustBox = $("#adjustBox");

let mode = "sticker";
let img = null;
let selection = null; // 元画像座標系 {x, y, w, h}
let adjust = { src: null, scale: 1, ox: 0, oy: 0 };
let results = [];

// レイヤー設定
let bgTransparent = false;
let whiteBorder = false;
let bgColor = "transparent"; // 背景色
let textConfig = {
  text: "",
  font: "'Mochiy Pop One', sans-serif",
  color: "#111111",
  stroke: "#ffffff",
  pos: "bottom", // 'top' | 'center' | 'bottom'
  size: 32
};

const SPEC = {
  sticker: { ratio: 370 / 320, w: 370, h: 320, label: "370 × 320 px（スタンプ用）" },
  emoji: { ratio: 1, w: 180, h: 180, label: "180 × 180 px（絵文字用）" }
};

function updateMode() {
  const s = SPEC[mode];
  $("#spec").textContent = `切り抜き比率：${mode === "sticker" ? "370 : 320" : "1 : 1"}　／　書き出し：${s.label}`;
  $("#total").textContent = $("#count").value;
  if (img) resetSelection();
}

document.querySelectorAll(".switch button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".switch button").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  mode = b.dataset.mode;
  updateMode();
});

$("#count").onchange = () => { $("#total").textContent = $("#count").value; };

$("#file").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    results = [];
    bgTransparent = false;
    setupCanvas();
    renderSheet();
    $("#sheetStep").classList.remove("hidden");
    $("#adjustStep").classList.add("hidden");
    resetSelection();
    refresh();
    toast("シートを読み込みました！絵を指で囲んでね");
  };
  im.src = URL.createObjectURL(f);
};

function setupCanvas() {
  const maxW = Math.min(wrap.clientWidth || window.innerWidth - 20, 900);
  const scale = Math.min(1, maxW / img.naturalWidth);
  stage.width = Math.round(img.naturalWidth * scale);
  stage.height = Math.round(img.naturalHeight * scale);
}

function renderSheet() {
  sctx.clearRect(0, 0, stage.width, stage.height);
  sctx.drawImage(img, 0, 0, stage.width, stage.height);
}

// 枠のリセット
function resetSelection() {
  selection = null;
  crop.classList.add("hidden");
  $("#adjustBtn").classList.add("hidden");
  $("#resetCrop").classList.add("hidden");
  $("#startSelect").classList.remove("hidden");
  $("#sheetProgress").textContent = `${results.length + 1} / ${$("#count").value}`;
}

$("#resetCrop").onclick = () => {
  resetSelection();
  toast("枠をリセットしました");
};

// 「この絵を囲む」ボタン
$("#startSelect").onclick = () => {
  if (!img) return;
  const r = SPEC[mode].ratio;
  const stageRect = stage.getBoundingClientRect();
  let w = stageRect.width * 0.55;
  let h = w / r;
  if (h > stageRect.height * 0.8) {
    h = stageRect.height * 0.8;
    w = h * r;
  }
  const x = (stageRect.width - w) / 2;
  const y = (stageRect.height - h) / 2;

  applyCropRect(x, y, w, h, stageRect);
  $("#startSelect").classList.add("hidden");
  $("#resetCrop").classList.remove("hidden");
  $("#adjustBtn").classList.remove("hidden");
  toast("枠を表示しました！指で囲み直すこともできます");
};

function getStagePoint(e) {
  const r = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
    y: Math.max(0, Math.min(r.height, e.clientY - r.top))
  };
}

function applyCropRect(x, y, w, h, stageRect) {
  crop.style.left = `${(x / stageRect.width) * 100}%`;
  crop.style.top = `${(y / stageRect.height) * 100}%`;
  crop.style.width = `${(w / stageRect.width) * 100}%`;
  crop.style.height = `${(h / stageRect.height) * 100}%`;
  crop.classList.remove("hidden");

  const scaleX = img.naturalWidth / stageRect.width;
  const scaleY = img.naturalHeight / stageRect.height;
  selection = {
    x: x * scaleX,
    y: y * scaleY,
    w: w * scaleX,
    h: h * scaleY
  };
}

// 指でドラッグして囲む
let drawStart = null;
wrap.addEventListener("pointerdown", e => {
  if (!img) return;
  e.preventDefault();
  wrap.setPointerCapture(e.pointerId);
  drawStart = getStagePoint(e);
});

wrap.addEventListener("pointermove", e => {
  if (!drawStart) return;
  e.preventDefault();
  const p = getStagePoint(e);
  const r = SPEC[mode].ratio;

  let dx = p.x - drawStart.x;
  let dy = p.y - drawStart.y;
  let w = Math.abs(dx);
  let h = Math.abs(dy);

  if (w / h > r) h = w / r;
  else w = h * r;

  if (w < 20 || h < 20) return;

  const stageRect = stage.getBoundingClientRect();
  let x = dx < 0 ? drawStart.x - w : drawStart.x;
  let y = dy < 0 ? drawStart.y - h : drawStart.y;

  x = Math.max(0, Math.min(stageRect.width - w, x));
  y = Math.max(0, Math.min(stageRect.height - h, y));

  applyCropRect(x, y, w, h, stageRect);

  $("#startSelect").classList.add("hidden");
  $("#resetCrop").classList.remove("hidden");
  $("#adjustBtn").classList.remove("hidden");
});

wrap.addEventListener("pointerup", () => { drawStart = null; });
wrap.addEventListener("pointercancel", () => { drawStart = null; });

$("#adjustBtn").onclick = () => {
  if (!selection) {
    toast("絵を指で囲んでから押してね");
    return;
  }
  openAdjust();
};

$("#back").onclick = () => {
  $("#adjustStep").classList.add("hidden");
  $("#sheetStep").classList.remove("hidden");
};

// 元画像から高精度のまま切り出し
function cropFromOriginal(sel) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sel.w));
  c.height = Math.max(1, Math.round(sel.h));
  c.getContext("2d").drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, c.width, c.height);
  return c;
}

function openAdjust() {
  const src = cropFromOriginal(selection);
  adjust = { src, scale: 1, ox: 0, oy: 0 };

  preview.width = SPEC[mode].w;
  preview.height = SPEC[mode].h;

  adjustBox.innerHTML = '<i class="handle-nw" data-h="nw"></i><i class="handle-ne" data-h="ne"></i><i class="handle-sw" data-h="sw"></i><i class="handle-se" data-h="se"></i>';
  adjustBox.style.left = "0%";
  adjustBox.style.top = "0%";
  adjustBox.style.width = "100%";
  adjustBox.style.height = "100%";

  $("#adjustStep").classList.remove("hidden");
  $("#sheetStep").classList.add("hidden");
  
  // 初期設定
  bgTransparent = false;
  whiteBorder = false;
  $("#whiteBorder").checked = false;
  $("#borderWidth").value = 6;
  $("#borderWidthValue").textContent = "6";
  updateTransUI();

  // タブ初期化
  switchTab("tab-illust");
  renderPreview();
}

// タブ切り替え
function switchTab(tabId) {
  document.querySelectorAll(".tabBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tabContent").forEach(c => c.classList.toggle("active", c.id === tabId));
  
  // 「えの調整」タブのみ枠を表示
  if (tabId === "tab-illust") {
    adjustBox.classList.remove("hidden");
  } else {
    adjustBox.classList.add("hidden");
  }
}
document.querySelectorAll(".layerTabs .tabBtn").forEach(b => {
  b.onclick = () => switchTab(b.dataset.tab);
});

// レイヤー合成プレビューの描画
function renderPreview() {
  pctx.clearRect(0, 0, preview.width, preview.height);

  // 1. 背景レイヤー
  if (bgColor !== "transparent") {
    pctx.fillStyle = bgColor;
    pctx.fillRect(0, 0, preview.width, preview.height);
  }

  // 2. イラストレイヤー（位置・スケール・透過・白フチ）
  let illust = document.createElement("canvas");
  illust.width = preview.width;
  illust.height = preview.height;
  const ictx = illust.getContext("2d");

  // 元画像の配置
  const iw = preview.width * adjust.scale;
  const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;
  ictx.drawImage(adjust.src, adjust.ox, adjust.oy, iw, ih);

  if (bgTransparent) illust = removeBackground(illust);
  if (whiteBorder && bgTransparent) illust = addWhiteBorder(illust, Number($("#borderWidth").value));

  pctx.drawImage(illust, 0, 0);

  // 3. セリフ（文字）レイヤー
  if (textConfig.text.trim()) {
    renderText(pctx, preview.width, preview.height);
  }
}

// セリフ描画（太いフチ＋自動複数行・位置合わせ）
function renderText(ctx, w, h) {
  const txt = textConfig.text;
  const size = textConfig.size;
  ctx.save();
  ctx.font = `900 ${size}px ${textConfig.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = txt.split("\n");
  const lineHeight = size * 1.15;
  const totalH = lines.length * lineHeight;

  let startY = h - totalH / 2 - 16; // bottom
  if (textConfig.pos === "top") startY = 16 + totalH / 2;
  if (textConfig.pos === "center") startY = h / 2;

  const centerX = w / 2;

  lines.forEach((line, i) => {
    const y = startY - ((lines.length - 1) * lineHeight) / 2 + i * lineHeight;

    // フチどり
    if (textConfig.stroke !== "none") {
      ctx.strokeStyle = textConfig.stroke;
      ctx.lineWidth = Math.max(4, size * 0.22);
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(line, centerX, y);
    }

    // メイン文字
    ctx.fillStyle = textConfig.color;
    ctx.fillText(line, centerX, y);
  });

  ctx.restore();
}

function updateTransUI() {
  $("#transState").textContent = bgTransparent ? "透過 ON" : "透過 OFF";
  $("#transparent").textContent = bgTransparent ? "↩️ 透過を解除" : "✨ 絵のまわりを透明にする";
}

// イラスト操作ボタン群
$("#plus").onclick = () => { adjust.scale = Math.min(3, adjust.scale + 0.1); renderPreview(); };
$("#minus").onclick = () => { adjust.scale = Math.max(0.4, adjust.scale - 0.1); renderPreview(); };
$("#center").onclick = () => {
  const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;
  adjust.ox = (preview.width - preview.width * adjust.scale) / 2;
  adjust.oy = (preview.height - ih) / 2;
  renderPreview();
};
$("#resetAdjust").onclick = () => {
  adjust.scale = 1;
  adjust.ox = 0;
  adjust.oy = 0;
  renderPreview();
};

$("#transparent").onclick = () => {
  bgTransparent = !bgTransparent;
  updateTransUI();
  renderPreview();
};

$("#whiteBorder").onchange = e => {
  whiteBorder = e.target.checked;
  if (whiteBorder && !bgTransparent) {
    bgTransparent = true;
    updateTransUI();
  }
  renderPreview();
};

$("#borderWidth").oninput = e => {
  $("#borderWidthValue").textContent = e.target.value;
  if (bgTransparent) renderPreview();
};

// 背景パレット操作
document.querySelectorAll("#bgColorPalette .colorBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#bgColorPalette .colorBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    bgColor = btn.dataset.bg;
    renderPreview();
  };
});

// セリフ設定
$("#stampText").oninput = e => {
  textConfig.text = e.target.value;
  renderPreview();
};

document.querySelectorAll(".quickWords .qBtn").forEach(b => {
  b.onclick = () => {
    if (b.textContent === "消す") {
      $("#stampText").value = "";
    } else {
      $("#stampText").value = b.textContent;
    }
    textConfig.text = $("#stampText").value;
    renderPreview();
  };
});

$("#textFont").onchange = e => {
  textConfig.font = e.target.value;
  renderPreview();
};

document.querySelectorAll("#textColorPalette .colorBtn").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll("#textColorPalette .colorBtn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    textConfig.color = b.dataset.color;
    renderPreview();
  };
});

document.querySelectorAll("#strokePalette .strokeBtn").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll("#strokePalette .strokeBtn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    textConfig.stroke = b.dataset.stroke;
    renderPreview();
  };
});

document.querySelectorAll(".posButtons .posBtn").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".posButtons .posBtn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    textConfig.pos = b.dataset.pos;
    renderPreview();
  };
});

$("#textSize").oninput = e => {
  textConfig.size = Number(e.target.value);
  $("#textSizeVal").textContent = e.target.value;
  renderPreview();
};

// 調整枠のドラッグ & リサイズ
let adrag = null;
adjustBox.addEventListener("pointerdown", e => {
  e.preventDefault();
  const a = preview.getBoundingClientRect();
  const b = adjustBox.getBoundingClientRect();
  const p = { x: e.clientX - a.left, y: e.clientY - a.top };
  const h = e.target.dataset.h;
  adrag = { kind: h || "move", start: p, orig: { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height }, area: a };
  adjustBox.setPointerCapture(e.pointerId);
});

adjustBox.addEventListener("pointermove", e => {
  if (!adrag) return;
  e.preventDefault();
  const p = { x: e.clientX - adrag.area.left, y: e.clientY - adrag.area.top };
  const o = adrag.orig;
  const r = SPEC[mode].ratio;
  const W = adrag.area.width;
  const H = adrag.area.height;
  let x = o.x, y = o.y, w = o.w, h = o.h;
  const dx = p.x - adrag.start.x;
  const dy = p.y - adrag.start.y;

  if (adrag.kind === "move") {
    x = Math.max(0, Math.min(W - w, o.x + dx));
    y = Math.max(0, Math.min(H - h, o.y + dy));
  } else {
    if (adrag.kind.includes("w")) { x = o.x + dx; w = o.w - dx; }
    if (adrag.kind.includes("e")) { w = o.w + dx; }
    if (adrag.kind.includes("n")) { y = o.y + dy; h = o.h - dy; }
    if (adrag.kind.includes("s")) { h = o.h + dy; }

    if (w < 40) w = 40;
    h = w / r;

    if (adrag.kind.includes("w")) x = o.x + o.w - w;
    if (adrag.kind.includes("n")) y = o.y + o.h - h;

    if (x < 0) { x = 0; w = o.x + o.w; h = w / r; }
    if (y < 0) { y = 0; h = o.y + o.h; w = h * r; }
    if (x + w > W) { w = W - x; h = w / r; }
    if (y + h > H) { h = H - y; w = h * r; }
  }

  adjustBox.style.left = `${(x / W) * 100}%`;
  adjustBox.style.top = `${(y / H) * 100}%`;
  adjustBox.style.width = `${(w / W) * 100}%`;
  adjustBox.style.height = `${(h / H) * 100}%`;
});

adjustBox.addEventListener("pointerup", () => {
  if (!adrag) return;
  adrag = null;
  // 枠の位置に合わせてイラストのオフセットとスケールを連動
  const a = preview.getBoundingClientRect();
  const b = adjustBox.getBoundingClientRect();
  const scale = b.width / a.width;
  adjust.scale = Math.max(0.4, Math.min(3, 1 / scale));
  adjust.ox = -((b.left - a.left) / a.width) * preview.width * adjust.scale;
  adjust.oy = -((b.top - a.top) / a.height) * preview.height * adjust.scale;
  
  adjustBox.style.left = "0%";
  adjustBox.style.top = "0%";
  adjustBox.style.width = "100%";
  adjustBox.style.height = "100%";
  renderPreview();
});
adjustBox.addEventListener("pointercancel", () => { adrag = null; });

// 背景透過処理
function removeBackground(src) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext("2d");
  x.drawImage(src, 0, 0);

  const d = x.getImageData(0, 0, c.width, c.height);
  const a = d.data, w = c.width, h = c.height;
  const seen = new Uint8Array(w * h);

  const corners = [0, w - 1, (h - 1) * w, w * h - 1];
  let bgR = 255, bgG = 255, bgB = 255;
  for (let cp of corners) {
    if (a[cp * 4 + 3] > 128) {
      bgR = a[cp * 4]; bgG = a[cp * 4 + 1]; bgB = a[cp * 4 + 2];
      break;
    }
  }

  const T = 50;
  const isBg = p => {
    const i = p * 4;
    if (a[i + 3] < 10) return true;
    const r = a[i], g = a[i + 1], b = a[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < T && mx > 190) return true;
    const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
    return diff < 70;
  };

  const q = new Int32Array(w * h);
  let head = 0, tail = 0;

  for (let x0 = 0; x0 < w; x0++) {
    const p1 = x0, p2 = (h - 1) * w + x0;
    if (!seen[p1] && isBg(p1)) { seen[p1] = 1; q[tail++] = p1; }
    if (!seen[p2] && isBg(p2)) { seen[p2] = 1; q[tail++] = p2; }
  }
  for (let y0 = 0; y0 < h; y0++) {
    const p1 = y0 * w, p2 = y0 * w + w - 1;
    if (!seen[p1] && isBg(p1)) { seen[p1] = 1; q[tail++] = p1; }
    if (!seen[p2] && isBg(p2)) { seen[p2] = 1; q[tail++] = p2; }
  }

  while (head < tail) {
    const p = q[head++];
    const xx = p % w, yy = (p / w) | 0;
    if (xx > 0) { const np = p - 1; if (!seen[np] && isBg(np)) { seen[np] = 1; q[tail++] = np; } }
    if (xx < w - 1) { const np = p + 1; if (!seen[np] && isBg(np)) { seen[np] = 1; q[tail++] = np; } }
    if (yy > 0) { const np = p - w; if (!seen[np] && isBg(np)) { seen[np] = 1; q[tail++] = np; } }
    if (yy < h - 1) { const np = p + w; if (!seen[np] && isBg(np)) { seen[np] = 1; q[tail++] = np; } }
  }

  for (let p = 0; p < w * h; p++) {
    if (seen[p]) a[p * 4 + 3] = 0;
  }
  x.putImageData(d, 0, 0);
  return c;
}

// 白フチ合成
function addWhiteBorder(src, px) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");

  const mask = document.createElement("canvas");
  mask.width = src.width;
  mask.height = src.height;
  const mctx = mask.getContext("2d");
  mctx.drawImage(src, 0, 0);
  mctx.globalCompositeOperation = "source-in";
  mctx.fillStyle = "#ffffff";
  mctx.fillRect(0, 0, mask.width, mask.height);

  const r = Math.max(1, Math.round(px * src.width / SPEC[mode].w));
  const steps = Math.max(16, Math.min(32, r * 4));
  for (let i = 0; i < steps; i++) {
    const angle = (i * 2 * Math.PI) / steps;
    ctx.drawImage(mask, Math.cos(angle) * r, Math.sin(angle) * r);
  }
  if (r > 3) {
    const innerR = r / 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i * 2 * Math.PI) / 8;
      ctx.drawImage(mask, Math.cos(angle) * innerR, Math.sin(angle) * innerR);
    }
  }
  ctx.drawImage(mask, 0, 0);
  ctx.drawImage(src, 0, 0);
  return c;
}

// 最終書き出し用Canvasの生成
async function getFinalCanvas() {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = SPEC[mode].w;
  c.height = SPEC[mode].h;
  const ctx = c.getContext("2d");

  // 1. 背景
  if (bgColor !== "transparent") {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, c.width, c.height);
  }

  // 2. イラスト
  let illust = document.createElement("canvas");
  illust.width = c.width;
  illust.height = c.height;
  const ictx = illust.getContext("2d");

  const iw = c.width * adjust.scale;
  const ih = (c.width * adjust.scale / adjust.src.width) * adjust.src.height;
  ictx.drawImage(adjust.src, adjust.ox, adjust.oy, iw, ih);

  if (bgTransparent) illust = removeBackground(illust);
  if (whiteBorder && bgTransparent) illust = addWhiteBorder(illust, Number($("#borderWidth").value));

  ctx.drawImage(illust, 0, 0);

  // 3. セリフ
  if (textConfig.text.trim()) {
    renderText(ctx, c.width, c.height);
  }

  return c;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// 保存ボタン
$("#save").onclick = async () => {
  if (results.length >= Number($("#count").value)) {
    toast("設定した個数に達しています");
    return;
  }
  const c = await getFinalCanvas();
  c.toBlob(blob => {
    const n = results.length + 1;
    const item = {
      blob,
      url: URL.createObjectURL(blob),
      name: `${mode}_${String(n).padStart(2, "0")}.png`
    };
    results.push(item);
    refresh();
    $("#adjustStep").classList.add("hidden");
    $("#sheetStep").classList.remove("hidden");
    resetSelection();
    toast(`${n}個目を保存しました！`);
  }, "image/png");
};

function refresh() {
  $("#done").textContent = results.length;
  $("#total").textContent = $("#count").value;
  $("#zip").disabled = !results.length;
  $("#thumbs").innerHTML = "";

  results.forEach((r, i) => {
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `<span>${i + 1}</span><img src="${r.url}">`;
    d.onclick = () => showImageModal(r);
    $("#thumbs").appendChild(d);
  });

  const bad = results.filter(r => r.blob.size > 1024 * 1024).length;
  $("#checks").innerHTML = `<div class="${bad ? 'warn' : 'ok'}">${bad ? '⚠️ 1MBを超える画像があります' : '✅ PNG形式・規定サイズで保存中（画像をタップで長押し保存可能）'}</div>`;
}

function showImageModal(item) {
  const modal = $("#imageModal");
  $("#modalImg").src = item.url;
  modal.classList.add("show");
}
$("#modalClose").onclick = () => {
  $("#imageModal").classList.remove("show");
};

$("#zip").onclick = async () => {
  if (!window.JSZip) {
    toast("ZIP機能の読み込みに失敗しました");
    return;
  }
  toast("ZIPを作成中...");
  const z = new JSZip();
  results.forEach(r => z.file(r.name, r.blob));
  const b = await z.generateAsync({ type: "blob" });
  download(b, `${mode}_LINE画像まとめ.zip`);
};

function toast(t) {
  const x = $("#toast");
  x.textContent = t;
  x.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => x.classList.remove("show"), 1800);
}

// フォント読み込み完了時に再描画
document.fonts.ready.then(() => {
  if ($("#adjustStep").classList.contains("hidden") === false) {
    renderPreview();
  }
});

updateMode();
