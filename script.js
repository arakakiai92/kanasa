const $ = s => document.querySelector(s);
const stage = $("#stage"), sctx = stage.getContext("2d");
const preview = $("#preview"), pctx = preview.getContext("2d");
const wrap = $("#stageWrap"), crop = $("#cropBox");
const adjustArea = $("#adjustArea");

let mode = "sticker";
let img = null;

// ①切り出し枠の状態
let selectionRect = null; // { x, y, w, h }
let selection = null;     // 元画像座標系 { x, y, w, h }

// ②３レイヤー構成設定
let layerOrder = ["text", "illust", "bg"];

// Layer: 背景
let bgColor = "transparent";

// Layer: イラスト（縁色・縁太さ対応）
let adjust = { src: null, scale: 1, ox: 0, oy: 0 };
let bgTransparent = false;
let illustBorder = false;
let illustBorderColor = "#ffffff"; // デフォルト：白

// Layer: 文字（カラー変更・カスタムピッカー対応）
let textConfig = {
  text: "",
  font: "'Mochiy Pop One', sans-serif",
  color: "#111111", // デフォルト：黒
  stroke: "#ffffff",
  pos: "bottom",
  size: 34,
  customX: null,
  customY: null
};

let currentLayer = "text";
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

// 枠の表示・同期処理
function renderCropBox() {
  if (!selectionRect) {
    crop.classList.add("hidden");
    $("#cropFineTune").classList.add("hidden");
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

  $("#cropFineTune").classList.remove("hidden");
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
  let w = sr.width * 0.6;
  let h = w / r;
  if (h > sr.height * 0.8) {
    h = sr.height * 0.8;
    w = h * r;
  }
  const x = (sr.width - w) / 2;
  const y = (sr.height - h) / 2;

  selectionRect = { x, y, w, h };
  renderCropBox();
  toast("枠を表示しました！動かすか微調整ボタンを使ってね");
};

function getStagePoint(e) {
  const r = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
    y: Math.max(0, Math.min(r.height, e.clientY - r.top))
  };
}

// ①切り出し画面ドラッグ＆リサイズ
let cropDrag = null;

wrap.addEventListener("pointerdown", e => {
  if (!img) return;
  e.preventDefault();
  wrap.setPointerCapture(e.pointerId);

  const p = getStagePoint(e);
  const handleEl = e.target.closest(".handle");
  const isInsideCrop = (e.target === crop || crop.contains(e.target));

  if (handleEl) {
    cropDrag = {
      type: "resize",
      handle: handleEl.dataset.h,
      startP: p,
      orig: { ...selectionRect }
    };
  } else if (isInsideCrop && selectionRect) {
    cropDrag = {
      type: "move",
      startP: p,
      orig: { ...selectionRect }
    };
  } else {
    cropDrag = {
      type: "draw",
      startP: p,
      orig: null
    };
  }
});

