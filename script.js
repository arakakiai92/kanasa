const $ = s => document.querySelector(s);
const stage = $("#stage"), sctx = stage.getContext("2d");
const preview = $("#preview"), pctx = preview.getContext("2d");
const wrap = $("#stageWrap"), crop = $("#cropBox");
const adjustArea = $("#adjustArea");

let mode = "sticker";
let img = null;

// ①切り出し枠の状態
let selectionRect = null; // 表示ピクセル座標系 { x, y, w, h }
let selection = null;     // 元画像座標系 { x, y, w, h }

// ②３レイヤー構成設定
// 重なり順：index 0 が一番手前（最前面）、index 2 が一番奥（最背面）
let layerOrder = ["text", "illust", "bg"];

// Layer: 背景レイヤー（無選択なら透明）
let bgColor = "transparent";

// Layer: イラストレイヤー
let adjust = { src: null, scale: 1, ox: 0, oy: 0 };
let bgTransparent = false;
let whiteBorder = false;

// Layer: 文字（セリフ）レイヤー（無選択なら空・描画なし）
let textConfig = {
  text: "",
  font: "'Mochiy Pop One', sans-serif",
  color: "#111111",
  stroke: "#ffffff",
  pos: "bottom", // 'top' | 'center' | 'bottom'
  size: 34,
  customX: null,
  customY: null
};

let currentLayer = "text"; // 現在選択中のレイヤー設定パネル
let results = [];

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

// シート画像読み込み
$("#file").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    results = [];
    setupCanvas();
    renderSheet();
    $("#sheetStep").classList.remove("hidden");
    $("#adjustStep").classList.add("hidden");
    resetSelection();
    refresh();
    toast("シートを読み込みました！指で囲むか枠を動かしてね");
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

// 枠の表示・更新
function renderCropBox() {
  if (!selectionRect) {
    crop.classList.add("hidden");
    $("#resetCrop").classList.add("hidden");
    $("#adjustBtn").classList.add("hidden");
    $("#startSelect").classList.remove("hidden");
    $("#sheetProgress").textContent = `${results.length + 1} / ${$("#count").value}`;
    selection = null;
    return;
  }

  const sr = stage.getBoundingClientRect();
  crop.style.left = `${(selectionRect.x / sr.width) * 100}%`;
  crop.style.top = `${(selectionRect.y / sr.height) * 100}%`;
  crop.style.width = `${(selectionRect.w / sr.width) * 100}%`;
  crop.style.height = `${(selectionRect.h / sr.height) * 100}%`;
  crop.classList.remove("hidden");

  $("#resetCrop").classList.remove("hidden");
  $("#adjustBtn").classList.remove("hidden");
  $("#startSelect").classList.add("hidden");

  const scaleX = img.naturalWidth / sr.width;
  const scaleY = img.naturalHeight / sr.height;
  selection = {
    x: selectionRect.x * scaleX,
    y: selectionRect.y * scaleY,
    w: selectionRect.w * scaleX,
    h: selectionRect.h * scaleY
  };
}

function resetSelection() {
  selectionRect = null;
  renderCropBox();
}

$("#resetCrop").onclick = () => {
  resetSelection();
  toast("枠をリセットしました");
};

// 「この絵を囲む」ボタン
$("#startSelect").onclick = () => {
  if (!img) return;
  const r = SPEC[mode].ratio;
  const sr = stage.getBoundingClientRect();
  let w = sr.width * 0.55;
  let h = w / r;
  if (h > sr.height * 0.8) {
    h = sr.height * 0.8;
    w = h * r;
  }
  const x = (sr.width - w) / 2;
  const y = (sr.height - h) / 2;

  selectionRect = { x, y, w, h };
  renderCropBox();
  toast("枠を置きました！中央で移動、四隅でサイズ変更できます");
};

function getStagePoint(e) {
  const r = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
    y: Math.max(0, Math.min(r.height, e.clientY - r.top))
  };
}

