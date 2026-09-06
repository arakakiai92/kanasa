document.addEventListener("DOMContentLoaded", () => {
  const $ = s => document.querySelector(s);
  const stage = $("#stage"), sctx = stage ? stage.getContext("2d") : null;
  const preview = $("#preview"), pctx = preview ? preview.getContext("2d") : null;
  const wrap = $("#stageWrap"), crop = $("#cropBox");
  const adjustArea = $("#adjustArea");

  let mode = "sticker";
  let userInteractedMode = false;
  let img = null;

  let selectionRect = null;
  let selection = null;
  let loadMethod = "sheet";
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

  let adjust = { rawSrc: null, src: null, processedSrc: null, scale: 1, ox: 0, oy: 0, rotation: 0 };
  let bgTransparent = true;
  let bgTolerance = 22;
  let protectWhite = true;
  let gapProtectLevel = 2;
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
  let eraserToolMode = "repair";
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

  // ==========================================
  // IndexedDB 自動保存・復元
  // ==========================================
  const DB_NAME = "StampEmojiMaker_DB";
  const STORE_NAME = "autoSaveStore";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function saveToDB(key, val) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("AutoSave failed:", e);
    }
  }

  async function loadFromDB(key) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }

  async function clearDB() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
    } catch (e) {}
  }

  let autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(triggerAutoSave, 600);
  }

  async function triggerAutoSave() {
    if (!img && results.length === 0) return;
    try {
      const serializedResults = results.map(r => ({
        name: r.name,
        blob: r.blob,
        state: {
          adjust: {
            srcData: r.state.adjust.src ? r.state.adjust.src.toDataURL("image/png") : null,
            rawSrcData: r.state.adjust.rawSrc ? r.state.adjust.rawSrc.toDataURL("image/png") : null,
            scale: r.state.adjust.scale,
            ox: r.state.adjust.ox,
            oy: r.state.adjust.oy,
            rotation: r.state.adjust.rotation
          },
          textConfig: r.state.textConfig,
          bgConfig: {
            ...r.state.bgConfig,
            imageData: r.state.bgConfig.image ? r.state.bgConfig.image.src : null
          },
          layerOrder: r.state.layerOrder,
          bgTransparent: r.state.bgTransparent,
          bgTolerance: r.state.bgTolerance,
          protectWhite: r.state.protectWhite,
          gapProtectLevel: r.state.gapProtectLevel || 2,
          illustBorder: r.state.illustBorder,
          illustBorderColor: r.state.illustBorderColor,
          borderWidth: r.state.borderWidth
        }
      }));

      const isAdjustOpen = $("#adjustStep") && !$("#adjustStep").classList.contains("hidden");
      const currentState = {
        mode,
        loadMethod,
        count: $("#count") ? $("#count").value : "16",
        imgSrc: img ? img.src : null,
        selectionRect,
        results: serializedResults,
        editingIndex,
        isAdjustOpen,
        currentAdjust: isAdjustOpen ? {
          srcData: adjust.src ? adjust.src.toDataURL("image/png") : null,
          rawSrcData: adjust.rawSrc ? adjust.rawSrc.toDataURL("image/png") : null,
          scale: adjust.scale,
          ox: adjust.ox,
          oy: adjust.oy,
          rotation: adjust.rotation,
          bgTransparent,
          bgTolerance,
          protectWhite,
          gapProtectLevel,
          illustBorder,
          illustBorderColor,
          borderWidth: $("#borderWidth") ? Number($("#borderWidth").value) : 6,
          textConfig,
          bgConfig: {
            ...bgConfig,
            imageData: bgConfig.image ? bgConfig.image.src : null
          },
          layerOrder
        } : null
      };

      await saveToDB("app_state", currentState);
    } catch (err) {
      console.warn("Failed auto saving state:", err);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") triggerAutoSave();
  });
  window.addEventListener("pagehide", triggerAutoSave);

  async function restoreSavedSession() {
    const data = await loadFromDB("app_state");
    if (!data || (!data.imgSrc && (!data.results || data.results.length === 0))) return;

    try {
      if (!userInteractedMode) {
        mode = data.mode || "sticker";
      }
      loadMethod = data.loadMethod || "sheet";
      if ($("#count")) $("#count").value = data.count || "16";
      updateMode();

      if (data.results && data.results.length > 0) {
        results = [];
        for (let r of data.results) {
          const itemSrcCanvas = await dataUrlToCanvas(r.state.adjust.srcData);
          const itemRawCanvas = r.state.adjust.rawSrcData ? await dataUrlToCanvas(r.state.adjust.rawSrcData) : itemSrcCanvas;
          let bgImg = null;
          if (r.state.bgConfig && r.state.bgConfig.imageData) {
            bgImg = await loadImageAsync(r.state.bgConfig.imageData);
          }
          results.push({
            name: r.name,
            blob: r.blob,
            url: URL.createObjectURL(r.blob),
            state: {
              ...r.state,
              adjust: {
                ...r.state.adjust,
                src: itemSrcCanvas,
                rawSrc: itemRawCanvas
              },
              bgConfig: {
                ...r.state.bgConfig,
                image: bgImg
              }
            }
          });
        }
        refresh();
      }

      if (data.imgSrc) {
        const im = await loadImageAsync(data.imgSrc);
        img = im;
        setupCanvas();
        renderSheet();

        if (data.selectionRect) {
          selectionRect = data.selectionRect;
          renderCropBox();
        }

        if (data.isAdjustOpen && data.currentAdjust) {
          const cur = data.currentAdjust;
          const curSrc = await dataUrlToCanvas(cur.srcData);
          const curRaw = cur.rawSrcData ? await dataUrlToCanvas(cur.rawSrcData) : curSrc;
          let curBgImg = null;
          if (cur.bgConfig && cur.bgConfig.imageData) {
            curBgImg = await loadImageAsync(cur.bgConfig.imageData);
          }
          editingIndex = data.editingIndex;
          openAdjustForEdit({
            adjust: { ...cur, src: curSrc, rawSrc: curRaw },
            textConfig: cur.textConfig,
            bgConfig: { ...cur.bgConfig, image: curBgImg },
            layerOrder: cur.layerOrder,
            bgTransparent: cur.bgTransparent !== undefined ? cur.bgTransparent : true,
            bgTolerance: cur.bgTolerance || 22,
            protectWhite: cur.protectWhite !== undefined ? cur.protectWhite : true,
            gapProtectLevel: cur.gapProtectLevel || 2,
            illustBorder: cur.illustBorder,
            illustBorderColor: cur.illustBorderColor,
            borderWidth: cur.borderWidth || 6
          });
        } else {
          if ($("#sheetStep")) $("#sheetStep").classList.toggle("hidden", loadMethod === "single");
          if ($("#adjustStep")) $("#adjustStep").classList.add("hidden");
        }
        toast("前回の作業状態を復元しました！");
      }
    } catch (e) {
      console.error("Restore failed:", e);
    }
  }

  function loadImageAsync(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = src;
    });
  }

  function dataUrlToCanvas(dataUrl) {
    return new Promise(resolve => {
      if (!dataUrl) { resolve(null); return; }
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas");
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        c.getContext("2d").drawImage(im, 0, 0);
        resolve(c);
      };
      im.onerror = () => resolve(null);
      im.src = dataUrl;
    });
  }

  const resetAllBtn = $("#resetAllBtn");
  if (resetAllBtn) {
    resetAllBtn.onclick = async () => {
      if (confirm("作業中のすべてのデータを初期化して最初からやり直しますか？")) {
        await clearDB();
        location.reload();
      }
    };
  }

  // ==========================================
  // モード管理
  // ==========================================
  function syncAdjustAreaRatio() {
    const area = $("#adjustArea");
    if (!area) return;
    area.dataset.mode = mode;
    if (mode === "emoji") {
      area.style.aspectRatio = "1 / 1";
      area.style.maxWidth = "min(100%, 40vh)";
    } else {
      area.style.aspectRatio = "370 / 320";
      area.style.maxWidth = "min(100%, calc(40vh * (370 / 320)))";
    }
  }

  function updateMode() {
    const s = SPEC[mode];
    if ($("#spec")) $("#spec").textContent = `切り抜き比率：${mode === "sticker" ? "370 : 320" : "1 : 1"} ／ 書き出し：${s.label}`;
    if ($("#total") && $("#count")) $("#total").textContent = $("#count").value;
    
    const bSticker = $("#modeSticker");
    const bEmoji = $("#modeEmoji");

    if (bSticker && bEmoji) {
      if (mode === "sticker") {
        bSticker.className = "flex-1 py-2.5 text-xs md:text-sm font-bold rounded-lg transition bg-white shadow-sm text-gray-800";
        bEmoji.className = "flex-1 py-2.5 text-xs md:text-sm font-bold rounded-lg transition text-gray-500 hover:text-gray-800";
      } else {
        bSticker.className = "flex-1 py-2.5 text-xs md:text-sm font-bold rounded-lg transition text-gray-500 hover:text-gray-800";
        bEmoji.className = "flex-1 py-2.5 text-xs md:text-sm font-bold rounded-lg transition bg-white shadow-sm text-purple-700";
      }
    }

    syncAdjustAreaRatio();
    if (img) initOrAdjustSelection();
    scheduleAutoSave();
  }

  function setMode(newMode) {
    userInteractedMode = true;
    mode = newMode;
    updateMode();
    toast(mode === "emoji" ? "🟣 絵文字モードにしました（1:1）" : "🟢 スタンプモードにしました（370:320）");
  }

  const btnSticker = $("#modeSticker");
  const btnEmoji = $("#modeEmoji");
  if (btnSticker) btnSticker.onclick = (e) => { e.preventDefault(); setMode("sticker"); };
  if (btnEmoji) btnEmoji.onclick = (e) => { e.preventDefault(); setMode("emoji"); };

  if ($("#count")) {
    $("#count").onchange = () => {
      if ($("#total")) $("#total").textContent = $("#count").value;
      scheduleAutoSave();
    };
  }

  function resetSelection() {
    selectionRect = null;
    selection = null;
    if (crop) crop.classList.add("hidden");
    if ($("#cropFineTune")) $("#cropFineTune").classList.add("hidden");
    if ($("#resetCrop")) $("#resetCrop").classList.add("hidden");
    if ($("#reDrawBtn")) $("#reDrawBtn").classList.add("hidden");
    if ($("#adjustBtn")) $("#adjustBtn").classList.add("hidden");
    if ($("#startSelect")) $("#startSelect").classList.remove("hidden");
  }

  if ($("#uploadSheetBtn")) {
    $("#uploadSheetBtn").onclick = (e) => {
      e.preventDefault();
      loadMethod = "sheet";
      if ($("#file")) $("#file").click();
    };
  }
  if ($("#uploadSingleBtn")) {
    $("#uploadSingleBtn").onclick = (e) => {
      e.preventDefault();
      loadMethod = "single";
      if ($("#file")) $("#file").click();
    };
  }

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

          if (loadMethod === "single") {
            selectionRect = null;
            selection = { x: 0, y: 0, w: im.naturalWidth || im.width, h: im.naturalHeight || im.height };
            if ($("#sheetStep")) $("#sheetStep").classList.add("hidden");
            openAdjustNew();
            fitIllustToCanvas();
            toast("イラストを読み込みました！このまま編集できます");
            triggerAutoSave();
            fileInput.value = "";
            return;
          }

          if ($("#sheetStep")) $("#sheetStep").classList.remove("hidden");
          if ($("#adjustStep")) $("#adjustStep").classList.add("hidden");
          setupCanvas();
          renderSheet();

          initOrAdjustSelection();
          refresh();

          setTimeout(() => {
            const step = $("#sheetStep");
            if (step) step.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);

          toast("シートを読み込みました！枠を合わせて「次へ」を押してね");
          triggerAutoSave();
          fileInput.value = "";
        };
        im.onerror = () => toast("画像の読み込みに失敗しました。");
        im.src = event.target.result;
      };
      reader.readAsDataURL(f);
    };
  }

  // ==========================================
  // 切り出し画面：Canvasと枠の絶対一致制御
  // ==========================================
  function setupCanvas() {
    if (!stage || !img) return;
    stage.width = img.naturalWidth;
    stage.height = img.naturalHeight;

    // CSSのレターボックスによるズレを完全に防ぐためスタイルを直接制御
    stage.style.display = "block";
    stage.style.maxWidth = "100%";
    stage.style.maxHeight = "56vh";
    stage.style.width = "auto";
    stage.style.height = "auto";
    stage.style.margin = "0 auto";

    // 親のwrapもCanvasの描画矩形に強制同期
    if (wrap) {
      wrap.style.display = "inline-block";
      wrap.style.position = "relative";
      wrap.style.lineHeight = "0";
      const outer = wrap.parentElement;
      if (outer) {
        outer.style.textAlign = "center";
      }
    }
  }

  function renderSheet() {
    if (!sctx || !img) return;
    sctx.clearRect(0, 0, stage.width, stage.height);
    sctx.drawImage(img, 0, 0, stage.width, stage.height);
  }

  function getStageDisplayMetrics() {
    if (!stage) return { width: 300, height: 300, scaleX: 1, scaleY: 1 };
    const rect = stage.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : (stage.clientWidth || 300);
    const h = rect.height > 0 ? rect.height : (stage.clientHeight || 300);
    const natW = img ? (img.naturalWidth || stage.width) : stage.width;
    const natH = img ? (img.naturalHeight || stage.height) : stage.height;
    return {
      width: w,
      height: h,
      scaleX: natW / w,
      scaleY: natH / h
    };
  }

  function renderCropBox() {
    if (!selectionRect || !stage || !crop) {
      resetSelection();
      if ($("#sheetProgress") && $("#count")) {
        $("#sheetProgress").textContent = `${results.length + 1} / ${$("#count").value}`;
      }
      return;
    }

    const m = getStageDisplayMetrics();

    // Canvas要素と同じ表示サイズになるようwrapのサイズを完全固定
    if (wrap) {
      wrap.style.width = `${Math.round(m.width)}px`;
      wrap.style.height = `${Math.round(m.height)}px`;
    }

    crop.style.left = `${Math.round(selectionRect.x)}px`;
    crop.style.top = `${Math.round(selectionRect.y)}px`;
    crop.style.width = `${Math.round(selectionRect.w)}px`;
    crop.style.height = `${Math.round(selectionRect.h)}px`;
    crop.classList.remove("hidden");

    if ($("#cropFineTune")) $("#cropFineTune").classList.remove("hidden");
    if ($("#resetCrop")) $("#resetCrop").classList.remove("hidden");
    if ($("#reDrawBtn")) $("#reDrawBtn").classList.remove("hidden");
    if ($("#adjustBtn")) $("#adjustBtn").classList.remove("hidden");
    if ($("#startSelect")) $("#startSelect").classList.add("hidden");

    // 画面上の枠ピクセルから、元画像ピクセルへの1対1完全マッピング
    selection = {
      x: Math.max(0, selectionRect.x * m.scaleX),
      y: Math.max(0, selectionRect.y * m.scaleY),
      w: Math.max(10, selectionRect.w * m.scaleX),
      h: Math.max(10, selectionRect.h * m.scaleY)
    };
  }

  function initOrAdjustSelection() {
    if (!img || !stage) return;
    const r = SPEC[mode].ratio;
    const m = getStageDisplayMetrics();
    const w = m.width;
    const h = m.height;

    // 4列シートに合わせた1コマサイズ
    let boxW = w * 0.235;
    let boxH = boxW / r;

    if (boxW < 36) { boxW = 36; boxH = boxW / r; }
    if (boxH > h * 0.4) { boxH = h * 0.4; boxW = boxH * r; }

    const marginX = w * 0.01;
    const marginY = h * 0.01;

    selectionRect = { x: marginX, y: marginY, w: boxW, h: boxH };
    renderCropBox();
    scheduleAutoSave();
  }

  function advanceSelectionSlot(direction = 1) {
    if (!selectionRect || !stage) {
      initOrAdjustSelection();
      return;
    }
    const m = getStageDisplayMetrics();
    const w = m.width, h = m.height;

    const stepX = selectionRect.w * 1.065;
    const stepY = selectionRect.h * 1.135;

    let col = Math.round((selectionRect.x - (w * 0.01)) / stepX);
    let row = Math.round((selectionRect.y - (h * 0.01)) / stepY);

    if (direction > 0) {
      col++;
      if (col >= 4 || (selectionRect.x + stepX + selectionRect.w * 0.8 > w)) {
        col = 0;
        row++;
      }
    } else {
      col--;
      if (col < 0) {
        col = 3;
        row = Math.max(0, row - 1);
      }
    }

    let nx = col * stepX + (w * 0.01);
    let ny = row * stepY + (h * 0.01);

    if (ny + selectionRect.h > h) {
      nx = w * 0.01;
      ny = h * 0.01;
    }

    selectionRect.x = Math.max(0, Math.min(w - selectionRect.w, nx));
    selectionRect.y = Math.max(0, Math.min(h - selectionRect.h, ny));
    renderCropBox();
    scheduleAutoSave();
  }

  if ($("#cropNextSlot")) $("#cropNextSlot").onclick = () => advanceSelectionSlot(1);
  if ($("#cropPrevSlot")) $("#cropPrevSlot").onclick = () => advanceSelectionSlot(-1);

  if ($("#resetCrop")) $("#resetCrop").onclick = () => { initOrAdjustSelection(); toast("枠をコマ1に戻しました"); };
  if ($("#reDrawBtn")) $("#reDrawBtn").onclick = () => { resetSelection(); toast("切り出したい絵を指で囲んでね"); };
  if ($("#startSelect")) $("#startSelect").onclick = () => { initOrAdjustSelection(); toast("切り出し枠を表示しました！"); };

  function getTouchPos(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const w = r.width > 0 ? r.width : 300;
    const h = r.height > 0 ? r.height : 300;
    return {
      x: Math.max(0, Math.min(w, clientX - r.left)),
      y: Math.max(0, Math.min(h, clientY - r.top))
    };
  }

  let cropDrag = null;
  if (wrap) {
    wrap.addEventListener("touchstart", e => {
      if (!img) return;
      const touch = e.touches[0];
      const p = getTouchPos(touch.clientX, touch.clientY);
      const handleEl = e.target.closest(".handle");
      const isInsideCrop = (e.target === crop || (crop && crop.contains(e.target)));

      if (handleEl) {
        e.preventDefault();
        cropDrag = { type: "resize", handle: handleEl.dataset.h, startP: p, orig: { ...selectionRect } };
      } else if (isInsideCrop && selectionRect) {
        e.preventDefault();
        cropDrag = { type: "move", startP: p, orig: { ...selectionRect } };
      } else if (!selectionRect) {
        e.preventDefault();
        cropDrag = { type: "draw", startP: p, orig: null };
      } else {
        cropDrag = null;
      }
    }, { passive: false });

    wrap.addEventListener("touchmove", e => {
      if (!cropDrag) return;
      e.preventDefault();
      const touch = e.touches[0];
      const p = getTouchPos(touch.clientX, touch.clientY);
      const r = SPEC[mode].ratio;
      const m = getStageDisplayMetrics();
      const srW = m.width, srH = m.height;

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

    wrap.addEventListener("touchend", () => { cropDrag = null; scheduleAutoSave(); });
    wrap.addEventListener("touchcancel", () => { cropDrag = null; });

    wrap.addEventListener("mousedown", e => {
      if (!img) return;
      const p = getTouchPos(e.clientX, e.clientY);
      const handleEl = e.target.closest(".handle");
      const isInsideCrop = (e.target === crop || (crop && crop.contains(e.target)));
      if (handleEl) {
        cropDrag = { type: "resize", handle: handleEl.dataset.h, startP: p, orig: { ...selectionRect } };
      } else if (isInsideCrop && selectionRect) {
        cropDrag = { type: "move", startP: p, orig: { ...selectionRect } };
      } else if (!selectionRect) {
        cropDrag = { type: "draw", startP: p, orig: null };
      } else {
        cropDrag = null;
      }
    });

    wrap.addEventListener("mousemove", e => {
      if (!cropDrag) return;
      const p = getTouchPos(e.clientX, e.clientY);
      const r = SPEC[mode].ratio;
      const m = getStageDisplayMetrics();
      const srW = m.width, srH = m.height;

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

    wrap.addEventListener("mouseup", () => { cropDrag = null; scheduleAutoSave(); });
  }

  function nudgeCrop(dx, dy) {
    if (!selectionRect || !stage) return;
    const m = getStageDisplayMetrics();
    selectionRect.x = Math.max(0, Math.min(m.width - selectionRect.w, selectionRect.x + dx));
    selectionRect.y = Math.max(0, Math.min(m.height - selectionRect.h, selectionRect.y + dy));
    renderCropBox();
    scheduleAutoSave();
  }

  function scaleCrop(factor) {
    if (!selectionRect || !stage) return;
    const r = SPEC[mode].ratio;
    const m = getStageDisplayMetrics();
    const cx = selectionRect.x + selectionRect.w / 2;
    const cy = selectionRect.y + selectionRect.h / 2;
    let newW = selectionRect.w * factor;
    let newH = newW / r;
    if (newW < 36) { newW = 36; newH = newW / r; }
    let nx = Math.max(0, Math.min(m.width - newW, cx - newW / 2));
    let ny = Math.max(0, Math.min(m.height - newH, cy - newH / 2));
    selectionRect = { x: nx, y: ny, w: newW, h: newH };
    renderCropBox();
    scheduleAutoSave();
  }

  if ($("#cropUp")) $("#cropUp").onclick = () => nudgeCrop(0, -6);
  if ($("#cropDown")) $("#cropDown").onclick = () => nudgeCrop(0, 6);
  if ($("#cropLeft")) $("#cropLeft").onclick = () => nudgeCrop(-6, 0);
  if ($("#cropRight")) $("#cropRight").onclick = () => nudgeCrop(6, 0);
  if ($("#cropCenter")) $("#cropCenter").onclick = () => {
    if (!selectionRect || !stage) return;
    const m = getStageDisplayMetrics();
    selectionRect.x = (m.width - selectionRect.w) / 2;
    selectionRect.y = (m.height - selectionRect.h) / 2;
    renderCropBox();
    scheduleAutoSave();
  };
  if ($("#cropZoomIn")) $("#cropZoomIn").onclick = () => scaleCrop(1.08);
  if ($("#cropZoomOut")) $("#cropZoomOut").onclick = () => scaleCrop(0.92);

  function goToAdjustStep() {
    if (!img) {
      toast("先にシート画像を選んでね");
      return;
    }
    renderCropBox();
    if (!selection) {
      initOrAdjustSelection();
    }
    editingIndex = null;
    openAdjustNew();
    triggerAutoSave();
  }

  const adjustBtn = $("#adjustBtn");
  if (adjustBtn) {
    adjustBtn.onclick = (e) => {
      e.preventDefault();
      goToAdjustStep();
    };
  }

  const backBtn = $("#back");
  if (backBtn) {
    backBtn.onclick = () => {
      editingIndex = null;
      if ($("#adjustStep")) $("#adjustStep").classList.add("hidden");
      if (loadMethod === "single") {
        img = null;
        selection = null;
        selectionRect = null;
        if ($("#sheetStep")) $("#sheetStep").classList.add("hidden");
        toast("画像をえらぶところに戻りました");
        const mainEl = document.querySelector("main");
        if (mainEl) mainEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        if ($("#sheetStep")) $("#sheetStep").classList.remove("hidden");
      }
      triggerAutoSave();
    };
  }

  function cropFromOriginal(sel) {
    if (!sel || !img) {
      const c = document.createElement("canvas");
      c.width = SPEC[mode].w;
      c.height = SPEC[mode].h;
      return c;
    }
    const natW = img.naturalWidth || img.width || 370;
    const natH = img.naturalHeight || img.height || 320;

    const sx = Math.max(0, Math.min(natW - 1, sel.x || 0));
    const sy = Math.max(0, Math.min(natH - 1, sel.y || 0));
    const sw = Math.max(1, Math.min(natW - sx, sel.w || natW));
    const sh = Math.max(1, Math.min(natH - sy, sel.h || natH));

    const maxDim = (mode === "emoji") ? 360 : 740;
    const scale = Math.min(1.0, maxDim / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const c = document.createElement("canvas");
    c.width = dw;
    c.height = dh;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    return c;
  }

  function cloneCanvas(orig) {
    if (!orig) return null;
    const c = document.createElement("canvas");
    c.width = orig.width;
    c.height = orig.height;
    c.getContext("2d").drawImage(orig, 0, 0);
    return c;
  }

  function openAdjustNew() {
    try {
      renderCropBox();
      syncAdjustAreaRatio();
      const raw = cropFromOriginal(selection);
      const src = cloneCanvas(raw);
      preview.width = SPEC[mode].w;
      preview.height = SPEC[mode].h;

      adjust = { rawSrc: raw, src, processedSrc: null, scale: 1, ox: 0, oy: 0, rotation: 0 };
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
      if ($("#stampText")) $("#stampText").value = "";

      layerOrder = ["illust", "text", "bg"];
      bgTransparent = true;
      bgTolerance = 22;
      protectWhite = true;
      gapProtectLevel = 2;

      if ($("#bgAutoTransparentToggle")) $("#bgAutoTransparentToggle").checked = true;
      if ($("#transSettingsBody")) $("#transSettingsBody").classList.remove("hidden");
      if ($("#bgToleranceSlider")) $("#bgToleranceSlider").value = 22;
      if ($("#bgToleranceVal")) $("#bgToleranceVal").textContent = "22";
      if ($("#protectWhiteToggle")) $("#protectWhiteToggle").checked = true;
      if ($("#gapProtectLevel")) $("#gapProtectLevel").value = "2";

      illustBorder = false;
      illustBorderColor = "#ffffff";
      if ($("#illustBorderToggle")) $("#illustBorderToggle").checked = false;
      if ($("#illustBorderColorWrap")) $("#illustBorderColorWrap").classList.add("hidden");
      if ($("#borderWidth")) $("#borderWidth").value = 6;
      if ($("#borderWidthValue")) $("#borderWidthValue").textContent = "6";

      isEraserActive = false;
      eraserToolMode = "repair";
      updateToolModeUI();
      eraserUndoStack = [];
      lastErasePoint = null;
      updateEraserUI();

      if ($("#save")) $("#save").textContent = "💾 このスタンプを保存する";
      if ($("#saveAndDownload")) {
        const sp = $("#saveAndDownload").querySelector("span");
        if (sp) sp.textContent = "💾 アルバムに追加 ＋ 端末に保存";
        else $("#saveAndDownload").textContent = "💾 アルバムに追加 ＋ 端末に保存";
      }
      if ($("#adjustStepTitle")) $("#adjustStepTitle").textContent = isEmoji ? "絵文字をととのえる" : "スタンプをととのえる";

      if ($("#adjustStep")) $("#adjustStep").classList.remove("hidden");
      if ($("#sheetStep")) $("#sheetStep").classList.add("hidden");

      setTimeout(() => {
        const step = $("#adjustStep");
        if (step) step.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);

      switchLayer("illust");
      updateIllustCache();
      updateLayerListUI();
      updateBgUI();
      renderPreview();
    } catch (err) {
      console.error("openAdjustNew error:", err);
      toast("編集画面の起動に失敗しました: " + err.message);
    }
  }

  function openAdjustForEdit(savedState) {
    try {
      syncAdjustAreaRatio();
      preview.width = SPEC[mode].w;
      preview.height = SPEC[mode].h;

      adjust.src = cloneCanvas(savedState.adjust.src);
      adjust.rawSrc = savedState.adjust.rawSrc ? cloneCanvas(savedState.adjust.rawSrc) : cloneCanvas(savedState.adjust.src);
      adjust.scale = savedState.adjust.scale;
      adjust.ox = savedState.adjust.ox;
      adjust.oy = savedState.adjust.oy;
      adjust.rotation = savedState.adjust.rotation !== undefined ? savedState.adjust.rotation : 0;

      textConfig = { ...savedState.textConfig };
      if (textConfig.rotation === undefined) textConfig.rotation = 0;

      if ($("#stampText")) $("#stampText").value = textConfig.text || "";
      if ($("#textFont")) $("#textFont").value = textConfig.font || "'M PLUS Rounded 1c', sans-serif";
      if ($("#textColorPicker")) $("#textColorPicker").value = (textConfig.color && textConfig.color.startsWith("#")) ? textConfig.color : "#111111";
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
      gapProtectLevel = savedState.gapProtectLevel || 2;
      illustBorder = savedState.illustBorder;
      illustBorderColor = savedState.illustBorderColor || "#ffffff";

      if ($("#bgAutoTransparentToggle")) $("#bgAutoTransparentToggle").checked = bgTransparent;
      if ($("#transSettingsBody")) $("#transSettingsBody").classList.toggle("hidden", !bgTransparent);
      if ($("#bgToleranceSlider")) $("#bgToleranceSlider").value = bgTolerance;
      if ($("#bgToleranceVal")) $("#bgToleranceVal").textContent = bgTolerance;
      if ($("#protectWhiteToggle")) $("#protectWhiteToggle").checked = protectWhite;
      if ($("#gapProtectLevel")) $("#gapProtectLevel").value = String(gapProtectLevel);

      if ($("#illustBorderToggle")) $("#illustBorderToggle").checked = illustBorder;
      if ($("#illustBorderColorWrap")) $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
      if ($("#borderWidth")) $("#borderWidth").value = savedState.borderWidth || 6;
      if ($("#borderWidthValue")) $("#borderWidthValue").textContent = savedState.borderWidth || 6;

      isEraserActive = false;
      eraserToolMode = "repair";
      updateToolModeUI();
      eraserUndoStack = [];
      lastErasePoint = null;
      updateEraserUI();

      if (editingIndex !== null) {
        if ($("#save")) $("#save").textContent = `💾 ${editingIndex + 1}個目を修正して上書き保存`;
        if ($("#saveAndDownload")) {
          const sp = $("#saveAndDownload").querySelector("span");
          if (sp) sp.textContent = `💾 ${editingIndex + 1}個目を更新 ＋ 端末に保存`;
          else $("#saveAndDownload").textContent = `💾 ${editingIndex + 1}個目を更新 ＋ 端末に保存`;
        }
        if ($("#adjustStepTitle")) $("#adjustStepTitle").textContent = `${editingIndex + 1}個目を修正中（上書き保存）`;
      }

      if ($("#adjustStep")) $("#adjustStep").classList.remove("hidden");
      if ($("#sheetStep")) $("#sheetStep").classList.add("hidden");

      switchLayer("illust");
      updateIllustCache();
      updateLayerListUI();
      updateBgUI();
      renderPreview();
    } catch (err) {
      console.error("openAdjustForEdit error:", err);
      toast("再編集画面の起動に失敗しました: " + err.message);
    }
  }

  function centerIllust() {
    const iw = preview.width * adjust.scale;
    const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;
    adjust.ox = (preview.width - iw) / 2;
    adjust.oy = (preview.height - ih) / 2;
  }

  function fitIllustToCanvas() {
    if (!adjust.src) return;
    const fitScale = Math.min(preview.width / adjust.src.width, preview.height / adjust.src.height);
    adjust.scale = Math.max(0.4, Math.min(3.0, fitScale || 1));
    centerIllust();
    syncCommonScaleSlider();
    renderPreview();
  }

  // ==========================================
  // 消しゴム & 復元ペン
  // ==========================================
  function getPreviewPoint(clientX, clientY) {
    const rect = preview.getBoundingClientRect();
    const elemX = clientX - rect.left;
    const elemY = clientY - rect.top;

    const canvasRatio = preview.width / preview.height;
    const elemRatio = rect.width / rect.height;

    let renderW, renderH, offsetX, offsetY;
    if (elemRatio > canvasRatio) {
      renderH = rect.height;
      renderW = rect.height * canvasRatio;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    } else {
      renderW = rect.width;
      renderH = rect.width / canvasRatio;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    }

    const actualX = elemX - offsetX;
    const actualY = elemY - offsetY;

    const px = (actualX / renderW) * preview.width;
    const py = (actualY / renderH) * preview.height;

    return {
      x: px,
      y: py,
      clientX,
      clientY,
      renderScale: renderW / preview.width
    };
  }

  function previewToSrcCoords(px, py) {
    if (!adjust.src) return { sx: 0, sy: 0, ratio: 1 };
    const iw = preview.width * adjust.scale;
    const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;

    const cx = adjust.ox + iw / 2;
    const cy = adjust.oy + ih / 2;

    const dx = px - cx;
    const dy = py - cy;

    const cosR = Math.cos(-adjust.rotation);
    const sinR = Math.sin(-adjust.rotation);

    const rx = dx * cosR - dy * sinR;
    const ry = dx * sinR + dy * cosR;

    const imgX = rx + iw / 2;
    const imgY = ry + ih / 2;

    const ratio = adjust.src.width / iw;
    return { sx: imgX * ratio, sy: imgY * ratio, ratio };
  }

  function setEraserMode(active) {
    isEraserActive = active;
    if ($("#eraserToggleBtn")) {
      $("#eraserToggleBtn").textContent = isEraserActive ? "🧹 ペンツール：ON" : "🧹 消しゴム：OFF";
      $("#eraserToggleBtn").classList.toggle("active", isEraserActive);
    }
    if ($("#eraserOptionsWrap")) {
      $("#eraserOptionsWrap").classList.toggle("hidden", !isEraserActive);
    }
    if (adjustArea) {
      adjustArea.classList.toggle("erasing", isEraserActive);
    }
    if (!isEraserActive && $("#eraserCursor")) {
      $("#eraserCursor").classList.add("hidden");
    }
  }

  function updateToolModeUI() {
    const eraseBtn = $("#toolModeErase");
    const restoreBtn = $("#toolModeRestore");
    const repairBtn = $("#toolModeRepair");
    if (eraseBtn) {
      eraseBtn.classList.toggle("active", eraserToolMode === "erase");
      eraseBtn.classList.toggle("bg-orange-500", eraserToolMode === "erase");
      eraseBtn.classList.toggle("text-white", eraserToolMode === "erase");
      eraseBtn.classList.toggle("text-gray-600", eraserToolMode !== "erase");
    }
    if (restoreBtn) {
      restoreBtn.classList.toggle("active", eraserToolMode === "restore");
      restoreBtn.classList.toggle("bg-blue-600", eraserToolMode === "restore");
      restoreBtn.classList.toggle("text-white", eraserToolMode === "restore");
      restoreBtn.classList.toggle("text-gray-600", eraserToolMode !== "restore");
    }
    if (repairBtn) {
      repairBtn.classList.toggle("active", eraserToolMode === "repair");
      repairBtn.classList.toggle("bg-emerald-500", eraserToolMode === "repair");
      repairBtn.classList.toggle("text-white", eraserToolMode === "repair");
      repairBtn.classList.toggle("text-gray-600", eraserToolMode !== "repair");
    }

    const cursor = $("#eraserCursor");
    if (cursor) {
      if (eraserToolMode === "restore") {
        cursor.style.borderColor = "rgba(37, 99, 235, 0.9)";
        cursor.style.backgroundColor = "rgba(37, 99, 235, 0.2)";
      } else if (eraserToolMode === "repair") {
        cursor.style.borderColor = "rgba(16, 185, 129, 0.9)";
        cursor.style.backgroundColor = "rgba(16, 185, 129, 0.25)";
      } else {
        cursor.style.borderColor = "rgba(249, 115, 22, 0.9)";
        cursor.style.backgroundColor = "rgba(249, 115, 22, 0.2)";
      }
    }
  }

  if ($("#toolModeErase")) $("#toolModeErase").onclick = () => { eraserToolMode = "erase"; updateToolModeUI(); toast("消しゴム：透明にして消せます"); };
  if ($("#toolModeRestore")) $("#toolModeRestore").onclick = () => { eraserToolMode = "restore"; updateToolModeUI(); toast("復元ペン：消えた部分をなぞって元に戻せます"); };
  if ($("#toolModeRepair")) $("#toolModeRepair").onclick = () => { eraserToolMode = "repair"; updateToolModeUI(); toast("お直しペン：いらない部分を周りの色になじませて消せます"); };

  function updateEraserUI() {
    setEraserMode(isEraserActive);
    if ($("#eraserUndoBtn")) {
      $("#eraserUndoBtn").disabled = (eraserUndoStack.length === 0);
    }
  }

  if ($("#eraserToggleBtn")) {
    $("#eraserToggleBtn").onclick = () => {
      if (currentLayer !== "illust") switchLayer("illust");
      setEraserMode(!isEraserActive);
      if (isEraserActive) toast(eraserToolMode === "restore" ? "復元ON：プレビューをなぞってね" : "消しゴムON：プレビューをなぞってね");
    };
  }

  document.querySelectorAll(".eSizeBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".eSizeBtn").forEach(b => b.classList.remove("active", "bg-gray-900", "text-white"));
      btn.classList.add("active", "bg-gray-900", "text-white");
      eraserRadius = Number(btn.dataset.size) / 2;
    };
  });

  if ($("#eraserUndoBtn")) {
    $("#eraserUndoBtn").onclick = () => {
      if (eraserUndoStack.length === 0) return;
      const lastSnapshot = eraserUndoStack.pop();
      const sctx = adjust.src.getContext("2d");
      sctx.putImageData(lastSnapshot, 0, 0);
      updateEraserUI();
      updateIllustCache();
      renderPreview();
      toast("1つ元に戻しました");
      scheduleAutoSave();
    };
  }

  function sampleSurroundingColor(sctx, cx, cy, sampleRadius, imgW, imgH) {
    const dirs = 8;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < dirs; i++) {
      const angle = (i / dirs) * Math.PI * 2;
      const sx = Math.round(cx + Math.cos(angle) * sampleRadius);
      const sy = Math.round(cy + Math.sin(angle) * sampleRadius);
      if (sx < 0 || sy < 0 || sx >= imgW || sy >= imgH) continue;
      let d;
      try { d = sctx.getImageData(sx, sy, 1, 1).data; } catch (e) { continue; }
      if (d[3] < 15) continue;
      rSum += d[0]; gSum += d[1]; bSum += d[2]; count++;
    }
    if (count === 0) return null;
    return { r: Math.round(rSum / count), g: Math.round(gSum / count), b: Math.round(bSum / count) };
  }

  function paintRepairDab(sctx, sx, sy, rInSrc, imgW, imgH) {
    const sampleR = Math.max(rInSrc * 1.4, rInSrc + 6);
    const col = sampleSurroundingColor(sctx, sx, sy, sampleR, imgW, imgH);
    if (!col) return;
    const grad = sctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, rInSrc));
    grad.addColorStop(0, `rgba(${col.r},${col.g},${col.b},1)`);
    grad.addColorStop(0.75, `rgba(${col.r},${col.g},${col.b},0.9)`);
    grad.addColorStop(1, `rgba(${col.r},${col.g},${col.b},0)`);
    sctx.globalCompositeOperation = "source-over";
    sctx.fillStyle = grad;
    sctx.beginPath();
    sctx.arc(sx, sy, Math.max(1, rInSrc), 0, Math.PI * 2);
    sctx.fill();
  }

  function paintRepairStroke(sctx, pt1, pt2, rInSrc, imgW, imgH) {
    if (!pt2) {
      paintRepairDab(sctx, pt1.sx, pt1.sy, rInSrc, imgW, imgH);
      return;
    }
    const dist = Math.hypot(pt2.sx - pt1.sx, pt2.sy - pt1.sy);
    const step = Math.max(2, rInSrc / 3);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = pt1.sx + (pt2.sx - pt1.sx) * t;
      const sy = pt1.sy + (pt2.sy - pt1.sy) * t;
      paintRepairDab(sctx, sx, sy, rInSrc, imgW, imgH);
    }
  }

  function eraseAtCoords(p1, p2) {
    if (!adjust.src) return;
    const sctx = adjust.src.getContext("2d");
    const pt1 = previewToSrcCoords(p1.x, p1.y);
    const rInSrc = eraserRadius * pt1.ratio;

    sctx.save();
    if (eraserToolMode === "restore") {
      if (adjust.rawSrc) {
        sctx.save();
        sctx.beginPath();
        if (!p2 || (p1.x === p2.x && p1.y === p2.y)) {
          sctx.arc(pt1.sx, pt1.sy, Math.max(1, rInSrc), 0, Math.PI * 2);
        } else {
          const pt2 = previewToSrcCoords(p2.x, p2.y);
          sctx.arc(pt1.sx, pt1.sy, Math.max(1, rInSrc), 0, Math.PI * 2);
          sctx.arc(pt2.sx, pt2.sy, Math.max(1, rInSrc), 0, Math.PI * 2);
          sctx.lineWidth = Math.max(2, rInSrc * 2);
          sctx.lineCap = "round";
          sctx.lineJoin = "round";
          sctx.moveTo(pt1.sx, pt1.sy);
          sctx.lineTo(pt2.sx, pt2.sy);
        }
        sctx.clip();
        sctx.drawImage(adjust.rawSrc, 0, 0);
        sctx.restore();
      }
    } else if (eraserToolMode === "repair") {
      const pt2 = (p2 && !(p1.x === p2.x && p1.y === p2.y)) ? previewToSrcCoords(p2.x, p2.y) : null;
      paintRepairStroke(sctx, pt1, pt2, Math.max(1, rInSrc), adjust.src.width, adjust.src.height);
    } else {
      sctx.globalCompositeOperation = "destination-out";
      if (!p2 || (p1.x === p2.x && p1.y === p2.y)) {
        sctx.beginPath();
        sctx.arc(pt1.sx, pt1.sy, Math.max(1, rInSrc), 0, Math.PI * 2);
        sctx.fill();
      } else {
        const pt2 = previewToSrcCoords(p2.x, p2.y);
        sctx.beginPath();
        sctx.arc(pt1.sx, pt1.sy, Math.max(1, rInSrc), 0, Math.PI * 2);
        sctx.arc(pt2.sx, pt2.sy, Math.max(1, rInSrc), 0, Math.PI * 2);
        sctx.fill();

        sctx.beginPath();
        sctx.lineWidth = Math.max(2, rInSrc * 2);
        sctx.lineCap = "round";
        sctx.lineJoin = "round";
        sctx.moveTo(pt1.sx, pt1.sy);
        sctx.lineTo(pt2.sx, pt2.sy);
        sctx.stroke();
      }
    }
    sctx.restore();
  }

  function updateEraserCursorPos(clientX, clientY, renderScale) {
    if (!isEraserActive) return;
    const cursor = $("#eraserCursor");
    if (!cursor) return;
    const rect = adjustArea.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const diameter = eraserRadius * 2 * (renderScale || 1);
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    cursor.classList.remove("hidden");
  }

  let touchMode = null;
  let touchStartX = 0, touchStartY = 0;
  let origOx = 0, origOy = 0;
  let initialDist = 0;
  let initialScale = 1;
  let initialAngle = 0;
  let origRotation = 0;

  if (adjustArea) {
    adjustArea.addEventListener("touchstart", e => {
      e.preventDefault();
      const pt = getPreviewPoint(e.touches[0].clientX, e.touches[0].clientY);

      if (isEraserActive && currentLayer === "illust" && e.touches.length === 1) {
        if (adjust.src) {
          const sctx = adjust.src.getContext("2d");
          eraserUndoStack.push(sctx.getImageData(0, 0, adjust.src.width, adjust.src.height));
          if (eraserUndoStack.length > 10) eraserUndoStack.shift();
          updateEraserUI();
        }
        lastErasePoint = { x: pt.x, y: pt.y };
        eraseAtCoords(lastErasePoint, null);
        updateIllustCache();
        renderPreview();
        updateEraserCursorPos(e.touches[0].clientX, e.touches[0].clientY, pt.renderScale);
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
      const pt = getPreviewPoint(e.touches[0].clientX, e.touches[0].clientY);

      if (isEraserActive && currentLayer === "illust" && e.touches.length === 1) {
        updateEraserCursorPos(e.touches[0].clientX, e.touches[0].clientY, pt.renderScale);
        if (lastErasePoint) {
          const currentP = { x: pt.x, y: pt.y };
          eraseAtCoords(lastErasePoint, currentP);
          lastErasePoint = currentP;
          updateIllustCache();
          renderPreview();
        }
        return;
      }

      if (touchMode === 'drag' && e.touches.length === 1) {
        const scaleFactor = 1 / pt.renderScale;
        const dx = (e.touches[0].clientX - touchStartX) * scaleFactor;
        const dy = (e.touches[0].clientY - touchStartY) * scaleFactor;

        if (!isNaN(dx) && !isNaN(dy)) {
          if (currentLayer === "illust") { adjust.ox = origOx + dx; adjust.oy = origOy + dy; }
          else if (currentLayer === "text") { textConfig.ox = origOx + dx; textConfig.oy = origOy + dy; }
          else if (currentLayer === "bg") { bgConfig.ox = origOx + dx; bgConfig.oy = origOy + dy; }
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
      if (isEraserActive && $("#eraserCursor")) $("#eraserCursor").classList.add("hidden");

      if (e.touches.length === 0) {
        touchMode = null;
      } else if (e.touches.length === 1) {
        touchMode = 'drag';
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        if (currentLayer === "illust") { origOx = adjust.ox; origOy = adjust.oy; }
        else if (currentLayer === "text") { origOx = textConfig.ox; origOy = textConfig.oy; }
        else if (currentLayer === "bg") { bgConfig.ox = origOx + dx; bgConfig.oy = origOy + dy; }
      }
      scheduleAutoSave();
    });

    adjustArea.addEventListener("touchcancel", () => {
      touchMode = null;
      lastErasePoint = null;
      if (isEraserActive && $("#eraserCursor")) $("#eraserCursor").classList.add("hidden");
    });

    adjustArea.addEventListener("mousedown", e => {
      if (isEraserActive && currentLayer === "illust") {
        if (adjust.src) {
          const sctx = adjust.src.getContext("2d");
          eraserUndoStack.push(sctx.getImageData(0, 0, adjust.src.width, adjust.src.height));
          if (eraserUndoStack.length > 10) eraserUndoStack.shift();
          updateEraserUI();
        }
        const pt = getPreviewPoint(e.clientX, e.clientY);
        lastErasePoint = { x: pt.x, y: pt.y };
        eraseAtCoords(lastErasePoint, null);
        updateIllustCache();
        renderPreview();
        updateEraserCursorPos(e.clientX, e.clientY, pt.renderScale);
      }
    });

    adjustArea.addEventListener("mousemove", e => {
      if (isEraserActive && currentLayer === "illust") {
        const pt = getPreviewPoint(e.clientX, e.clientY);
        updateEraserCursorPos(e.clientX, e.clientY, pt.renderScale);
        if (lastErasePoint) {
          const currentP = { x: pt.x, y: pt.y };
          eraseAtCoords(lastErasePoint, currentP);
          lastErasePoint = currentP;
          updateIllustCache();
          renderPreview();
        }
      }
    });

    adjustArea.addEventListener("mouseup", () => {
      lastErasePoint = null;
      scheduleAutoSave();
    });

    adjustArea.addEventListener("mouseleave", () => {
      lastErasePoint = null;
      if (isEraserActive && $("#eraserCursor")) $("#eraserCursor").classList.add("hidden");
    });
  }

  function switchLayer(layerId) {
    currentLayer = layerId;
    if (currentLayer !== "illust" && isEraserActive) setEraserMode(false);

    document.querySelectorAll(".layerTabBar .tabBtn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.layer === layerId);
    });

    const tagEl = $("#activeLayerTag");
    if (tagEl) {
      if (layerId === "illust") tagEl.textContent = "🎨 イラスト編集中";
      else if (layerId === "text") tagEl.textContent = "💬 文字編集中";
      else if (layerId === "bg") tagEl.textContent = "🖼 背景編集中";
    }

    if ($("#shortcutsIllust")) $("#shortcutsIllust").classList.toggle("hidden", layerId !== "illust");
    if ($("#shortcutsText")) $("#shortcutsText").classList.toggle("hidden", layerId !== "text");
    if ($("#shortcutsBg")) $("#shortcutsBg").classList.toggle("hidden", layerId !== "bg");

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
    if (!slider || !label || !val || !unit) return;

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
    if (rotSlider) rotSlider.value = deg;
    if (rotVal) rotVal.textContent = deg;
  }

  if ($("#commonScaleSlider")) {
    $("#commonScaleSlider").oninput = e => {
      const v = Number(e.target.value);
      if ($("#commonScaleVal")) $("#commonScaleVal").textContent = v;
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
      scheduleAutoSave();
    };
  }

  if ($("#commonRotationSlider")) {
    $("#commonRotationSlider").oninput = e => {
      const deg = Number(e.target.value);
      if ($("#commonRotationVal")) $("#commonRotationVal").textContent = deg;
      const rad = deg * (Math.PI / 180);

      if (currentLayer === "illust") adjust.rotation = rad;
      else if (currentLayer === "text") textConfig.rotation = rad;
      else if (currentLayer === "bg") bgConfig.rotation = rad;
      renderPreview();
      scheduleAutoSave();
    };
  }

  function nudgeCurrentLayer(dx, dy) {
    if (currentLayer === "illust") { adjust.ox += dx; adjust.oy += dy; }
    else if (currentLayer === "text") { textConfig.ox += dx; textConfig.oy += dy; }
    else if (currentLayer === "bg") { bgConfig.ox += dx; bgConfig.oy += dy; }
    renderPreview();
    scheduleAutoSave();
  }

  if ($("#ctrlUp")) $("#ctrlUp").onclick = () => nudgeCurrentLayer(0, -6);
  if ($("#ctrlDown")) $("#ctrlDown").onclick = () => nudgeCurrentLayer(0, 6);
  if ($("#ctrlLeft")) $("#ctrlLeft").onclick = () => nudgeCurrentLayer(-6, 0);
  if ($("#ctrlRight")) $("#ctrlRight").onclick = () => nudgeCurrentLayer(6, 0);

  if ($("#ctrlCenter")) {
    $("#ctrlCenter").onclick = () => {
      if (currentLayer === "illust") centerIllust();
      else if (currentLayer === "text") textConfig.ox = preview.width / 2;
      else if (currentLayer === "bg") { bgConfig.ox = 0; bgConfig.oy = 0; }
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#centerIllustBtn")) $("#centerIllustBtn").onclick = () => { centerIllust(); renderPreview(); scheduleAutoSave(); };
  if ($("#fitWidth")) $("#fitWidth").onclick = () => { adjust.scale = preview.width / adjust.src.width; centerIllust(); syncCommonScaleSlider(); renderPreview(); scheduleAutoSave(); };

  if ($("#textPosTop")) {
    $("#textPosTop").onclick = () => {
      textConfig.ox = preview.width / 2;
      textConfig.oy = (mode === "emoji") ? 22 : 34;
      renderPreview();
      scheduleAutoSave();
    };
  }
  if ($("#textPosBottom")) {
    $("#textPosBottom").onclick = () => {
      textConfig.ox = preview.width / 2;
      textConfig.oy = (mode === "emoji") ? preview.height - 24 : preview.height - 40;
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#bgCenterBtn")) $("#bgCenterBtn").onclick = () => { bgConfig.ox = 0; bgConfig.oy = 0; renderPreview(); scheduleAutoSave(); };
  if ($("#bgFitFull")) $("#bgFitFull").onclick = () => { bgConfig.style = "full"; bgConfig.ox = 0; bgConfig.oy = 0; bgConfig.scale = 1; updateBgUI(); syncCommonScaleSlider(); renderPreview(); scheduleAutoSave(); };

  if ($("#toggleOrderDrawer")) $("#toggleOrderDrawer").onclick = () => { if ($("#layerOrderDrawer")) $("#layerOrderDrawer").classList.toggle("hidden"); };
  if ($("#closeOrderDrawer")) $("#closeOrderDrawer").onclick = () => { if ($("#layerOrderDrawer")) $("#layerOrderDrawer").classList.add("hidden"); };

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
    scheduleAutoSave();
  }

  document.querySelectorAll(".btnOrderUp").forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); moveLayer(btn.dataset.layer, -1); };
  });
  document.querySelectorAll(".btnOrderDown").forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); moveLayer(btn.dataset.layer, 1); };
  });

  function updateLayerListUI() {
    const list = $("#layerStackList");
    if (!list) return;
    layerOrder.forEach((id, idx) => {
      const item = $(`#item-${id}`);
      if (item) list.appendChild(item);
      const badge = $(`#badge-${id}`);
      const upBtn = item ? item.querySelector(".btnOrderUp") : null;
      const downBtn = item ? item.querySelector(".btnOrderDown") : null;
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
    if ($("#stateText")) {
      if (txt) $("#stateText").textContent = `"${txt.slice(0, 6)}${txt.length > 6 ? '…' : ''}"`;
      else $("#stateText").textContent = "無選択";
    }

    if ($("#stateIllust")) {
      let stIllust = "標準";
      if (bgTransparent && illustBorder) stIllust = "透過+フチ";
      else if (bgTransparent) stIllust = "透過ON";
      else stIllust = "透過OFF";
      $("#stateIllust").textContent = stIllust;
    }

    if ($("#stateBg")) {
      if (bgConfig.style === "none") $("#stateBg").textContent = "背景なし";
      else if (bgConfig.style === "image") $("#stateBg").textContent = "写真";
      else if (bgConfig.style === "circle") $("#stateBg").textContent = "まる型";
      else if (bgConfig.style === "roundRect") $("#stateBg").textContent = "角丸";
      else if (bgConfig.style === "full") $("#stateBg").textContent = "全面";
    }
  }

  // ==========================================
  // 背景透過 & 白ぬけ防止（超高精度 Flood-Fill）
  // ==========================================
  function updateIllustCache() {
    if (!adjust.src) return;
    if (!bgTransparent) {
      let c = cloneCanvas(adjust.src);
      if (illustBorder) {
        const px = $("#borderWidth") ? Number($("#borderWidth").value) : 6;
        c = addIllustBorder(c, px, illustBorderColor);
      }
      adjust.processedSrc = c;
      return;
    }

    let c = removeBackground(adjust.src, bgTolerance, protectWhite, gapProtectLevel);
    if (illustBorder) {
      const px = $("#borderWidth") ? Number($("#borderWidth").value) : 6;
      c = addIllustBorder(c, px, illustBorderColor);
    }
    adjust.processedSrc = c;
  }

  function removeBackground(src, tolerance = 22, protect = true, gapRadius = 2) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const x = c.getContext("2d");
    x.drawImage(src, 0, 0);
    const imgData = x.getImageData(0, 0, c.width, c.height);
    const a = imgData.data, w = c.width, h = c.height, total = w * h;

    // 1. 純粋な背景の白を外周から高精度サンプリング（暗い線は除外）
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    const step = Math.max(1, Math.floor((w + h) / 80));

    function addSample(idx) {
      if (a[idx + 3] < 15) return;
      const r = a[idx], g = a[idx + 1], b = a[idx + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      if (lum >= 190) { // 明るい白背景のみ拾う
        sumR += r; sumG += g; sumB += b; count++;
      }
    }

    for (let xx = 0; xx < w; xx += step) {
      addSample(xx * 4);
      addSample(((h - 1) * w + xx) * 4);
    }
    for (let yy = 0; yy < h; yy += step) {
      addSample((yy * w) * 4);
      addSample((yy * w + (w - 1)) * 4);
    }

    const bgR = count > 0 ? Math.round(sumR / count) : 255;
    const bgG = count > 0 ? Math.round(sumG / count) : 255;
    const bgB = count > 0 ? Math.round(sumB / count) : 255;

    // 2. 線（文字・輪郭）と背景の識別
    const isLine = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      const idx = p * 4;
      if (a[idx + 3] < 15) continue;
      const dr = Math.abs(a[idx] - bgR);
      const dg = Math.abs(a[idx + 1] - bgG);
      const db = Math.abs(a[idx + 2] - bgB);
      if (Math.max(dr, dg, db) > tolerance) {
        isLine[p] = 1;
      }
    }

    // 3. 白ぬけ防止壁（手足や顔の輪郭の隙間を閉じる）
    const wall = new Uint8Array(total);
    if (protect) {
      const rad = Math.max(1, Math.min(3, gapRadius));
      for (let y = 0; y < h; y++) {
        for (let xx = 0; xx < w; xx++) {
          const p = y * w + xx;
          if (isLine[p]) {
            const yMin = Math.max(0, y - rad), yMax = Math.min(h - 1, y + rad);
            const xMin = Math.max(0, xx - rad), xMax = Math.min(w - 1, xx + rad);
            for (let ny = yMin; ny <= yMax; ny++) {
              const row = ny * w;
              for (let nx = xMin; nx <= xMax; nx++) {
                wall[row + nx] = 1;
              }
            }
          }
        }
      }
    } else {
      wall.set(isLine);
    }

    // 4. 外周からの洪水浸透（キャラクターの内部へは壁を越えて浸入させない）
    const visited = new Uint8Array(total);
    const q = new Int32Array(total);
    let head = 0, tail = 0;

    // 四辺の外周ピクセルで、かつ壁でない部分を浸透開始点（シード）にする
    for (let xx = 0; xx < w; xx++) {
      const topP = xx;
      if (!wall[topP] && !visited[topP]) { visited[topP] = 1; q[tail++] = topP; }
      const botP = (h - 1) * w + xx;
      if (!wall[botP] && !visited[botP]) { visited[botP] = 1; q[tail++] = botP; }
    }
    for (let yy = 0; yy < h; yy++) {
      const leftP = yy * w;
      if (!wall[leftP] && !visited[leftP]) { visited[leftP] = 1; q[tail++] = leftP; }
      const rightP = yy * w + (w - 1);
      if (!wall[rightP] && !visited[rightP]) { visited[rightP] = 1; q[tail++] = rightP; }
    }

    // 文字が左右いっぱいに広がって上下を分断している場合へのバイパス救済
    // （両端の2列は文字の隙間を潜り抜けて下へ回り込ませる）
    for (let yy = 1; yy < h - 1; yy++) {
      const lp = yy * w;
      const rp = yy * w + (w - 1);
      if (!visited[lp] && !isLine[lp]) { visited[lp] = 1; q[tail++] = lp; }
      if (!visited[rp] && !isLine[rp]) { visited[rp] = 1; q[tail++] = rp; }
    }

    while (head < tail) {
      const p = q[head++];
      const xx = p % w, yy = (p / w) | 0;

      if (xx > 0 && !visited[p - 1] && !wall[p - 1]) { visited[p - 1] = 1; q[tail++] = p - 1; }
      if (xx < w - 1 && !visited[p + 1] && !wall[p + 1]) { visited[p + 1] = 1; q[tail++] = p + 1; }
      if (yy > 0 && !visited[p - w] && !wall[p - w]) { visited[p - w] = 1; q[tail++] = p - w; }
      if (yy < h - 1 && !visited[p + w] && !wall[p + w]) { visited[p + w] = 1; q[tail++] = p + w; }
    }

    // 5. 外側から到達できた背景ピクセルのみを透明化（キャラ内部の白は完全保持）
    for (let p = 0; p < total; p++) {
      if (visited[p]) {
        const idx = p * 4;
        const dr = Math.abs(a[idx] - bgR);
        const dg = Math.abs(a[idx + 1] - bgG);
        const db = Math.abs(a[idx + 2] - bgB);
        const maxDiff = Math.max(dr, dg, db);

        if (maxDiff <= tolerance) {
          a[idx + 3] = 0;
        } else {
          // 輪郭境界のアンチエイリアス処理
          const alpha = Math.min(a[idx + 3], Math.max(0, Math.round(((maxDiff - tolerance) / tolerance) * 255)));
          a[idx + 3] = alpha;
        }
      }
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

  if ($("#bgAutoTransparentToggle")) {
    $("#bgAutoTransparentToggle").onchange = e => {
      bgTransparent = e.target.checked;
      if ($("#transSettingsBody")) $("#transSettingsBody").classList.toggle("hidden", !bgTransparent);
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#protectWhiteToggle")) {
    $("#protectWhiteToggle").onchange = e => {
      protectWhite = e.target.checked;
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#gapProtectLevel")) {
    $("#gapProtectLevel").onchange = e => {
      gapProtectLevel = Number(e.target.value);
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#bgToleranceSlider")) {
    $("#bgToleranceSlider").oninput = e => {
      bgTolerance = Number(e.target.value);
      if ($("#bgToleranceVal")) $("#bgToleranceVal").textContent = e.target.value;
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#illustBorderToggle")) {
    $("#illustBorderToggle").onchange = e => {
      illustBorder = e.target.checked;
      if ($("#illustBorderColorWrap")) $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  }

  if ($("#borderWidth")) {
    $("#borderWidth").oninput = e => {
      if ($("#borderWidthValue")) $("#borderWidthValue").textContent = e.target.value;
      if (illustBorder) { updateIllustCache(); renderPreview(); scheduleAutoSave(); }
    };
  }

  document.querySelectorAll("#illustBorderColorList .cBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      illustBorderColor = btn.dataset.color;
      if ($("#illustBorderColorPicker")) $("#illustBorderColorPicker").value = illustBorderColor;
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  });

  if ($("#illustBorderColorPicker")) {
    $("#illustBorderColorPicker").oninput = e => {
      document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
      illustBorderColor = e.target.value;
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  }

  // 文字設定
  if ($("#stampText")) $("#stampText").oninput = e => { textConfig.text = e.target.value; renderPreview(); scheduleAutoSave(); };
  if ($("#clearTextBtn")) $("#clearTextBtn").onclick = () => { if ($("#stampText")) $("#stampText").value = ""; textConfig.text = ""; renderPreview(); scheduleAutoSave(); };
  document.querySelectorAll(".quickWords .qBtn").forEach(btn => {
    btn.onclick = () => { if ($("#stampText")) $("#stampText").value = btn.textContent; textConfig.text = btn.textContent; renderPreview(); scheduleAutoSave(); };
  });
  if ($("#textFont")) $("#textFont").onchange = e => { textConfig.font = e.target.value; renderPreview(); scheduleAutoSave(); };

  document.querySelectorAll("#textColorList .cBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      textConfig.color = btn.dataset.color;
      if ($("#textColorPicker")) $("#textColorPicker").value = textConfig.color;
      renderPreview();
      scheduleAutoSave();
    };
  });
  if ($("#textColorPicker")) {
    $("#textColorPicker").oninput = e => {
      document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
      textConfig.color = e.target.value;
      renderPreview();
      scheduleAutoSave();
    };
  }
  document.querySelectorAll("#textStrokeList .sBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#textStrokeList .sBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      textConfig.stroke = btn.dataset.stroke;
      renderPreview();
      scheduleAutoSave();
    };
  });

  // 背景設定
  function updateBgUI() {
    const style = bgConfig.style;
    const isNone = (style === "none"), isImg = (style === "image");
    document.querySelectorAll(".bgStyleCard").forEach(card => card.classList.toggle("active", card.dataset.style === style));
    if ($("#bgNoneNotice")) $("#bgNoneNotice").classList.toggle("hidden", !isNone);
    if ($("#bgImageControls")) $("#bgImageControls").classList.toggle("hidden", !isImg);
    if ($("#bgColorControls")) $("#bgColorControls").classList.toggle("hidden", isNone || isImg);
    if ($("#bgImageStatus")) $("#bgImageStatus").classList.toggle("hidden", !(isImg && bgConfig.image));

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
      updateBgUI();
      syncCommonScaleSlider();
      renderPreview();
      scheduleAutoSave();
    };
  });

  if ($("#bgFileInput")) {
    $("#bgFileInput").onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const im = new Image();
      im.onload = () => {
        bgConfig.image = im; bgConfig.style = "image";
        updateBgUI();
        syncCommonScaleSlider();
        renderPreview();
        toast("背景写真を取り込みました！");
        scheduleAutoSave();
      };
      im.src = URL.createObjectURL(f);
    };
  }

  if ($("#removeBgImgBtn")) {
    $("#removeBgImgBtn").onclick = () => {
      bgConfig.image = null; bgConfig.style = "none";
      if ($("#bgFileInput")) $("#bgFileInput").value = "";
      updateBgUI();
      syncCommonScaleSlider();
      renderPreview();
      scheduleAutoSave();
    };
  }

  document.querySelectorAll("#bgColorList .cBtn").forEach(btn => {
    btn.onclick = () => { bgConfig.color = btn.dataset.bg; updateBgUI(); renderPreview(); scheduleAutoSave(); };
  });
  if ($("#bgColorPicker")) {
    $("#bgColorPicker").oninput = e => {
      bgConfig.color = e.target.value; updateBgUI(); renderPreview(); scheduleAutoSave();
    };
  }

  // ==========================================
  // レンダリング & 保存
  // ==========================================
  function renderPreview() {
    if (!pctx) return;
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

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  async function performSave(shouldDownload = false) {
    if (editingIndex === null && $("#count") && results.length >= Number($("#count").value)) {
      toast("指定個数に達しています"); return;
    }
    const c = await getFinalCanvas();
    c.toBlob(blob => {
      const savedState = {
        adjust: {
          src: cloneCanvas(adjust.src),
          rawSrc: cloneCanvas(adjust.rawSrc),
          scale: adjust.scale,
          ox: adjust.ox,
          oy: adjust.oy,
          rotation: adjust.rotation
        },
        textConfig: JSON.parse(JSON.stringify(textConfig)),
        bgConfig: { style: bgConfig.style, color: bgConfig.color, image: bgConfig.image, scale: bgConfig.scale, ox: bgConfig.ox, oy: bgConfig.oy, rotation: bgConfig.rotation },
        layerOrder: [...layerOrder],
        bgTransparent, bgTolerance, protectWhite, gapProtectLevel, illustBorder, illustBorderColor,
        borderWidth: $("#borderWidth") ? Number($("#borderWidth").value) : 6
      };

      let currentFileName = "";
      if (editingIndex !== null) {
        currentFileName = `${mode}_${String(editingIndex + 1).padStart(2, "0")}.png`;
        results[editingIndex] = { blob, url: URL.createObjectURL(blob), name: currentFileName, state: savedState };
        toast("上書き保存しました！");
      } else {
        const n = results.length + 1;
        currentFileName = `${mode}_${String(n).padStart(2, "0")}.png`;
        results.push({ blob, url: URL.createObjectURL(blob), name: currentFileName, state: savedState });
        toast(`${n}個目をアルバムに保存しました！`);
      }

      if (shouldDownload) {
        downloadBlob(blob, currentFileName);
        toast("端末にも画像を保存しました！");
      }

      editingIndex = null;
      refresh();
      if ($("#adjustStep")) $("#adjustStep").classList.add("hidden");

      if (loadMethod === "single") {
        if ($("#sheetStep")) $("#sheetStep").classList.add("hidden");
        const mainEl = document.querySelector("main");
        if (mainEl) mainEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        if ($("#sheetStep")) $("#sheetStep").classList.remove("hidden");
        advanceSelectionSlot(1);
      }

      triggerAutoSave();
    }, "image/png");
  }

  if ($("#save")) $("#save").onclick = () => performSave(false);
  if ($("#saveAndDownload")) $("#saveAndDownload").onclick = () => performSave(true);
  if ($("#saveOnly")) $("#saveOnly").onclick = () => performSave(false);

  function refresh() {
    if ($("#done")) $("#done").textContent = results.length;
    if ($("#total") && $("#count")) $("#total").textContent = $("#count").value;
    
    const hasItems = results.length > 0;
    if ($("#zip")) $("#zip").disabled = !hasItems;
    if ($("#downloadSequentialBtn")) $("#downloadSequentialBtn").disabled = !hasItems;
    if ($("#shareAllBtn")) $("#shareAllBtn").disabled = !hasItems;

    const thumbs = $("#thumbs");
    if (!thumbs) return;
    thumbs.innerHTML = "";
    results.forEach((r, i) => {
      const d = document.createElement("div");
      d.className = "thumb";
      d.innerHTML = `<span>${i + 1}</span><img src="${r.url}">`;
      d.onclick = () => showImageModal(r, i);
      thumbs.appendChild(d);
    });
    if ($("#checks")) $("#checks").innerHTML = `<div class="ok">✅ 順調に作成中です（タップして再編集・個別保存可能）</div>`;
  }

  function showImageModal(item, index) {
    currentModalIndex = index;
    if ($("#modalTitle")) $("#modalTitle").textContent = `${index + 1}個目のスタンプ`;
    if ($("#modalImg")) $("#modalImg").src = item.url;
    if ($("#imageModal")) $("#imageModal").classList.add("show");
  }

  if ($("#modalClose")) $("#modalClose").onclick = () => { if ($("#imageModal")) $("#imageModal").classList.remove("show"); };

  if ($("#modalDownloadBtn")) {
    $("#modalDownloadBtn").onclick = () => {
      if (currentModalIndex === null || !results[currentModalIndex]) return;
      const item = results[currentModalIndex];
      downloadBlob(item.blob, item.name);
      toast(`${item.name} を端末に保存しました！`);
    };
  }

  if ($("#modalShareBtn")) {
    $("#modalShareBtn").onclick = async () => {
      if (currentModalIndex === null || !results[currentModalIndex]) return;
      const item = results[currentModalIndex];
      const file = new File([item.blob], item.name, { type: "image/png" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: item.name, text: "LINEスタンプ画像", files: [file] });
        } catch (e) {
          if (e.name !== "AbortError") toast("共有に失敗しました。");
        }
      } else {
        downloadBlob(item.blob, item.name);
        toast("端末のダウンロードを実行しました");
      }
    };
  }

  if ($("#modalEditBtn")) {
    $("#modalEditBtn").onclick = () => {
      if (currentModalIndex === null || !results[currentModalIndex]) return;
      const item = results[currentModalIndex];
      if ($("#imageModal")) $("#imageModal").classList.remove("show");
      if (!item.state) { toast("編集画面のデータがありません"); return; }
      editingIndex = currentModalIndex;
      openAdjustForEdit(item.state);
      triggerAutoSave();
    };
  }

  if ($("#modalDeleteBtn")) {
    $("#modalDeleteBtn").onclick = () => {
      if (currentModalIndex === null || !results[currentModalIndex]) return;
      if (confirm(`${currentModalIndex + 1}個目を削除しますか？`)) {
        results.splice(currentModalIndex, 1);
        if ($("#imageModal")) $("#imageModal").classList.remove("show");
        refresh();
        toast("削除しました");
        triggerAutoSave();
      }
    };
  }

  if ($("#downloadSequentialBtn")) {
    $("#downloadSequentialBtn").onclick = () => {
      if (results.length === 0) return;
      toast(`${results.length}枚の画像を順番に保存しています...`);

      results.forEach((item, index) => {
        setTimeout(() => {
          downloadBlob(item.blob, item.name);
          if (index === results.length - 1) {
            toast("すべての画像を端末に保存しました！");
          }
        }, index * 400);
      });
    };
  }

  if ($("#shareAllBtn")) {
    $("#shareAllBtn").onclick = async () => {
      if (results.length === 0) return;
      const files = results.map(r => new File([r.blob], r.name, { type: "image/png" }));

      if (navigator.canShare && navigator.canShare({ files })) {
        try {
          await navigator.share({ title: "LINEスタンプセット", text: `作成したスタンプ画像 ${results.length}枚`, files });
        } catch (err) {
          if (err.name !== "AbortError") toast("共有に失敗しました。「1枚ずつ全保存」をお試しください。");
        }
      } else {
        toast("一括共有非対応のため、1枚ずつ保存します。");
        if ($("#downloadSequentialBtn")) $("#downloadSequentialBtn").click();
      }
    };
  }

  if ($("#zip")) {
    $("#zip").onclick = async () => {
      if (!window.JSZip) { toast("ZIP機能の読み込みに失敗しました"); return; }
      toast("ZIPを作成中...");
      const z = new JSZip();
      results.forEach(r => z.file(r.name, r.blob));
      const b = await z.generateAsync({ type: "blob" });
      downloadBlob(b, `${mode}_LINE画像まとめ.zip`);
    };
  }

  function toast(t) {
    const x = $("#toast");
    if (!x) return;
    x.textContent = t;
    x.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => x.classList.remove("show"), 1800);
  }

  document.fonts.ready.then(() => {
    if ($("#adjustStep") && !$("#adjustStep").classList.contains("hidden")) renderPreview();
  });

  // 画面リサイズ時にもCanvasと枠を完全同期
  window.addEventListener("resize", () => {
    if (img && $("#sheetStep") && !$("#sheetStep").classList.contains("hidden")) {
      renderCropBox();
    }
  });

  updateMode();
  restoreSavedSession();
});