wrap.addEventListener("pointermove", e => {
  if (!cropDrag) return;
  e.preventDefault();
  const p = getStagePoint(e);
  const r = SPEC[mode].ratio;
  const sr = stage.getBoundingClientRect();

  if (cropDrag.type === "move") {
    const dx = p.x - cropDrag.startP.x;
    const dy = p.y - cropDrag.startP.y;
    const maxPosX = Math.max(0, sr.width - cropDrag.orig.w);
    const maxPosY = Math.max(0, sr.height - cropDrag.orig.h);

    selectionRect = {
      x: Math.max(0, Math.min(maxPosX, cropDrag.orig.x + dx)),
      y: Math.max(0, Math.min(maxPosY, cropDrag.orig.y + dy)),
      w: cropDrag.orig.w,
      h: cropDrag.orig.h
    };
    renderCropBox();

  } else if (cropDrag.type === "draw") {
    let dx = p.x - cropDrag.startP.x;
    let dy = p.y - cropDrag.startP.y;
    let w = Math.abs(dx);
    let h = Math.abs(dy);

    if (w / h > r) h = w / r;
    else w = h * r;

    if (w < 20 || h < 20) return;

    let x = dx < 0 ? cropDrag.startP.x - w : cropDrag.startP.x;
    let y = dy < 0 ? cropDrag.startP.y - h : cropDrag.startP.y;

    x = Math.max(0, Math.min(sr.width - w, x));
    y = Math.max(0, Math.min(sr.height - h, y));

    selectionRect = { x, y, w, h };
    renderCropBox();

  } else if (cropDrag.type === "resize") {
    const h = cropDrag.handle;
    const orig = cropDrag.orig;

    let ax = (h.includes("w")) ? (orig.x + orig.w) : orig.x;
    let ay = (h.includes("n")) ? (orig.y + orig.h) : orig.y;

    let newW = Math.abs(p.x - ax);
    let newH = newW / r;

    if (newW < 36) { newW = 36; newH = newW / r; }

    let nx = (h.includes("w")) ? (ax - newW) : ax;
    let ny = (h.includes("n")) ? (ay - newH) : ay;

    if (nx < 0) {
      nx = 0; newW = ax; newH = newW / r;
      if (h.includes("n")) ny = ay - newH;
    }
    if (ny < 0) {
      ny = 0; newH = ay; newW = newH * r;
      if (h.includes("w")) nx = ax - newW;
    }
    if (nx + newW > sr.width) {
      newW = sr.width - nx; newH = newW / r;
      if (h.includes("n")) ny = ay - newH;
    }
    if (ny + newH > sr.height) {
      newH = sr.height - ny; newW = newH * r;
      if (h.includes("w")) nx = ax - newW;
    }

    selectionRect = { x: nx, y: ny, w: newW, h: newH };
    renderCropBox();
  }
});

wrap.addEventListener("pointerup", () => { cropDrag = null; });
wrap.addEventListener("pointercancel", () => { cropDrag = null; });

// 切り出し枠微調整
function nudgeCrop(dx, dy) {
  if (!selectionRect) return;
  const sr = stage.getBoundingClientRect();
  const maxPosX = Math.max(0, sr.width - selectionRect.w);
  const maxPosY = Math.max(0, sr.height - selectionRect.h);

  selectionRect.x = Math.max(0, Math.min(maxPosX, selectionRect.x + dx));
  selectionRect.y = Math.max(0, Math.min(maxPosY, selectionRect.y + dy));
  renderCropBox();
}

function scaleCrop(factor) {
  if (!selectionRect) return;
  const r = SPEC[mode].ratio;
  const sr = stage.getBoundingClientRect();
  const cx = selectionRect.x + selectionRect.w / 2;
  const cy = selectionRect.y + selectionRect.h / 2;

  let newW = selectionRect.w * factor;
  let newH = newW / r;

  if (newW < 36) { newW = 36; newH = newW / r; }
  if (newW > sr.width) { newW = sr.width; newH = newW / r; }
  if (newH > sr.height) { newH = sr.height; newW = newH * r; }

  let nx = cx - newW / 2;
  let ny = cy - newH / 2;

  nx = Math.max(0, Math.min(sr.width - newW, nx));
  ny = Math.max(0, Math.min(sr.height - newH, ny));

  selectionRect = { x, y: ny, w: newW, h: newH };
  renderCropBox();
}

$("#cropUp").onclick = () => nudgeCrop(0, -6);
$("#cropDown").onclick = () => nudgeCrop(0, 6);
$("#cropLeft").onclick = () => nudgeCrop(-6, 0);
$("#cropRight").onclick = () => nudgeCrop(6, 0);
$("#cropCenter").onclick = () => {
  if (!selectionRect) return;
  const sr = stage.getBoundingClientRect();
  selectionRect.x = (sr.width - selectionRect.w) / 2;
  selectionRect.y = (sr.height - selectionRect.h) / 2;
  renderCropBox();
  toast("枠を中央に配置しました");
};
$("#cropZoomIn").onclick = () => scaleCrop(1.08);
$("#cropZoomOut").onclick = () => scaleCrop(0.92);