// ①切り出し画面：ポインターイベント（囲む・動かす・サイズ変更）
let cropDrag = null;

wrap.addEventListener("pointerdown", e => {
  if (!img) return;
  e.preventDefault();
  wrap.setPointerCapture(e.pointerId);

  const p = getStagePoint(e);
  const handle = e.target.dataset ? e.target.dataset.h : null;
  const isInsideCrop = (e.target === crop || crop.contains(e.target));

  if (handle) {
    cropDrag = { kind: handle, start: p, orig: { ...selectionRect } };
  } else if (isInsideCrop && selectionRect) {
    cropDrag = { kind: "move", start: p, orig: { ...selectionRect } };
  } else {
    cropDrag = { kind: "draw", start: p, orig: null };
  }
});

wrap.addEventListener("pointermove", e => {
  if (!cropDrag) return;
  e.preventDefault();
  const p = getStagePoint(e);
  const r = SPEC[mode].ratio;
  const sr = stage.getBoundingClientRect();

  if (cropDrag.kind === "move") {
    const dx = p.x - cropDrag.start.x;
    const dy = p.y - cropDrag.start.y;
    const maxPosX = sr.width - cropDrag.orig.w;
    const maxPosY = sr.height - cropDrag.orig.h;

    selectionRect = {
      x: Math.max(0, Math.min(maxPosX, cropDrag.orig.x + dx)),
      y: Math.max(0, Math.min(maxPosY, cropDrag.orig.y + dy)),
      w: cropDrag.orig.w,
      h: cropDrag.orig.h
    };
    renderCropBox();
  } else if (cropDrag.kind === "draw") {
    let dx = p.x - cropDrag.start.x;
    let dy = p.y - cropDrag.start.y;
    let w = Math.abs(dx);
    let h = Math.abs(dy);

    if (w / h > r) h = w / r;
    else w = h * r;

    if (w < 20 || h < 20) return;

    let x = dx < 0 ? cropDrag.start.x - w : cropDrag.start.x;
    let y = dy < 0 ? cropDrag.start.y - h : cropDrag.start.y;

    x = Math.max(0, Math.min(sr.width - w, x));
    y = Math.max(0, Math.min(sr.height - h, y));

    selectionRect = { x, y, w, h };
    renderCropBox();
  } else {
    const kind = cropDrag.kind;
    const orig = cropDrag.orig;
    const dx = p.x - cropDrag.start.x;
    const dy = p.y - cropDrag.start.y;

    let w = orig.w, h = orig.h, x = orig.x, y = orig.y;
    if (kind.includes("w")) w = orig.w - dx;
    else if (kind.includes("e")) w = orig.w + dx;

    if (w < 30) w = 30;
    h = w / r;

    if (kind.includes("w")) x = orig.x + orig.w - w;
    if (kind.includes("n")) y = orig.y + orig.h - h;

    if (x < 0) {
      x = 0; w = orig.x + orig.w; h = w / r;
      if (kind.includes("n")) y = orig.y + orig.h - h;
    }
    if (y < 0) {
      y = 0; h = orig.y + orig.h; w = h * r;
      if (kind.includes("w")) x = orig.x + orig.w - w;
    }
    if (x + w > sr.width) { w = sr.width - x; h = w / r; }
    if (y + h > sr.height) { h = sr.height - y; w = h * r; }

    selectionRect = { x, y, w, h };
    renderCropBox();
  }
});

wrap.addEventListener("pointerup", () => { cropDrag = null; });
wrap.addEventListener("pointercancel", () => { cropDrag = null; });

// ②ステップ②への遷移
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

  // 初期順序：文字(最前面) -> イラスト(中間) -> 背景(最背面)
  layerOrder = ["text", "illust", "bg"];

  // 背景レイヤー初期化
  bgColor = "transparent";
  bgTransparent = false;
  whiteBorder = false;
  $("#whiteBorder").checked = false;
  $("#borderWidth").value = 6;
  $("#borderWidthValue").textContent = "6";

  // 文字レイヤー初期化
  textConfig.customX = null;
  textConfig.customY = null;

  $("#adjustStep").classList.remove("hidden");
  $("#sheetStep").classList.add("hidden");

  switchLayerTab("text");
  updateLayerListUI();
  renderPreview();
}

