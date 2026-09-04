document.addEventListener("DOMContentLoaded", () => {
  const $ = s => document.querySelector(s);
  const stage = $("#stage"), sctx = stage.getContext("2d");
  const preview = $("#preview"), pctx = preview.getContext("2d");
  const wrap = $("#stageWrap"), crop = $("#cropBox");
  const adjustArea = $("#adjustArea");

  let mode = "sticker";
  let img = null;

  let selectionRect = null;
  let selection = null;
  let layerOrder = ["illust", "text", "bg"];

  let bgConfig = {
    style: "none",
    color: "#fff9db",
    image: null,
    scale: 1,
    ox: 0,
    oy: 0,
    rotation: 0
  };

  let adjust = { src: null, processedSrc: null, scale: 1, ox: 0, oy: 0, rotation: 0 };
  let bgTransparent = true;
  let bgTolerance = 22;
  protectWhite = true;
  let illustBorder = false;
  let illustBorderColor = "#ffffff";

  let textConfig = {
    text: "",
    font: "'M PLUS Rounded 1c', sans-serif",
    color: "#111111",
    stroke: "#ffffff",
    size: 34,
    ox: 0,
    oy: 0,
    rotation: 0,
    initialized: false
  };

  let isEraserActive = false;
  let eraserRadius = 14;
  let eraserUndoStack = [];
  let lastErasePoint = null;

  let currentLayer = "illust";
  let results = [];
  let editingIndex = null;
  let currentModalIndex = null;

  const SPEC = {
    sticker: { ratio: 370 / 320, w: 370, h: 320, label: "370 × 320 px（スタンプ用）" },
    emoji: { ratio: 1, w: 180, h: 180, label: "180 × 180 px（絵文字用）" }
  };

  function updateMode() {
    const s = SPEC[mode];
    $("#spec").textContent = `切り抜き比率：${mode === "sticker" ? "370 : 320" : "1 : 1"} ／ 書き出し：${s.label}`;
    $("#total").textContent = $("#count").value;
    
    document.querySelectorAll(".switch button").forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add("bg-white", "shadow-sm", "text-gray-800");
        btn.classList.remove("text-gray-500");
      } else {
        btn.classList.remove("bg-white", "shadow-sm", "text-gray-800");
        btn.classList.add("text-gray-500");
      }
    });

    if (img) initOrAdjustSelection();
  }

  document.querySelectorAll(".switch button").forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    updateMode();
  });

  $("#count").onchange = () => { $("#total").textContent = $("#count").value; };

  function resetSelection() {
    selectionRect = null;
    selection = null;
    crop.classList.add("hidden");
    $("#cropFineTune").classList.add("hidden");
    $("#resetCrop").classList.add("hidden");
    $("#adjustBtn").classList.add("hidden");
    $("#startSelect").classList.remove("hidden");
  }

  // ファイル読み込み処理
  const fileInput = $("#file");
  if (fileInput) {
    fileInput.onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      
      toast("画像を読み込んでいます...");
      
      const reader = new FileReader();
      reader.onload = event => {
        const im = new Image();
        im.onload = () => {
          img = im;
          results = [];
          editingIndex = null;
          
          $("#sheetStep").classList.remove("hidden");
          $("#adjustStep").classList.add("hidden");
          
          setupCanvas();
          renderSheet();
          
          requestAnimationFrame(() => {
            initOrAdjustSelection();
            refresh();
            toast("シートを読み込みました！枠を動かしてね");
          });
        };
        im.onerror = () => {
          toast("画像の読み込みに失敗しました。");
        };
        im.src = event.target.result;
      };
      reader.readAsDataURL(f);
    };
  }

  function setupCanvas() {
    const containerW = wrap.clientWidth || window.innerWidth - 40;
    const maxW = Math.min(containerW > 0 ? containerW : 600, 900);
    const scale = Math.min(1, maxW / img.naturalWidth);
    stage.width = Math.round(img.naturalWidth * scale);
    stage.height = Math.round(img.naturalHeight * scale);
  }

  function renderSheet() {
    sctx.clearRect(0, 0, stage.width, stage.height);
    sctx.drawImage(img, 0, 0, stage.width, stage.height);
  }

  function renderCropBox() {
    if (!selectionRect) {
      resetSelection();
      $("#sheetProgress").textContent = `${results.length + 1} / ${$("#count").value}`;
      return;
    }

    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : (stage.clientWidth || stage.width || 300);
    const srH = sr.height > 0 ? sr.height : (stage.clientHeight || stage.height || 300);

    crop.style.left = `${(selectionRect.x / srW) * 100}%`;
    crop.style.top = `${(selectionRect.y / srH) * 100}%`;
    crop.style.width = `${(selectionRect.w / srW) * 100}%`;
    crop.style.height = `${(selectionRect.h / srH) * 100}%`;
    crop.classList.remove("hidden");

    $("#cropFineTune").classList.remove("hidden");
    $("#resetCrop").classList.remove("hidden");
    $("#adjustBtn").classList.remove("hidden");
    $("#startSelect").classList.add("hidden");

    const scaleX = img.naturalWidth / srW;
    const scaleY = img.naturalHeight / srH;
    selection = {
      x: selectionRect.x * scaleX,
      y: selectionRect.y * scaleY,
      w: selectionRect.w * scaleX,
      h: selectionRect.h * scaleY
    };
  }

  function initOrAdjustSelection() {
    if (!img) return;
    const r = SPEC[mode].ratio;
    const sr = stage.getBoundingClientRect();
    const w = sr.width > 0 ? sr.width : (stage.clientWidth || stage.width || 300);
    const h = sr.height > 0 ? sr.height : (stage.clientHeight || stage.height || 300);

    let boxW = w * 0.55;
    let boxH = boxW / r;
    if (boxH > h * 0.75) {
      boxH = h * 0.75;
      boxW = boxH * r;
    }
    const x = (w - boxW) / 2;
    const y = (h - boxH) / 2;

    selectionRect = { x, y, w: boxW, h: boxH };
    renderCropBox();
  }

  $("#resetCrop").onclick = () => { initOrAdjustSelection(); toast("枠をリセットしました"); };
  $("#startSelect").onclick = () => { initOrAdjustSelection(); toast("切り出し枠を表示しました！"); };

  function getTouchPos(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const w = r.width > 0 ? r.width : (stage.clientWidth || stage.width || 300);
    const h = r.height > 0 ? r.height : (stage.clientHeight || stage.height || 300);
    return {
      x: Math.max(0, Math.min(w, clientX - r.left)),
      y: Math.max(0, Math.min(h, clientY - r.top))
    };
  }

  let cropDrag = null;

  wrap.addEventListener("touchstart", e => {
    if (!img) return;
    e.preventDefault();
    const touch = e.touches[0];
    const p = getTouchPos(touch.clientX, touch.clientY);
    const handleEl = e.target.closest(".handle");
    const isInsideCrop = (e.target === crop || crop.contains(e.target));

    if (handleEl) {
      cropDrag = { type: "resize", handle: handleEl.dataset.h, startP: p, orig: { ...selectionRect } };
    } else if (isInsideCrop && selectionRect) {
      cropDrag = { type: "move", startP: p, orig: { ...selectionRect } };
    } else {
      cropDrag = { type: "draw", startP: p, orig: null };
    }
  }, { passive: false });

  wrap.addEventListener("touchmove", e => {
    if (!cropDrag) return;
    e.preventDefault();
    const touch = e.touches[0];
    const p = getTouchPos(touch.clientX, touch.clientY);
    const r = SPEC[mode].ratio;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : (stage.clientWidth || stage.width || 300);
    const srH = sr.height > 0 ? sr.height : (stage.clientHeight || stage.height || 300);

    if (cropDrag.type === "move") {
      const dx = p.x - cropDrag.startP.x;
      const dy = p.y - cropDrag.startP.y;
      selectionRect = {
        x: Math.max(0, Math.min(srW - cropDrag.orig.w, cropDrag.orig.x + dx)),
        y: Math.max(0, Math.min(srH - cropDrag.orig.h, cropDrag.orig.y + dy)),
        w: cropDrag.orig.w, h: cropDrag.orig.h
      };
      renderCropBox();
    } else if (cropDrag.type === "draw") {
      let dx = p.x - cropDrag.startP.x;
      let dy = p.y - cropDrag.startP.y;
      let w = Math.abs(dx), h = Math.abs(dy);
      if (w / h > r) h = w / r; else w = h * r;
      if (w < 20 || h < 20) return;
      let x = dx < 0 ? cropDrag.startP.x - w : cropDrag.startP.x;
      let y = dy < 0 ? cropDrag.startP.y - h : cropDrag.startP.y;
      selectionRect = { x: Math.max(0, Math.min(srW - w, x)), y: Math.max(0, Math.min(srH - h, y)), w, h };
      renderCropBox();
    } else if (cropDrag.type === "resize") {
      const handle = cropDrag.handle;
      const orig = cropDrag.orig;
      let ax = handle.includes("w") ? orig.x + orig.w : orig.x;
      let ay = handle.includes("n") ? orig.y + orig.h : orig.y;
      let newW = Math.abs(p.x - ax);
      let newH = newW / r;
      if (newW < 36) { newW = 36; newH = newW / r; }
      let nx = handle.includes("w") ? ax - newW : ax;
      let ny = handle.includes("n") ? ay - newH : ay;
      selectionRect = { x: nx, y: ny, w: newW, h: newH };
      renderCropBox();
    }
  }, { passive: false });

  wrap.addEventListener("touchend", () => { cropDrag = null; });
  wrap.addEventListener("touchcancel", () => { cropDrag = null; });

  wrap.addEventListener("mousedown", e => {
    if (!img) return;
    const p = getTouchPos(e.clientX, e.clientY);
    const handleEl = e.target.closest(".handle");
    const isInsideCrop = (e.target === crop || crop.contains(e.target));

    if (handleEl) {
      cropDrag = { type: "resize", handle: handleEl.dataset.h, startP: p, orig: { ...selectionRect } };
    } else if (isInsideCrop && selectionRect) {
      cropDrag = { type: "move", startP: p, orig: { ...selectionRect } };
    } else {
      cropDrag = { type: "draw", startP: p, orig: null };
    }
  });
  wrap.addEventListener("mousemove", e => {
    if (!cropDrag) return;
    const p = getTouchPos(e.clientX, e.clientY);
    const r = SPEC[mode].ratio;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : (stage.clientWidth || stage.width || 300);
    const srH = sr.height > 0 ? sr.height : (stage.clientHeight || stage.height || 300);

    if (cropDrag.type === "move") {
      const dx = p.x - cropDrag.startP.x;
      const dy = p.y - cropDrag.startP.y;
      selectionRect = {
        x: Math.max(0, Math.min(srW - cropDrag.orig.w, cropDrag.orig.x + dx)),
        y: Math.max(0, Math.min(srH - cropDrag.orig.h, cropDrag.orig.y + dy)),
        w: cropDrag.orig.w, h: cropDrag.orig.h
      };
      renderCropBox();
    } else if (cropDrag.type === "draw") {
      let dx = p.x - cropDrag.startP.x;
      let dy = p.y - cropDrag.startP.y;
      let w = Math.abs(dx), h = Math.abs(dy);
      if (w / h > r) h = w / r; else w = h * r;
      if (w < 20 || h < 20) return;
      let x = dx < 0 ? cropDrag.startP.x - w : cropDrag.startP.x;
      let y = dy < 0 ? cropDrag.startP.y - h : cropDrag.startP.y;
      selectionRect = { x: Math.max(0, Math.min(srW - w, x)), y: Math.max(0, Math.min(srH - h, y)), w, h };
      renderCropBox();
    } else if (cropDrag.type === "resize") {
      const handle = cropDrag.handle;
      const orig = cropDrag.orig;
      let ax = handle.includes("w") ? orig.x + orig.w : orig.x;
      let ay = handle.includes("n") ? orig.y + orig.h : orig.y;
      let newW = Math.abs(p.x - ax);
      let newH = newW / r;
      if (newW < 36) { newW = 36; newH = newW / r; }
      let nx = handle.includes("w") ? ax - newW : ax;
      let ny = handle.includes("n") ? ay - newH : ay;
      selectionRect = { x: nx, y: ny, w: newW, h: newH };
      renderCropBox();
    }
  });
  wrap.addEventListener("mouseup", () => { cropDrag = null; });

  function nudgeCrop(dx, dy) {
    if (!selectionRect) return;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : 300;
    const srH = sr.height > 0 ? sr.height : 300;
    selectionRect.x = Math.max(0, Math.min(srW - selectionRect.w, selectionRect.x + dx));
    selectionRect.y = Math.max(0, Math.min(srH - selectionRect.h, selectionRect.y + dy));
    renderCropBox();
  }

  function scaleCrop(factor) {
    if (!selectionRect) return;
    const r = SPEC[mode].ratio;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : 300;
    const srH = sr.height > 0 ? sr.height : 300;
    const cx = selectionRect.x + selectionRect.w / 2;
    const cy = selectionRect.y + selectionRect.h / 2;
    let newW = selectionRect.w * factor;
    let newH = newW / r;
    if (newW < 36) { newW = 36; newH = newW / r; }
    let nx = Math.max(0, Math.min(srW - newW, cx - newW / 2));
    let ny = Math.max(0, Math.min(srH - newH, cy - newH / 2));
    selectionRect = { x: nx, y: ny, w: newW, h: newH };
    renderCropBox();
  }

  $("#cropUp").onclick = () => nudgeCrop(0, -6);
  $("#cropDown").onclick = () => nudgeCrop(0, 6);
  $("#cropLeft").onclick = () => nudgeCrop(-6, 0);
  $("#cropRight").onclick = () => nudgeCrop(6, 0);
  $("#cropCenter").onclick = () => {
    if (!selectionRect) return;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : 300;
    const srH = sr.height > 0 ? sr.height : 300;
    selectionRect.x = (srW - selectionRect.w) / 2;
    selectionRect.y = (srH - selectionRect.h) / 2;
    renderCropBox();
  };
  $("#cropZoomIn").onclick = () => scaleCrop(1.08);
  $("#cropZoomOut").onclick = () => scaleCrop(0.92);

  $("#adjustBtn").onclick = () => {
    if (!selection) { toast("絵を指で囲んでね"); return; }
    editingIndex = null;
    openAdjustNew();
  };

  $("#back").onclick = () => {
    editingIndex = null;
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

  function openAdjustNew() {
    const src = cropFromOriginal(selection);
    preview.width = SPEC[mode].w;
    preview.height = SPEC[mode].h;

    adjust = { src, processedSrc: null, scale: 1, ox: 0, oy: 0, rotation: 0 };
    centerIllust();

    bgConfig = { style: "none", color: "#fff9db", image: null, scale: 1, ox: 0, oy: 0, rotation: 0 };
    
    const isEmoji = (mode === "emoji");
    textConfig.ox = preview.width / 2;
    textConfig.oy = isEmoji ? preview.height - 24 : preview.height - 40;
    textConfig.text = "";
    textConfig.size = isEmoji ? 22 : 34;
    textConfig.color = "#111111";
    textConfig.stroke = "#ffffff";
    textConfig.rotation = 0;
    $("#stampText").value = "";

    layerOrder = ["illust", "text", "bg"];
    bgTransparent = true;
    bgTolerance = 22;
    protectWhite = true;
    $("#bgToleranceSlider").value = 22;
    $("#bgToleranceVal").textContent = "22";
    $("#protectWhiteToggle").checked = true;

    illustBorder = false;
    illustBorderColor = "#ffffff";
    $("#illustBorderToggle").checked = false;
    $("#illustBorderColorWrap").classList.add("hidden");
    $("#borderWidth").value = 6;
    $("#borderWidthValue").textContent = "6";

    isEraserActive = false;
    eraserUndoStack = [];
    lastErasePoint = null;
    updateEraserUI();

    $("#save").textContent = "💾 このスタンプを保存する";
    $("#adjustStepTitle").textContent = "スタンプをととのえる";

    $("#adjustStep").classList.remove("hidden");
    $("#sheetStep").classList.add("hidden");

    switchLayer("illust");
    updateIllustCache();
    updateLayerListUI();
    updateBgUI();
    renderPreview();
  }

  function openAdjustForEdit(savedState) {
    preview.width = SPEC[mode].w;
    preview.height = SPEC[mode].h;

    adjust.src = savedState.adjust.src;
    adjust.scale = savedState.adjust.scale;
    adjust.ox = savedState.adjust.ox;
    adjust.oy = savedState.adjust.oy;
    adjust.rotation = savedState.adjust.rotation !== undefined ? savedState.adjust.rotation : 0;

    textConfig = { ...savedState.textConfig };
    if (textConfig.rotation === undefined) textConfig.rotation = 0;

    $("#stampText").value = textConfig.text || "";
    $("#textFont").value = textConfig.font || "'M PLUS Rounded 1c', sans-serif";
    $("#textColorPicker").value = (textConfig.color && textConfig.color.startsWith("#")) ? textConfig.color : "#111111";
    document.querySelectorAll("#textColorList .cBtn").forEach(b => {
      b.classList.toggle("active", b.dataset.color && b.dataset.color.toLowerCase() === textConfig.color.toLowerCase());
    });
    document.querySelectorAll("#textStrokeList .sBtn").forEach(b => {
      b.classList.toggle("active", b.dataset.stroke === textConfig.stroke);
    });

    bgConfig = {
      style: savedState.bgConfig.style || "none",
      color: savedState.bgConfig.color || "#fff9db",
      image: savedState.bgConfig.image || null,
      scale: savedState.bgConfig.scale || 1,
      ox: savedState.bgConfig.ox || 0,
      oy: savedState.bgConfig.oy || 0,
      rotation: savedState.bgConfig.rotation !== undefined ? savedState.bgConfig.rotation : 0
    };

    layerOrder = [...savedState.layerOrder];
    bgTransparent = savedState.bgTransparent !== undefined ? savedState.bgTransparent : true;
    bgTolerance = savedState.bgTolerance !== undefined ? savedState.bgTolerance : 22;
    protectWhite = savedState.protectWhite !== undefined ? savedState.protectWhite : true;
    illustBorder = savedState.illustBorder;
    illustBorderColor = savedState.illustBorderColor || "#ffffff";

    $("#bgToleranceSlider").value = bgTolerance;
    $("#bgToleranceVal").textContent = bgTolerance;
    $("#protectWhiteToggle").checked = protectWhite;

    $("#illustBorderToggle").checked = illustBorder;
    $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
    $("#borderWidth").value = savedState.borderWidth || 6;
    $("#borderWidthValue").textContent = savedState.borderWidth || 6;

    isEraserActive = false;
    eraserUndoStack = [];
    lastErasePoint = null;
    updateEraserUI();

    $("#save").textContent = `💾 ${editingIndex + 1}個目を修正して上書き保存`;
    $("#adjustStepTitle").textContent = `${editingIndex + 1}個目を修正中（上書き保存）`;

    $("#adjustStep").classList.remove("hidden");
    $("#sheetStep").classList.add("hidden");

    switchLayer("illust");
    updateIllustCache();
    updateLayerListUI();
    updateBgUI();
    renderPreview();
    toast(`${editingIndex + 1}個目のデータを読み込みました`);
  }

  function centerIllust() {
    const iw = preview.width * adjust.scale;
    const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;
    adjust.ox = (preview.width - iw) / 2;
    adjust.oy = (preview.height - ih) / 2;
  }

  function setEraserMode(active) {
    isEraserActive = active;
    $("#eraserToggleBtn").textContent = isEraserActive ? "🧹 消しゴム：ON" : "🧹 消しゴム：OFF";
    $("#eraserToggleBtn").classList.toggle("active", isEraserActive);
    $("#eraserOptionsWrap").classList.toggle("hidden", !isEraserActive);
    adjustArea.classList.toggle("erasing", isEraserActive);
    if (!isEraserActive) $("#eraserCursor").classList.add("hidden");
  }

  function updateEraserUI() {
    setEraserMode(isEraserActive);
    $("#eraserUndoBtn").disabled = (eraserUndoStack.length === 0);
  }

  $("#eraserToggleBtn").onclick = () => {
    if (currentLayer !== "illust") switchLayer("illust");
    setEraserMode(!isEraserActive);
    if (isEraserActive) toast("消しゴムON：プレビューをなぞってね");
  };

  document.querySelectorAll(".eSizeBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".eSizeBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      eraserRadius = Number(btn.dataset.size) / 2;
    };
  });

  $("#eraserUndoBtn").onclick = () => {
    if (eraserUndoStack.length === 0) return;
    const lastSnapshot = eraserUndoStack.pop();
    const sctx = adjust.src.getContext("2d");
    sctx.putImageData(lastSnapshot, 0, 0);
    updateEraserUI();
    updateIllustCache();
    renderPreview();
    toast("消しゴムを1つ元に戻しました");
  };

  function eraseAtCoords(p1, p2) {
    if (!adjust.src) return;
    const sctx = adjust.src.getContext("2d");
    const ratio = adjust.src.width / (preview.width * adjust.scale);

    const sx1 = (p1.x - adjust.ox) * ratio;
    const sy1 = (p1.y - adjust.oy) * ratio;
    const rInSrc = eraserRadius * ratio;

    sctx.save();
    sctx.globalCompositeOperation = "destination-out";

    if (!p2 || (p1.x === p2.x && p1.y === p2.y)) {
      sctx.beginPath();
      sctx.arc(sx1, sy1, Math.max(1, rInSrc), 0, Math.PI * 2);
      sctx.fill();
    } else {
      const sx2 = (p2.x - adjust.ox) * ratio;
      const sy2 = (p2.y - adjust.oy) * ratio;
      sctx.beginPath();
      sctx.arc(sx2, sy2, Math.max(1, rInSrc), 0, Math.PI * 2);
      sctx.fill();

      sctx.beginPath();
      sctx.lineWidth = Math.max(2, rInSrc * 2);
      sctx.lineCap = "round";
      sctx.lineJoin = "round";
      sctx.moveTo(sx1, sy1);
      sctx.lineTo(sx2, sy2);
      sctx.stroke();
    }
    sctx.restore();
  }

  function updateEraserCursorPos(clientX, clientY) {
    if (!isEraserActive) return;
    const cursor = $("#eraserCursor");
    const rect = adjustArea.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const displayScale = rect.width / preview.width;
    const diameter = eraserRadius * 2 * displayScale;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    cursor.classList.add("hidden");
  }

  let touchMode = null;
  let touchStartX = 0, touchStartY = 0;
  let origOx = 0, origOy = 0;
  let initialDist = 0;
  let initialScale = 1;
  let initialAngle = 0;
  let origRotation = 0;

  adjustArea.addEventListener("touchstart", e => {
    e.preventDefault();
    const rect = preview.getBoundingClientRect();
    const scaleFactor = preview.width / rect.width;

    if (isEraserActive && currentLayer === "illust" && e.touches.length === 1) {
      if (adjust.src) {
        const sctx = adjust.src.getContext("2d");
        const snapshot = sctx.getImageData(0, 0, adjust.src.width, adjust.src.height);
        eraserUndoStack.push(snapshot);
        if (eraserUndoStack.length > 10) eraserUndoStack.shift();
        updateEraserUI();
      }
      const px = (e.touches[0].clientX - rect.left) * scaleFactor;
      const py = (e.touches[0].clientY - rect.top) * scaleFactor;
      lastErasePoint = { x: px, y: py };
      eraseAtCoords(lastErasePoint, null);
      updateIllustCache();
      renderPreview();
      updateEraserCursorPos(e.touches[0].clientX, e.touches[0].clientY);
      return;
    }

    if (e.touches.length === 1 && !isEraserActive) {
      touchMode = 'drag';
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      if (currentLayer === "illust") { origOx = adjust.ox; origOy = adjust.oy; }
      else if (currentLayer === "text") { origOx = textConfig.ox; origOy = textConfig.oy; }
      else if (currentLayer === "bg") { origOx = bgConfig.ox; origOy = bgConfig.oy; }
    } else if (e.touches.length >= 2) {
      touchMode = 'pinch';
      initialDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialAngle = Math.atan2(
        e.touches[1].clientY - e.touches[0].clientY,
        e.touches[1].clientX - e.touches[0].clientX
      );
      if (currentLayer === "illust") { initialScale = adjust.scale; origRotation = adjust.rotation; }
      else if (currentLayer === "text") { initialScale = textConfig.size; origRotation = textConfig.rotation; }
      else if (currentLayer === "bg") { initialScale = bgConfig.scale; origRotation = bgConfig.rotation; }
    }
  }, { passive: false });

  adjustArea.addEventListener("touchmove", e => {
    e.preventDefault();
    const rect = preview.getBoundingClientRect();
    const scaleFactor = preview.width / rect.width;

    if (isEraserActive && currentLayer === "illust" && e.touches.length === 1) {
      updateEraserCursorPos(e.touches[0].clientX, e.touches[0].clientY);
      if (lastErasePoint) {
        const px = (e.touches[0].clientX - rect.left) * scaleFactor;
        const py = (e.touches[0].clientY - rect.top) * scaleFactor;
        const currentP = { x: px, y: py };
        eraseAtCoords(lastErasePoint, currentP);
        lastErasePoint = currentP;
        updateIllustCache();
        renderPreview();
      }
      return;
    }

    if (touchMode === 'drag' && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - touchStartX) * scaleFactor;
      const dy = (e.touches[0].clientY - touchStartY) * scaleFactor;

      if (!isNaN(dx) && !isNaN(dy)) {
        if (currentLayer === "illust") {
          adjust.ox = origOx + dx;
          adjust.oy = origOy + dy;
        } else if (currentLayer === "text") {
          textConfig.ox = origOx + dx;
          textConfig.oy = origOy + dy;
        } else if (currentLayer === "bg") {
          bgConfig.ox = origOx + dx;
          bgConfig.oy = origOy + dy;
        }
        renderPreview();
      }
    } else if (touchMode === 'pinch' && e.touches.length >= 2) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const currentAngle = Math.atan2(
        e.touches[1].clientY - e.touches[0].clientY,
        e.touches[1].clientX - e.touches[0].clientX
      );

      if (initialDist > 0 && !isNaN(currentDist)) {
        const ratio = currentDist / initialDist;
        const angleDiff = currentAngle - initialAngle;

        if (currentLayer === "illust") {
          adjust.scale = Math.max(0.4, Math.min(3.0, initialScale * ratio));
          adjust.rotation = origRotation + angleDiff;
        } else if (currentLayer === "text") {
          textConfig.size = Math.round(Math.max(10, Math.min(76, initialScale * ratio)));
          textConfig.rotation = origRotation + angleDiff;
        } else if (currentLayer === "bg") {
          bgConfig.scale = Math.max(0.2, Math.min(3.0, initialScale * ratio));
          bgConfig.rotation = origRotation + angleDiff;
        }
        syncCommonScaleSlider();
        renderPreview();
      }
    }
  }, { passive: false });

  adjustArea.addEventListener("touchend", e => {
    lastErasePoint = null;
    if (isEraserActive) $("#eraserCursor").classList.add("hidden");

    if (e.touches.length === 0) {
      touchMode = null;
    } else if (e.touches.length === 1) {
      touchMode = 'drag';
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      if (currentLayer === "illust") { origOx = adjust.ox; origOy = adjust.oy; }
      else if (currentLayer === "text") { origOx = textConfig.ox; origOy = textConfig.oy; }
      else if (currentLayer === "bg") { origOx = bgConfig.ox; origOy = bgConfig.oy; }
    }
  });

  adjustArea.addEventListener("touchcancel", () => {
    touchMode = null;
    lastErasePoint = null;
    if (isEraserActive) $("#eraserCursor")?.classList.add("hidden");
  });

  adjustArea.addEventListener("mousedown", e => {
    if (isEraserActive && currentLayer === "illust") {
      if (adjust.src) {
        const sctx = adjust.src.getContext("2d");
        eraserUndoStack.push(sctx.getImageData(0, 0, adjust.src.width, adjust.src.height));
        if (eraserUndoStack.length > 10) eraserUndoStack.shift();
        updateEraserUI();
      }
      const rect = preview.getBoundingClientRect();
      const sf = preview.width / rect.width;
      lastErasePoint = { x: (e.clientX - rect.left) * sf, y: (e.clientY - rect.top) * sf };
      eraseAtCoords(lastErasePoint, null);
      updateIllustCache();
      renderPreview();
    }
  });
  adjustArea.addEventListener("mousemove", e => {
    if (isEraserActive && currentLayer === "illust" && lastErasePoint) {
      const rect = preview.getBoundingClientRect();
      const sf = preview.width / rect.width;
      const currentP = { x: (e.clientX - rect.left) * sf, y: (e.clientY - rect.top) * sf };
      eraseAtCoords(lastErasePoint, currentP);
      lastErasePoint = currentP;
      updateIllustCache();
      renderPreview();
    }
  });
  adjustArea.addEventListener("mouseup", () => { lastErasePoint = null; });

  function switchLayer(layerId) {
    currentLayer = layerId;
    if (currentLayer !== "illust" && isEraserActive) setEraserMode(false);

    document.querySelectorAll(".layerTabBar .tabBtn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.layer === layerId);
    });

    const tagEl = $("#activeLayerTag");
    if (layerId === "illust") tagEl.textContent = "🎨 イラスト編集中";
    else if (layerId === "text") tagEl.textContent = "💬 文字編集中";
    else if (layerId === "bg") tagEl.textContent = "🖼 背景編集中";

    $("#shortcutsIllust").classList.toggle("hidden", layerId !== "illust");
    $("#shortcutsText").classList.toggle("hidden", layerId !== "text");
    $("#shortcutsBg").classList.toggle("hidden", layerId !== "bg");

    document.querySelectorAll(".layerPanel").forEach(p => {
      p.classList.toggle("active", p.id === `panel-${layerId}`);
    });

    syncCommonScaleSlider();
  }

  document.querySelectorAll(".layerTabBar .tabBtn").forEach(btn => {
    btn.onclick = () => switchLayer(btn.dataset.layer);
  });

  function syncCommonScaleSlider() {
    const slider = $("#commonScaleSlider");
    const label = $("#transformScaleLabel");
    const val = $("#commonScaleVal");
    const unit = $("#commonScaleUnit");
    const isEmoji = (mode === "emoji");

    const rotSlider = $("#commonRotationSlider");
    const rotVal = $("#commonRotationVal");

    let currentRot = 0;

    if (currentLayer === "illust") {
      slider.min = 40; slider.max = 300;
      slider.value = Math.round(adjust.scale * 100);
      label.textContent = "大きさ：";
      val.textContent = slider.value; unit.textContent = "%";
      currentRot = adjust.rotation;
    } else if (currentLayer === "text") {
      slider.min = isEmoji ? 10 : 16;
      slider.max = isEmoji ? 48 : 76;
      slider.value = textConfig.size;
      label.textContent = "大きさ：";
      val.textContent = slider.value; unit.textContent = "px";
      currentRot = textConfig.rotation;
    } else if (currentLayer === "bg") {
      slider.min = 20; slider.max = 300;
      slider.value = Math.round(bgConfig.scale * 100);
      label.textContent = "大きさ：";
      val.textContent = slider.value; unit.textContent = "%";
      currentRot = bgConfig.rotation;
    }

    const deg = Math.round(currentRot * (180 / Math.PI));
    rotSlider.value = deg;
    rotVal.textContent = deg;
  }

  $("#commonScaleSlider").oninput = e => {
    const v = Number(e.target.value);
    $("#commonScaleVal").textContent = v;
    if (currentLayer === "illust") {
      const oldScale = adjust.scale;
      const newScale = v / 100;
      const cx = preview.width / 2, cy = preview.height / 2;
      adjust.ox = cx - (cx - adjust.ox) * (newScale / oldScale);
      adjust.oy = cy - (cy - adjust.oy) * (newScale / oldScale);
      adjust.scale = newScale;
    } else if (currentLayer === "text") {
      textConfig.size = v;
    } else if (currentLayer === "bg") {
      bgConfig.scale = v / 100;
    }
    renderPreview();
  };

  $("#commonRotationSlider").oninput = e => {
    const deg = Number(e.target.value);
    $("#commonRotationVal").textContent = deg;
    const rad = deg * (Math.PI / 180);

    if (currentLayer === "illust") {
      adjust.rotation = rad;
    } else if (currentLayer === "text") {
      textConfig.rotation = rad;
    } else if (currentLayer === "bg") {
      bgConfig.rotation = rad;
    }
    renderPreview();
  };

  function nudgeCurrentLayer(dx, dy) {
    if (currentLayer === "illust") { adjust.ox += dx; adjust.oy += dy; }
    else if (currentLayer === "text") { textConfig.ox += dx; textConfig.oy += dy; }
    else if (currentLayer === "bg") { bgConfig.ox += dx; bgConfig.oy += dy; }
    renderPreview();
  }

  $("#ctrlUp").onclick = () => nudgeCurrentLayer(0, -6);
  $("#ctrlDown").onclick = () => nudgeCurrentLayer(0, 6);
  $("#ctrlLeft").onclick = () => nudgeCurrentLayer(-6, 0);
  $("#ctrlRight").onclick = () => nudgeCurrentLayer(6, 0);

  $("#ctrlCenter").onclick = () => {
    if (currentLayer === "illust") centerIllust();
    else if (currentLayer === "text") textConfig.ox = preview.width / 2;
    else if (currentLayer === "bg") { bgConfig.ox = 0; bgConfig.oy = 0; }
    renderPreview();
  };

  $("#centerIllustBtn").onclick = () => { centerIllust(); renderPreview(); };
  $("#fitWidth").onclick = () => { adjust.scale = preview.width / adjust.src.width; centerIllust(); syncCommonScaleSlider(); renderPreview(); };

  $("#textPosTop").onclick = () => {
    textConfig.ox = preview.width / 2;
    textConfig.oy = (mode === "emoji") ? 22 : 34;
    renderPreview();
  };
  $("#textPosBottom").onclick = () => {
    textConfig.ox = preview.width / 2;
    textConfig.oy = (mode === "emoji") ? preview.height - 24 : preview.height - 40;
    renderPreview();
  };

  $("#bgCenterBtn").onclick = () => { bgConfig.ox = 0; bgConfig.oy = 0; renderPreview(); };
  $("#bgFitFull").onclick = () => { bgConfig.style = "full"; bgConfig.ox = 0; bgConfig.oy = 0; bgConfig.scale = 1; updateBgUI(); syncCommonScaleSlider(); renderPreview(); };

  $("#toggleOrderDrawer").onclick = () => { $("#layerOrderDrawer").classList.toggle("hidden"); };
  $("#closeOrderDrawer").onclick = () => { $("#layerOrderDrawer").classList.add("hidden"); };

  function moveLayer(layerId, dir) {
    const idx = layerOrder.indexOf(layerId);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= layerOrder.length) return;
    const temp = layerOrder[idx];
    layerOrder[idx] = layerOrder[newIdx];
    layerOrder[newIdx] = temp;
    updateLayerListUI();
    renderPreview();
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
        badge.classList.remove("bg-red-500", "bg-blue-500", "bg-purple-500");
        if (idx === 0) { badge.textContent = "第3層"; badge.classList.add("bg-red-500"); }
        else if (idx === 1) { badge.textContent = "第2層"; badge.classList.add("bg-blue-500"); }
        else { badge.textContent = "第1層"; badge.classList.add("bg-purple-500"); }
      }
      if (upBtn) upBtn.disabled = (idx === 0);
      if (downBtn) downBtn.disabled = (idx === layerOrder.length - 1);
    });
    updateLayerStatus();
  }

  function updateLayerStatus() {
    const txt = textConfig.text.trim();
    if (txt) {
      $("#stateText").textContent = `"${txt.slice(0, 6)}${txt.length > 6 ? '…' : ''}"`;
    } else {
      $("#stateText").textContent = "無選択";
    }

    let stIllust = "標準";
    if (bgTransparent && illustBorder) stIllust = "透過+フチ";
    else if (bgTransparent) stIllust = "透過ON";
    $("#stateIllust").textContent = stIllust;

    if (bgConfig.style === "none") $("#stateBg").textContent = "背景なし";
    else if (bgConfig.style === "image") $("#stateBg").textContent = "写真";
    else if (bgConfig.style === "circle") $("#stateBg").textContent = "まる型";
    else if (bgConfig.style === "roundRect") $("#stateBg").textContent = "角丸";
    else if (bgConfig.style === "full") $("#stateBg").textContent = "全面";
  }

  function updateIllustCache() {
    if (!adjust.src) return;
    if (!bgTransparent) { adjust.processedSrc = adjust.src; return; }
    let c = removeBackground(adjust.src, bgTolerance, protectWhite);
    if (illustBorder) {
      const px = Number($("#borderWidth").value);
      c = addIllustBorder(c, px, illustBorderColor);
    }
    adjust.processedSrc = c;
  }

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
    if (bgConfig.style === "none") return;
    ctx.save();
    const cx = w / 2 + bgConfig.ox, cy = h / 2 + bgConfig.oy;
    ctx.translate(cx, cy);
    ctx.rotate(bgConfig.rotation);

    if (bgConfig.style === "image") {
      if (bgConfig.image) {
        const imgW = bgConfig.image.width, imgH = bgConfig.image.height;
        let baseW = w, baseH = h;
        const canvasRatio = w / h, imgRatio = imgW / imgH;
        if (imgRatio > canvasRatio) { baseH = h; baseW = h * imgRatio; }
        else { baseW = w; baseH = w / imgRatio; }
        const drawW = baseW * bgConfig.scale, drawH = baseH * bgConfig.scale;
        ctx.drawImage(bgConfig.image, -drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.restore();
      return;
    }
    if (!bgConfig.color || bgConfig.color === "transparent") { ctx.restore(); return; }
    ctx.fillStyle = bgConfig.color;
    const pw = w * 0.85 * bgConfig.scale, ph = h * 0.85 * bgConfig.scale;
    if (bgConfig.style === "full") {
      ctx.fillRect(-(w * bgConfig.scale) / 2, -(h * bgConfig.scale) / 2, w * bgConfig.scale, h * bgConfig.scale);
    } else if (bgConfig.style === "circle") {
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, Math.min(pw, ph) / 2), 0, Math.PI * 2); ctx.fill();
    } else if (bgConfig.style === "roundRect") {
      drawRoundedRect(ctx, -pw / 2, -ph / 2, pw, ph, Math.min(pw, ph) * 0.15); ctx.fill();
    }
    ctx.restore();
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawIllustLayer(ctx, w, h) {
    const src = adjust.processedSrc || adjust.src;
    if (!src) return;
    const iw = w * adjust.scale;
    const ih = (w * adjust.scale / adjust.src.width) * adjust.src.height;

    ctx.save();
    ctx.translate(adjust.ox + iw / 2, adjust.oy + ih / 2);
    ctx.rotate(adjust.rotation);
    ctx.drawImage(src, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  function drawTextLayer(ctx, w, h) {
    if (textConfig.text.trim() === "") return;
    const txt = textConfig.text, size = textConfig.size;
    ctx.save();
    ctx.translate(textConfig.ox, textConfig.oy);
    ctx.rotate(textConfig.rotation);

    ctx.font = `900 ${size}px ${textConfig.font}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lines = txt.split("\n");
    const lineHeight = size * 1.18;
    lines.forEach((line, i) => {
      const y = -((lines.length - 1) * lineHeight) / 2 + i * lineHeight;
      if (textConfig.stroke !== "none") {
        ctx.strokeStyle = textConfig.stroke;
        ctx.lineWidth = Math.max(5, size * 0.22);
        ctx.lineJoin = "round"; ctx.miterLimit = 2;
        ctx.strokeText(line, 0, y);
      }
      ctx.fillStyle = textConfig.color;
      ctx.fillText(line, 0, y);
    });
    ctx.restore();
  }

  $("#protectWhiteToggle").onchange = e => {
    protectWhite = e.target.checked;
    updateIllustCache(); renderPreview();
  };

  $("#bgToleranceSlider").oninput = e => {
    bgTolerance = Number(e.target.value);
    $("#bgToleranceVal").textContent = e.target.value;
    updateIllustCache(); renderPreview();
  };

  $("#illustBorderToggle").onchange = e => {
    illustBorder = e.target.checked;
    if (illustBorder && !bgTransparent) { bgTransparent = true; }
    $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
    updateIllustCache(); renderPreview();
  };

  $("#borderWidth").oninput = e => {
    $("#borderWidthValue").textContent = e.target.value;
    if (illustBorder && bgTransparent) { updateIllustCache(); renderPreview(); }
  };

  document.querySelectorAll("#illustBorderColorList .cBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      illustBorderColor = btn.dataset.color;
      $("#illustBorderColorPicker").value = illustBorderColor;
      updateIllustCache(); renderPreview();
    };
  });

  $("#illustBorderColorPicker").oninput = e => {
    document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
    illustBorderColor = e.target.value;
    updateIllustCache(); renderPreview();
  };

  $("#stampText").oninput = e => { textConfig.text = e.target.value; renderPreview(); };
  $("#clearTextBtn").onclick = () => { $("#stampText").value = ""; textConfig.text = ""; renderPreview(); };
  document.querySelectorAll(".quickWords .qBtn").forEach(btn => {
    btn.onclick = () => { $("#stampText").value = btn.textContent; textConfig.text = btn.textContent; renderPreview(); };
  });
  $("#textFont").onchange = e => { textConfig.font = e.target.value; renderPreview(); };

  document.querySelectorAll("#textColorList .cBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active"); textConfig.color = btn.dataset.color;
      $("#textColorPicker").value = textConfig.color; renderPreview();
    };
  });
  $("#textColorPicker").oninput = e => {
    document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
    textConfig.color = e.target.value; renderPreview();
  };
  document.querySelectorAll("#textStrokeList .sBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#textStrokeList .sBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active"); textConfig.stroke = btn.dataset.stroke; renderPreview();
    };
  });

  function updateBgUI() {
    const style = bgConfig.style;
    const isNone = (style === "none"), isImg = (style === "image");
    document.querySelectorAll(".bgStyleCard").forEach(card => card.classList.toggle("active", card.dataset.style === style));
    $("#bgNoneNotice").classList.toggle("hidden", !isNone);
    $("#bgImageControls").classList.toggle("hidden", !isImg);
    $("#bgColorControls").classList.toggle("hidden", isNone || isImg);
    $("#bgImageStatus").classList.toggle("hidden", !(isImg && bgConfig.image));

    document.querySelectorAll("#bgColorList .cBtn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.bg && btn.dataset.bg.toLowerCase() === bgConfig.color.toLowerCase());
    });
  }

  document.querySelectorAll(".bgStyleCard").forEach(card => {
    card.onclick = () => {
      bgConfig.style = card.dataset.style;
      if (bgConfig.style !== "none" && bgConfig.style !== "image" && (!bgConfig.color || bgConfig.color === "transparent")) {
        bgConfig.color = "#fff9db";
      }
      updateBgUI(); syncCommonScaleSlider(); renderPreview();
    };
  });

  $("#bgFileInput").onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      bgConfig.image = im; bgConfig.style = "image";
      updateBgUI(); syncCommonScaleSlider(); renderPreview();
      toast("背景写真を取り込みました！");
    };
    im.src = URL.createObjectURL(f);
  };

  $("#removeBgImgBtn").onclick = () => {
    bgConfig.image = null; bgConfig.style = "none";
    $("#bgFileInput").value = "";
    updateBgUI(); syncCommonScaleSlider(); renderPreview();
  };

  document.querySelectorAll("#bgColorList .cBtn").forEach(btn => {
    btn.onclick = () => { bgConfig.color = btn.dataset.bg; updateBgUI(); renderPreview(); };
  });
  $("#bgColorPicker").oninput = e => {
    bgConfig.color = e.target.value; updateBgUI(); renderPreview();
  };

  function removeBackground(src, tolerance = 22, protect = true) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const x = c.getContext("2d");
    x.drawImage(src, 0, 0);
    const imgData = x.getImageData(0, 0, c.width, c.height);
    const a = imgData.data, w = c.width, h = c.height, total = w * h;

    const sampleCorners = [0, w - 1, (h - 1) * w, total - 1];
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let cp of sampleCorners) {
      if (a[cp * 4 + 3] > 10) { sumR += a[cp * 4]; sumG += a[cp * 4 + 1]; sumB += a[cp * 4 + 2]; count++; }
    }
    const bgR = count ? Math.round(sumR / count) : 255;
    const bgG = count ? Math.round(sumG / count) : 255;
    const bgB = count ? Math.round(sumB / count) : 255;

    const isLine = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      const idx = p * 4;
      if (a[idx + 3] < 10) continue;
      if (Math.max(Math.abs(a[idx] - bgR), Math.abs(a[idx + 1] - bgG), Math.abs(a[idx + 2] - bgB)) > tolerance) {
        isLine[p] = 1;
      }
    }

    const wall = new Uint8Array(total);
    if (protect) {
      for (let y = 0; y < h; y++) {
        for (let xx = 0; xx < w; xx++) {
          const p = y * w + xx;
          if (isLine[p]) {
            wall[p] = 1;
            if (xx > 0) wall[p - 1] = 1;
            if (xx < w - 1) wall[p + 1] = 1;
            if (y > 0) wall[p - w] = 1;
            if (y < h - 1) wall[p + w] = 1;
          }
        }
      }
    } else { wall.set(isLine); }

    const visited = new Uint8Array(total);
    const q = new Int32Array(total);
    let head = 0, tail = 0;
    for (let xx = 0; xx < w; xx++) {
      if (!visited[xx] && !wall[xx]) { visited[xx] = 1; q[tail++] = xx; }
      const botP = (h - 1) * w + xx;
      if (!visited[botP] && !wall[botP]) { visited[botP] = 1; q[tail++] = botP; }
    }
    for (let yy = 0; yy < h; yy++) {
      const leftP = yy * w;
      if (!visited[leftP] && !wall[leftP]) { visited[leftP] = 1; q[tail++] = leftP; }
      const rightP = yy * w + w - 1;
      if (!visited[rightP] && !wall[rightP]) { visited[rightP] = 1; q[tail++] = rightP; }
    }

    while (head < tail) {
      const p = q[head++];
      const xx = p % w, yy = (p / w) | 0;
      if (xx > 0 && !visited[p - 1] && !wall[p - 1]) { visited[p - 1] = 1; q[tail++] = p - 1; }
      if (xx < w - 1 && !visited[p + 1] && !wall[p + 1]) { visited[p + 1] = 1; q[tail++] = p + 1; }
      if (yy > 0 && !visited[p - w] && !wall[p - w]) { visited[p - w] = 1; q[tail++] = p - w; }
      if (yy < h - 1 && !visited[p + w] && !wall[p + w]) { visited[p + w] = 1; q[tail++] = p + w; }
    }

    for (let p = 0; p < total; p++) {
      if (visited[p]) a[p * 4 + 3] = 0;
    }
    x.putImageData(imgData, 0, 0);
    return c;
  }

  function addIllustBorder(src, px, color = "#ffffff") {
    const margin = px + 2;
    const c = document.createElement("canvas");
    c.width = src.width + margin * 2; c.height = src.height + margin * 2;
    const ctx = c.getContext("2d");
    const mask = document.createElement("canvas");
    mask.width = c.width; mask.height = c.height;
    const mctx = mask.getContext("2d");
    mctx.drawImage(src, margin, margin);
    mctx.globalCompositeOperation = "source-in";
    mctx.fillStyle = color; mctx.fillRect(0, 0, mask.width, mask.height);

    const r = Math.max(1, px);
    const steps = Math.max(16, Math.min(36, r * 4));
    for (let i = 0; i < steps; i++) {
      const angle = (i * 2 * Math.PI) / steps;
      ctx.drawImage(mask, Math.cos(angle) * r, Math.sin(angle) * r);
    }
    ctx.drawImage(mask, 0, 0);
    ctx.drawImage(src, margin, margin);
    return c;
  }

  async function getFinalCanvas() {
    await document.fonts.ready;
    const c = document.createElement("canvas");
    c.width = SPEC[mode].w; c.height = SPEC[mode].h;
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
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  $("#save").onclick = async () => {
    if (editingIndex === null && results.length >= Number($("#count").value)) {
      toast("指定個数に達しています"); return;
    }
    const c = await getFinalCanvas();
    c.toBlob(blob => {
      const savedState = {
        adjust: { src: adjust.src, scale: adjust.scale, ox: adjust.ox, oy: adjust.oy, rotation: adjust.rotation },
        textConfig: JSON.parse(JSON.stringify(textConfig)),
        bgConfig: { style: bgConfig.style, color: bgConfig.color, image: bgConfig.image, scale: bgConfig.scale, ox: bgConfig.ox, oy: bgConfig.oy, rotation: bgConfig.rotation },
        layerOrder: [...layerOrder],
        bgTransparent, bgTolerance, protectWhite, illustBorder, illustBorderColor,
        borderWidth: Number($("#borderWidth").value)
      };

      if (editingIndex !== null) {
        results[editingIndex] = { blob, url: URL.createObjectURL(blob), name: `${mode}_${String(editingIndex + 1).padStart(2, "0")}.png`, state: savedState };
        editingIndex = null;
        refresh();
        $("#adjustStep").classList.add("hidden"); $("#sheetStep").classList.remove("hidden");
        resetSelection(); toast("上書き保存しました！");
      } else {
        const n = results.length + 1;
        results.push({ blob, url: URL.createObjectURL(blob), name: `${mode}_${String(n).padStart(2, "0")}.png`, state: savedState });
        refresh();
        $("#adjustStep").classList.add("hidden"); $("#sheetStep").classList.remove("hidden");
        resetSelection(); toast(`${n}個目を保存しました！`);
      }
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
      d.onclick = () => showImageModal(r, i);
      $("#thumbs").appendChild(d);
    });
    $("#checks").innerHTML = `<div class="ok">✅ 順調に作成中です（タップして再編集可能）</div>`;
  }

  function showImageModal(item, index) {
    currentModalIndex = index;
    $("#modalTitle").textContent = `${index + 1}個目のスタンプ`;
    $("#modalImg").src = item.url;
    $("#imageModal").classList.add("show");
  }

  $("#modalClose").onclick = () => $("#imageModal").classList.remove("show");

  $("#modalEditBtn").onclick = () => {
    if (currentModalIndex === null || !results[currentModalIndex]) return;
    const item = results[currentModalIndex];
    $("#imageModal").classList.remove("show");
    if (!item.state) { toast("編集画面のデータがありません"); return; }
    editingIndex = currentModalIndex;
    openAdjustForEdit(item.state);
  };

  $("#modalDeleteBtn").onclick = () => {
    if (currentModalIndex === null || !results[currentModalIndex]) return;
    if (confirm(`${currentModalIndex + 1}個目を削除しますか？`)) {
      results.splice(currentModalIndex, 1);
      $("#imageModal").classList.remove("show");
      refresh(); toast("削除しました");
    }
  };

  $("#zip").onclick = async () => {
    if (!window.JSZip) { toast("ZIP機能の読み込みに失敗しました"); return; }
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
    if ($("#adjustStep").classList.contains("hidden") === false) renderPreview();
  });

  updateMode();
});