// ②個別編集画面への遷移
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
  preview.width = SPEC[mode].w;
  preview.height = SPEC[mode].h;

  adjust = { src, scale: 1, ox: 0, oy: 0 };
  centerIllust();

  layerOrder = ["text", "illust", "bg"];
  bgColor = "transparent";
  bgTransparent = false;

  // イラストの縁初期化（デフォルト：白）
  illustBorder = false;
  illustBorderColor = "#ffffff";
  $("#illustBorderToggle").checked = false;
  $("#illustBorderColorWrap").classList.add("hidden");
  $("#borderWidth").value = 6;
  $("#borderWidthValue").textContent = "6";
  $("#illustBorderColorPicker").value = "#ffffff";
  document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.color === "#ffffff");
  });

  textConfig.customX = null;
  textConfig.customY = null;

  $("#adjustStep").classList.remove("hidden");
  $("#sheetStep").classList.add("hidden");

  switchLayerTab("text");
  updateLayerListUI();
  updateScaleUI();
  renderPreview();
}

function centerIllust() {
  const iw = preview.width * adjust.scale;
  const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;
  adjust.ox = (preview.width - iw) / 2;
  adjust.oy = (preview.height - ih) / 2;
}

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

function moveLayer(layerId, dir) {
  const idx = layerOrder.indexOf(layerId);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layerOrder.length) return;

  const temp = layerOrder[idx];
  layerOrder[idx] = layerOrder[newIdx];
  layerOrder[newIdx] = temp;

  switchLayerTab(layerId);
  updateLayerListUI();
  renderPreview();

  const posName = newIdx === 0 ? "一番手前" : (newIdx === 1 ? "中間" : "一番奥");
  const layerName = layerId === "text" ? "文字" : (layerId === "illust" ? "イラスト" : "はいけい");
  toast(`${layerName}を【${posName}】に移動しました`);
}

document.querySelectorAll(".btnOrderUp").forEach(btn => {
  btn.onclick = e => { e.stopPropagation(); moveLayer(btn.dataset.layer, -1); };
});
document.querySelectorAll(".btnOrderDown").forEach(btn => {
  btn.onclick = e => { e.stopPropagation(); moveLayer(btn.dataset.layer, 1); };
});