// レイヤーアイテム選択（設定パネルの表示切り替え）
function switchLayerTab(layerId) {
  currentLayer = layerId;
  document.querySelectorAll(".layerItem").forEach(item => {
    item.classList.toggle("active", item.dataset.layer === layerId);
  });
  document.querySelectorAll(".layerPanel").forEach(p => {
    p.classList.toggle("active", p.id === `panel-${layerId}`);
  });
}

document.querySelectorAll(".layerItemMain").forEach(main => {
  main.onclick = () => {
    const parent = main.closest(".layerItem");
    if (parent) switchLayerTab(parent.dataset.layer);
  };
});

// ==========================================
// レイヤーの重なり順（入れ替え）機能
// ==========================================
function moveLayer(layerId, dir) {
  const idx = layerOrder.indexOf(layerId);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layerOrder.length) return;

  // スワップ
  const temp = layerOrder[idx];
  layerOrder[idx] = layerOrder[newIdx];
  layerOrder[newIdx] = temp;

  // 操作したレイヤーを選択状態にする
  switchLayerTab(layerId);
  updateLayerListUI();
  renderPreview();

  const posName = newIdx === 0 ? "一番手前" : (newIdx === 1 ? "中間" : "一番奥");
  const layerName = layerId === "text" ? "文字" : (layerId === "illust" ? "イラスト" : "はいけい");
  toast(`${layerName}を【${posName}】に移動しました`);
}

// ▲▼ボタンのイベント登録
document.querySelectorAll(".btnOrderUp").forEach(btn => {
  btn.onclick = e => {
    e.stopPropagation();
    moveLayer(btn.dataset.layer, -1); // 手前（index減少）
  };
});
document.querySelectorAll(".btnOrderDown").forEach(btn => {
  btn.onclick = e => {
    e.stopPropagation();
    moveLayer(btn.dataset.layer, 1);  // 奥（index増加）
  };
});

// レイヤーリストのDOM並び順・バッジ・ボタン活性状態を更新
function updateLayerListUI() {
  const list = $("#layerStackList");

  layerOrder.forEach((id, idx) => {
    const item = $(`#item-${id}`);
    if (item) list.appendChild(item); // DOM順序を同期

    // バッジとボタンの状態
    const badge = $(`#badge-${id}`);
    const upBtn = item.querySelector(".btnOrderUp");
    const downBtn = item.querySelector(".btnOrderDown");

    if (badge) {
      badge.classList.remove("badge-top", "badge-mid", "badge-bot");
      if (idx === 0) {
        badge.textContent = "第3層 (一番手前)";
        badge.classList.add("badge-top");
      } else if (idx === 1) {
        badge.textContent = "第2層 (中間)";
        badge.classList.add("badge-mid");
      } else {
        badge.textContent = "第1層 (一番奥)";
        badge.classList.add("badge-bot");
      }
    }

    if (upBtn) upBtn.disabled = (idx === 0);
    if (downBtn) downBtn.disabled = (idx === layerOrder.length - 1);
  });

  updateLayerStatus();
}

// レイヤー状態テキストの更新
function updateLayerStatus() {
  const txt = textConfig.text.trim();
  if (txt) {
    $("#stateText").textContent = `"${txt.slice(0, 7)}${txt.length > 7 ? '…' : ''}"`;
    $("#stateText").style.color = "#e03131";
  } else {
    $("#stateText").textContent = "無選択 (なし)";
    $("#stateText").style.color = "#666";
  }

  let stIllust = "標準";
  if (bgTransparent && whiteBorder) stIllust = "透過+白フチ";
  else if (bgTransparent) stIllust = "透過ON";
  $("#stateIllust").textContent = stIllust;

  $("#stateBg").textContent = bgColor === "transparent" ? "とうめい (標準)" : "色つき";
  $("#transState").textContent = bgTransparent ? "透過 ON" : "透過 OFF";
  $("#transparent").textContent = bgTransparent ? "↩️ 透過を解除" : "✨ 絵のまわりを透明にする";
}

// ==========================================
// ３レイヤー合成レンダリング（layerOrder順に最背面から描画）
// ==========================================
function renderPreview() {
  pctx.clearRect(0, 0, preview.width, preview.height);

  // 一番奥（indexの大きい方）から順に描画
  const drawList = layerOrder.slice().reverse();

  drawList.forEach(layerId => {
    if (layerId === "bg") {
      drawBgLayer(pctx, preview.width, preview.height);
    } else if (layerId === "illust") {
      drawIllustLayer(pctx, preview.width, preview.height);
    } else if (layerId === "text") {
      drawTextLayer(pctx, preview.width, preview.height);
    }
  });

  updateLayerStatus();
}

function drawBgLayer(ctx, w, h) {
  if (bgColor !== "transparent") {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawIllustLayer(ctx, w, h) {
  let illust = document.createElement("canvas");
  illust.width = w;
  illust.height = h;
  const ictx = illust.getContext("2d");

  const iw = w * adjust.scale;
  const ih = (w * adjust.scale / adjust.src.width) * adjust.src.height;
  ictx.drawImage(adjust.src, adjust.ox, adjust.oy, iw, ih);

  if (bgTransparent) illust = removeBackground(illust);
  if (whiteBorder && bgTransparent) illust = addWhiteBorder(illust, Number($("#borderWidth").value));

  ctx.drawImage(illust, 0, 0);
}

function drawTextLayer(ctx, w, h) {
  if (textConfig.text.trim() === "") return;

  const txt = textConfig.text;
  const size = textConfig.size;
  ctx.save();
  ctx.font = `900 ${size}px ${textConfig.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = txt.split("\n");
  const lineHeight = size * 1.18;
  const totalH = lines.length * lineHeight;

  let cx = w / 2;
  let cy = h - totalH / 2 - 16;

  if (textConfig.customX !== null && textConfig.customY !== null) {
    cx = textConfig.customX;
    cy = textConfig.customY;
  } else {
    if (textConfig.pos === "top") cy = 16 + totalH / 2;
    if (textConfig.pos === "center") cy = h / 2;
  }

  lines.forEach((line, i) => {
    const y = cy - ((lines.length - 1) * lineHeight) / 2 + i * lineHeight;

    if (textConfig.stroke !== "none") {
      ctx.strokeStyle = textConfig.stroke;
      ctx.lineWidth = Math.max(5, size * 0.22);
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(line, cx, y);
    }

    ctx.fillStyle = textConfig.color;
    ctx.fillText(line, cx, y);
  });

  ctx.restore();
}

// プレビュー画面での直接ドラッグ操作
let previewDrag = null;

adjustArea.addEventListener("pointerdown", e => {
  e.preventDefault();
  adjustArea.setPointerCapture(e.pointerId);

  const rect = preview.getBoundingClientRect();
  const scaleFactor = preview.width / rect.width;
  const px = (e.clientX - rect.left) * scaleFactor;
  const py = (e.clientY - rect.top) * scaleFactor;

  if (currentLayer === "text" && textConfig.text.trim()) {
    let currentX = textConfig.customX !== null ? textConfig.customX : preview.width / 2;
    let currentY = textConfig.customY !== null ? textConfig.customY : (
      textConfig.pos === "top" ? 30 : (textConfig.pos === "center" ? preview.height / 2 : preview.height - 30)
    );
    previewDrag = {
      target: "text",
      startX: px,
      startY: py,
      origX: currentX,
      origY: currentY
    };
  } else {
    previewDrag = {
      target: "illust",
      startX: px,
      startY: py,
      origOx: adjust.ox,
      origOy: adjust.oy
    };
  }
});

adjustArea.addEventListener("pointermove", e => {
  if (!previewDrag) return;
  e.preventDefault();
  const rect = preview.getBoundingClientRect();
  const scaleFactor = preview.width / rect.width;
  const px = (e.clientX - rect.left) * scaleFactor;
  const py = (e.clientY - rect.top) * scaleFactor;

  const dx = px - previewDrag.startX;
  const dy = py - previewDrag.startY;

  if (previewDrag.target === "text") {
    textConfig.customX = previewDrag.origX + dx;
    textConfig.customY = previewDrag.origY + dy;
    document.querySelectorAll(".posBtns .posBtn").forEach(b => b.classList.remove("active"));
  } else if (previewDrag.target === "illust") {
    adjust.ox = previewDrag.origOx + dx;
    adjust.oy = previewDrag.origOy + dy;
  }
  renderPreview();
});

adjustArea.addEventListener("pointerup", () => { previewDrag = null; });
adjustArea.addEventListener("pointercancel", () => { previewDrag = null; });

// 文字レイヤー設定
$("#stampText").oninput = e => {
  textConfig.text = e.target.value;
  renderPreview();
};

$("#clearTextBtn").onclick = () => {
  $("#stampText").value = "";
  textConfig.text = "";
  textConfig.customX = null;
  textConfig.customY = null;
  renderPreview();
  toast("文字を消しました");
};

document.querySelectorAll(".quickWords .qBtn").forEach(btn => {
  btn.onclick = () => {
    $("#stampText").value = btn.textContent;
    textConfig.text = btn.textContent;
    renderPreview();
  };
});

$("#textFont").onchange = e => {
  textConfig.font = e.target.value;
  renderPreview();
};

document.querySelectorAll("#textColorList .cBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    textConfig.color = btn.dataset.color;
    renderPreview();
  };
});

document.querySelectorAll("#textStrokeList .sBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#textStrokeList .sBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    textConfig.stroke = btn.dataset.stroke;
    renderPreview();
  };
});

document.querySelectorAll(".posBtns .posBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".posBtns .posBtn").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    textConfig.pos = btn.dataset.pos;
    textConfig.customX = null;
    textConfig.customY = null;
    renderPreview();
  };
});

$("#textSize").oninput = e => {
  textConfig.size = Number(e.target.value);
  $("#textSizeVal").textContent = e.target.value;
  renderPreview();
};

// イラストレイヤー設定
$("#plus").onclick = () => {
  adjust.scale = Math.min(3, adjust.scale + 0.1);
  renderPreview();
};
$("#minus").onclick = () => {
  adjust.scale = Math.max(0.4, adjust.scale - 0.1);
  renderPreview();
};
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
  renderPreview();
};

$("#whiteBorder").onchange = e => {
  whiteBorder = e.target.checked;
  if (whiteBorder && !bgTransparent) {
    bgTransparent = true;
  }
  renderPreview();
};

$("#borderWidth").oninput = e => {
  $("#borderWidthValue").textContent = e.target.value;
  if (bgTransparent) renderPreview();
};

// 背景レイヤー設定
document.querySelectorAll("#bgColorList .cBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#bgColorList .cBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    bgColor = btn.dataset.bg;
    renderPreview();
  };
});

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

// 最終画像書き出し（layerOrderの順序を完全に反映）
async function getFinalCanvas() {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = SPEC[mode].w;
  c.height = SPEC[mode].h;
  const ctx = c.getContext("2d");

  const drawList = layerOrder.slice().reverse();

  drawList.forEach(layerId => {
    if (layerId === "bg") {
      drawBgLayer(ctx, c.width, c.height);
    } else if (layerId === "illust") {
      drawIllustLayer(ctx, c.width, c.height);
    } else if (layerId === "text") {
      drawTextLayer(ctx, c.width, c.height);
    }
  });

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

document.fonts.ready.then(() => {
  if ($("#adjustStep").classList.contains("hidden") === false) {
    renderPreview();
  }
});

updateMode();