function updateLayerListUI() {
  const list = $("#layerStackList");
  layerOrder.forEach((id, idx) => {
    const item = $(`#item-${id}`);
    if (item) list.appendChild(item);

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

function updateLayerStatus() {
  const txt = textConfig.text.trim();
  if (txt) {
    $("#stateText").textContent = `"${txt.slice(0, 7)}${txt.length > 7 ? '…' : ''}"`;
    $("#stateText").style.color = textConfig.color === "#ffffff" ? "#888" : textConfig.color;
  } else {
    $("#stateText").textContent = "無選択 (なし)";
    $("#stateText").style.color = "#666";
  }

  let stIllust = "標準";
  if (bgTransparent && illustBorder) {
    stIllust = illustBorderColor.toLowerCase() === "#ffffff" ? "透過+白フチ" : "透過+カラーフチ";
  } else if (bgTransparent) {
    stIllust = "透過ON";
  }
  $("#stateIllust").textContent = stIllust;

  $("#stateBg").textContent = bgColor === "transparent" ? "とうめい (標準)" : "色つき";
  $("#transState").textContent = bgTransparent ? "透過 ON" : "透過 OFF";
  $("#transparent").textContent = bgTransparent ? "↩️ 透過を解除" : "✨ 絵のまわりを透明にする";
}

// ３レイヤー合成レンダリング
function renderPreview() {
  pctx.clearRect(0, 0, preview.width, preview.height);

  const drawList = layerOrder.slice().reverse();
  drawList.forEach(layerId => {
    if (layerId === "bg") drawBgLayer(pctx, preview.width, preview.height);
    else if (layerId === "illust") drawIllustLayer(pctx, preview.width, preview.height);
    else if (layerId === "text") drawTextLayer(pctx, preview.width, preview.height);
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
  if (illustBorder && bgTransparent) {
    illust = addIllustBorder(illust, Number($("#borderWidth").value), illustBorderColor);
  }

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

// プレビュー操作（パン＆ピンチズーム）
let activePointers = new Map();
let initialPinchDistance = null;
let initialScale = 1;
let previewDragStart = null;

adjustArea.addEventListener("pointerdown", e => {
  e.preventDefault();
  adjustArea.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  const rect = preview.getBoundingClientRect();
  const scaleFactor = preview.width / rect.width;
  const px = (e.clientX - rect.left) * scaleFactor;
  const py = (e.clientY - rect.top) * scaleFactor;

  if (activePointers.size === 1) {
    if (currentLayer === "text" && textConfig.text.trim()) {
      let currentX = textConfig.customX !== null ? textConfig.customX : preview.width / 2;
      let currentY = textConfig.customY !== null ? textConfig.customY : (
        textConfig.pos === "top" ? 30 : (textConfig.pos === "center" ? preview.height / 2 : preview.height - 30)
      );
      previewDragStart = {
        target: "text",
        startX: px,
        startY: py,
        origX: currentX,
        origY: currentY
      };
    } else {
      previewDragStart = {
        target: "illust",
        startX: px,
        startY: py,
        origOx: adjust.ox,
        origOy: adjust.oy
      };
    }
  } else if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    initialScale = adjust.scale;
    previewDragStart = null;
  }
});

adjustArea.addEventListener("pointermove", e => {
  if (!activePointers.has(e.pointerId)) return;
  e.preventDefault();
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2 && initialPinchDistance) {
    const pts = Array.from(activePointers.values());
    const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ratio = currentDist / initialPinchDistance;
    adjust.scale = Math.max(0.4, Math.min(3.0, initialScale * ratio));
    updateScaleUI();
    renderPreview();
    return;
  }

  if (previewDragStart && activePointers.size === 1) {
    const rect = preview.getBoundingClientRect();
    const scaleFactor = preview.width / rect.width;
    const px = (e.clientX - rect.left) * scaleFactor;
    const py = (e.clientY - rect.top) * scaleFactor;

    const dx = px - previewDragStart.startX;
    const dy = py - previewDragStart.startY;

    if (previewDragStart.target === "text") {
      textConfig.customX = previewDragStart.origX + dx;
      textConfig.customY = previewDragStart.origY + dy;
      document.querySelectorAll(".posBtns .posBtn").forEach(b => b.classList.remove("active"));
    } else if (previewDragStart.target === "illust") {
      adjust.ox = previewDragStart.origOx + dx;
      adjust.oy = previewDragStart.origOy + dy;
    }
    renderPreview();
  }
});

function endPointer(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) initialPinchDistance = null;
  if (activePointers.size === 0) previewDragStart = null;
}
adjustArea.addEventListener("pointerup", endPointer);
adjustArea.addEventListener("pointercancel", endPointer);

// イラスト拡大縮小＆微調整
function updateScaleUI() {
  const percent = Math.round(adjust.scale * 100);
  $("#illustScaleSlider").value = percent;
  $("#illustScaleVal").textContent = percent;
}

$("#illustScaleSlider").oninput = e => {
  const oldScale = adjust.scale;
  const newScale = Number(e.target.value) / 100;
  
  const cx = preview.width / 2;
  const cy = preview.height / 2;
  adjust.ox = cx - (cx - adjust.ox) * (newScale / oldScale);
  adjust.oy = cy - (cy - adjust.oy) * (newScale / oldScale);
  adjust.scale = newScale;

  $("#illustScaleVal").textContent = e.target.value;
  renderPreview();
};

function nudgeIllust(dx, dy) {
  adjust.ox += dx;
  adjust.oy += dy;
  renderPreview();
}

$("#illustUp").onclick = () => nudgeIllust(0, -6);
$("#illustDown").onclick = () => nudgeIllust(0, 6);
$("#illustLeft").onclick = () => nudgeIllust(-6, 0);
$("#illustRight").onclick = () => nudgeIllust(6, 0);
$("#center").onclick = () => {
  centerIllust();
  renderPreview();
  toast("イラストを中央に戻しました");
};
$("#resetAdjust").onclick = () => {
  adjust.scale = 1;
  centerIllust();
  updateScaleUI();
  renderPreview();
  toast("初期サイズ・中央に戻しました");
};

$("#fitWidth").onclick = () => {
  adjust.scale = preview.width / adjust.src.width;
  centerIllust();
  updateScaleUI();
  renderPreview();
};
$("#fitHeight").onclick = () => {
  adjust.scale = preview.height / adjust.src.height;
  centerIllust();
  updateScaleUI();
  renderPreview();
};

$("#transparent").onclick = () => {
  bgTransparent = !bgTransparent;
  renderPreview();
};

// イラスト縁のトグル＆色変更設定
$("#illustBorderToggle").onchange = e => {
  illustBorder = e.target.checked;
  if (illustBorder && !bgTransparent) {
    bgTransparent = true;
  }
  $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
  renderPreview();
};

$("#borderWidth").oninput = e => {
  $("#borderWidthValue").textContent = e.target.value;
  if (illustBorder && bgTransparent) renderPreview();
};

document.querySelectorAll("#illustBorderColorList .cBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    illustBorderColor = btn.dataset.color;
    $("#illustBorderColorPicker").value = illustBorderColor;
    renderPreview();
  };
});

$("#illustBorderColorPicker").oninput = e => {
  document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
  illustBorderColor = e.target.value;
  renderPreview();
};

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

// 文字色の変更（パレットボタン）
document.querySelectorAll("#textColorList .cBtn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    textConfig.color = btn.dataset.color;
    $("#textColorPicker").value = textConfig.color;
    renderPreview();
  };
});

// 文字色の変更（自由カラーピッカー）
$("#textColorPicker").oninput = e => {
  document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
  textConfig.color = e.target.value;
  renderPreview();
};

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

function nudgeText(dx, dy) {
  if (textConfig.customX === null) textConfig.customX = preview.width / 2;
  if (textConfig.customY === null) {
    textConfig.customY = textConfig.pos === "top" ? 30 : (textConfig.pos === "center" ? preview.height / 2 : preview.height - 30);
  }
  textConfig.customX += dx;
  textConfig.customY += dy;
  document.querySelectorAll(".posBtns .posBtn").forEach(b => b.classList.remove("active"));
  renderPreview();
}

$("#textUp").onclick = () => nudgeText(0, -6);
$("#textDown").onclick = () => nudgeText(0, 6);
$("#textLeft").onclick = () => nudgeText(-6, 0);
$("#textRight").onclick = () => nudgeText(6, 0);
$("#textResetPos").onclick = () => {
  textConfig.customX = null;
  textConfig.customY = null;
  document.querySelectorAll(".posBtns .posBtn").forEach(b => b.classList.toggle("active", b.dataset.pos === textConfig.pos));
  renderPreview();
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

// イラストのカラーフチ合成（指定した色で高速生成）
function addIllustBorder(src, px, color = "#ffffff") {
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
  mctx.fillStyle = color;
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

// 最終画像書き出し
async function getFinalCanvas() {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = SPEC[mode].w;
  c.height = SPEC[mode].h;
  const ctx = c.getContext("2d");

  const drawList = layerOrder.slice().reverse();
  drawList.forEach(layerId => {
    if (layerId === "bg") drawBgLayer(ctx, c.width, c.height);
    else if (layerId === "illust") drawIllustLayer(ctx, c.width, c.height);
    else if (layerId === "text") drawTextLayer(ctx, c.width, c.height);
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
