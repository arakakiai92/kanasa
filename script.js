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

  // rawSrc: 切り出し直後の未加工キャンバス（復元ペン用）
  // src: 現在のイラストキャンバス（消しゴム等の編集が施されたもの）
  // processedSrc: 透過・フチを適用したキャッシュ
  let adjust = { rawSrc: null, src: null, processedSrc: null, scale: 1, ox: 0, oy: 0, rotation: 0 };
  let bgTransparent = true;
  let bgTolerance = 22;
  let protectWhite = true;
  let gapProtectLevel = 2; // 1:標準, 2:強力, 3:超強力
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
  let eraserToolMode = "erase"; // "erase" | "restore"
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
  // IndexedDBによる自動バックアップ・復元
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

      const isAdjustOpen = !$("#adjustStep").classList.contains("hidden");
      const currentState = {
        mode,
        count: $("#count").value,
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
          borderWidth: Number($("#borderWidth").value),
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

  // アプリ切り替え時・バックグラウンド移行時に即保存
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") triggerAutoSave();
  });
  window.addEventListener("pagehide", triggerAutoSave);

  async function restoreSavedSession() {
    const data = await loadFromDB("app_state");
    if (!data || (!data.imgSrc && (!data.results || data.results.length === 0))) return;

    try {
      mode = data.mode || "sticker";
      $("#count").value = data.count || "16";
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
          $("#sheetStep").classList.remove("hidden");
          $("#adjustStep").classList.add("hidden");
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

  $("#resetAllBtn").onclick = async () => {
    if (confirm("作業中のすべてのデータを初期化して最初からやり直しますか？")) {
      await clearDB();
      location.reload();
    }
  };

  // ==========================================
  // モード & シート管理
  // ==========================================
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
    scheduleAutoSave();
  }

  document.querySelectorAll(".switch button").forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    updateMode();
  });

  $("#count").onchange = () => {
    $("#total").textContent = $("#count").value;
    scheduleAutoSave();
  };

  function resetSelection() {
    selectionRect = null;
    selection = null;
    crop.classList.add("hidden");
    $("#cropFineTune").classList.add("hidden");
    $("#resetCrop").classList.add("hidden");
    $("#adjustBtn").classList.add("hidden");
    $("#startSelect").classList.remove("hidden");
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
          $("#sheetStep").classList.remove("hidden");
          $("#adjustStep").classList.add("hidden");
          setupCanvas();
          renderSheet();
          requestAnimationFrame(() => {
            initOrAdjustSelection();
            refresh();
            toast("シートを読み込みました！枠を動かしてね");
            triggerAutoSave();
          });
        };
        im.onerror = () => toast("画像の読み込みに失敗しました。");
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
    scheduleAutoSave();
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

  wrap.addEventListener("touchend", () => { cropDrag = null; scheduleAutoSave(); });
  wrap.addEventListener("touchcancel", () => { cropDrag = null; });

  wrap.addEventListener("mousedown", e => {
    if (!img) return;
    const p = getTouchPos(e.clientX, e.clientY);
    const handleEl = e.target.closest(".handle");
    const isInsideCrop = (e.target === crop || crop.contains(e.target));
    if (handleEl) cropDrag = { type: "resize", handle: handleEl.dataset.h, startP: p, orig: { ...selectionRect } };
    else if (isInsideCrop && selectionRect) cropDrag = { type: "move", startP: p, orig: { ...selectionRect } };
    else cropDrag = { type: "draw", startP: p, orig: null };
  });

  wrap.addEventListener("mousemove", e => {
    if (!cropDrag) return;
    const p = getTouchPos(e.clientX, e.clientY);
    const r = SPEC[mode].ratio;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : 300;
    const srH = sr.height > 0 ? sr.height : 300;

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

  function nudgeCrop(dx, dy) {
    if (!selectionRect) return;
    const sr = stage.getBoundingClientRect();
    const srW = sr.width > 0 ? sr.width : 300;
    const srH = sr.height > 0 ? sr.height : 300;
    selectionRect.x = Math.max(0, Math.min(srW - selectionRect.w, selectionRect.x + dx));
    selectionRect.y = Math.max(0, Math.min(srH - selectionRect.h, selectionRect.y + dy));
    renderCropBox();
    scheduleAutoSave();
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
    scheduleAutoSave();
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
    scheduleAutoSave();
  };
  $("#cropZoomIn").onclick = () => scaleCrop(1.08);
  $("#cropZoomOut").onclick = () => scaleCrop(0.92);

  $("#adjustBtn").onclick = () => {
    if (!selection) { toast("絵を指で囲んでね"); return; }
    editingIndex = null;
    openAdjustNew();
    triggerAutoSave();
  };

  $("#back").onclick = () => {
    editingIndex = null;
    $("#adjustStep").classList.add("hidden");
    $("#sheetStep").classList.remove("hidden");
    triggerAutoSave();
  };

  function cropFromOriginal(sel) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sel.w));
    c.height = Math.max(1, Math.round(sel.h));
    c.getContext("2d").drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, c.width, c.height);
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
    $("#stampText").value = "";

    layerOrder = ["illust", "text", "bg"];
    bgTransparent = true;
    bgTolerance = 22;
    protectWhite = true;
    gapProtectLevel = 2;
    $("#bgAutoTransparentToggle").checked = true;
    $("#transSettingsBody").classList.remove("hidden");
    $("#bgToleranceSlider").value = 22;
    $("#bgToleranceVal").textContent = "22";
    $("#protectWhiteToggle").checked = true;
    $("#gapProtectLevel").value = "2";

    illustBorder = false;
    illustBorderColor = "#ffffff";
    $("#illustBorderToggle").checked = false;
    $("#illustBorderColorWrap").classList.add("hidden");
    $("#borderWidth").value = 6;
    $("#borderWidthValue").textContent = "6";

    isEraserActive = false;
    eraserToolMode = "erase";
    updateToolModeUI();
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

    adjust.src = cloneCanvas(savedState.adjust.src);
    adjust.rawSrc = savedState.adjust.rawSrc ? cloneCanvas(savedState.adjust.rawSrc) : cloneCanvas(savedState.adjust.src);
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
    gapProtectLevel = savedState.gapProtectLevel || 2;
    illustBorder = savedState.illustBorder;
    illustBorderColor = savedState.illustBorderColor || "#ffffff";

    $("#bgAutoTransparentToggle").checked = bgTransparent;
    $("#transSettingsBody").classList.toggle("hidden", !bgTransparent);
    $("#bgToleranceSlider").value = bgTolerance;
    $("#bgToleranceVal").textContent = bgTolerance;
    $("#protectWhiteToggle").checked = protectWhite;
    $("#gapProtectLevel").value = String(gapProtectLevel);

    $("#illustBorderToggle").checked = illustBorder;
    $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
    $("#borderWidth").value = savedState.borderWidth || 6;
    $("#borderWidthValue").textContent = savedState.borderWidth || 6;

    isEraserActive = false;
    eraserToolMode = "erase";
    updateToolModeUI();
    eraserUndoStack = [];
    lastErasePoint = null;
    updateEraserUI();

    if (editingIndex !== null) {
      $("#save").textContent = `💾 ${editingIndex + 1}個目を修正して上書き保存`;
      $("#adjustStepTitle").textContent = `${editingIndex + 1}個目を修正中（上書き保存）`;
    }

    $("#adjustStep").classList.remove("hidden");
    $("#sheetStep").classList.add("hidden");

    switchLayer("illust");
    updateIllustCache();
    updateLayerListUI();
    updateBgUI();
    renderPreview();
  }

  function centerIllust() {
    const iw = preview.width * adjust.scale;
    const ih = (preview.width * adjust.scale / adjust.src.width) * adjust.src.height;
    adjust.ox = (preview.width - iw) / 2;
    adjust.oy = (preview.height - ih) / 2;
  }

  // ==========================================
  // 消しゴム & 復元ペン 精密座標計算
  // ==========================================
  function getPreviewPoint(clientX, clientY) {
    const rect = preview.getBoundingClientRect();
    const elemX = clientX - rect.left;
    const elemY = clientY - rect.top;

    const canvasRatio = preview.width / preview.height;
    const elemRatio = rect.width / rect.height;

    let renderW, renderH, offsetX, offsetY;
    if (elemRatio > canvasRatio) {
      // 左右に余白（pillarbox）
      renderH = rect.height;
      renderW = rect.height * canvasRatio;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    } else {
      // 上下に余白（letterbox）
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

    // 逆回転
    const cosR = Math.cos(-adjust.rotation);
    const sinR = Math.sin(-adjust.rotation);

    const rx = dx * cosR - dy * sinR;
    const ry = dx * sinR + dy * cosR;

    const imgX = rx + iw / 2;
    const imgY = ry + ih / 2;

    const ratio = adjust.src.width / iw;
    return {
      sx: imgX * ratio,
      sy: imgY * ratio,
      ratio
    };
  }

  function setEraserMode(active) {
    isEraserActive = active;
    $("#eraserToggleBtn").textContent = isEraserActive ? "🧹 ペンツール：ON" : "🧹 消しゴム：OFF";
    $("#eraserToggleBtn").classList.toggle("active", isEraserActive);
    $("#eraserOptionsWrap").classList.toggle("hidden", !isEraserActive);
    adjustArea.classList.toggle("erasing", isEraserActive);
    if (!isEraserActive) $("#eraserCursor").classList.add("hidden");
  }

  function updateToolModeUI() {
    $("#toolModeErase").classList.toggle("active", eraserToolMode === "erase");
    $("#toolModeErase").classList.toggle("bg-orange-500", eraserToolMode === "erase");
    $("#toolModeErase").classList.toggle("text-white", eraserToolMode === "erase");
    $("#toolModeErase").classList.toggle("text-gray-600", eraserToolMode !== "erase");

    $("#toolModeRestore").classList.toggle("active", eraserToolMode === "restore");
    $("#toolModeRestore").classList.toggle("bg-blue-600", eraserToolMode === "restore");
    $("#toolModeRestore").classList.toggle("text-white", eraserToolMode === "restore");
    $("#toolModeRestore").classList.toggle("text-gray-600", eraserToolMode !== "restore");

    const cursor = $("#eraserCursor");
    if (eraserToolMode === "restore") {
      cursor.style.borderColor = "rgba(37, 99, 235, 0.9)";
      cursor.style.backgroundColor = "rgba(37, 99, 235, 0.2)";
    } else {
      cursor.style.borderColor = "rgba(249, 115, 22, 0.9)";
      cursor.style.backgroundColor = "rgba(249, 115, 22, 0.2)";
    }
  }

  $("#toolModeErase").onclick = () => { eraserToolMode = "erase"; updateToolModeUI(); };
  $("#toolModeRestore").onclick = () => { eraserToolMode = "restore"; updateToolModeUI(); toast("復元ペン：消えた部分をなぞって元に戻せます"); };

  function updateEraserUI() {
    setEraserMode(isEraserActive);
    $("#eraserUndoBtn").disabled = (eraserUndoStack.length === 0);
  }

  $("#eraserToggleBtn").onclick = () => {
    if (currentLayer !== "illust") switchLayer("illust");
    setEraserMode(!isEraserActive);
    if (isEraserActive) toast(eraserToolMode === "restore" ? "復元ON：プレビューをなぞってね" : "消しゴムON：プレビューをなぞってね");
  };

  document.querySelectorAll(".eSizeBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".eSizeBtn").forEach(b => b.classList.remove("active", "bg-gray-900", "text-white"));
      btn.classList.add("active", "bg-gray-900", "text-white");
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
    toast("1つ元に戻しました");
    scheduleAutoSave();
  };

  function eraseAtCoords(p1, p2) {
    if (!adjust.src) return;
    const sctx = adjust.src.getContext("2d");
    const pt1 = previewToSrcCoords(p1.x, p1.y);
    const rInSrc = eraserRadius * pt1.ratio;

    sctx.save();
    if (eraserToolMode === "restore") {
      // 復元ペン：切り出し時の元画像 rawSrc から該当部分を復元
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
    } else {
      // 通常の消しゴム：透明化
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

  // タッチ & ドラッグイベント管理
  let touchMode = null;
  let touchStartX = 0, touchStartY = 0;
  let origOx = 0, origOy = 0;
  let initialDist = 0;
  let initialScale = 1;
  let initialAngle = 0;
  let origRotation = 0;

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
    scheduleAutoSave();
  });

  adjustArea.addEventListener("touchcancel", () => {
    touchMode = null;
    lastErasePoint = null;
    if (isEraserActive) $("#eraserCursor").classList.add("hidden");
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
    if (isEraserActive) $("#eraserCursor").classList.add("hidden");
  });

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
    scheduleAutoSave();
  };

  $("#commonRotationSlider").oninput = e => {
    const deg = Number(e.target.value);
    $("#commonRotationVal").textContent = deg;
    const rad = deg * (Math.PI / 180);

    if (currentLayer === "illust") adjust.rotation = rad;
    else if (currentLayer === "text") textConfig.rotation = rad;
    else if (currentLayer === "bg") bgConfig.rotation = rad;
    renderPreview();
    scheduleAutoSave();
  };

  function nudgeCurrentLayer(dx, dy) {
    if (currentLayer === "illust") { adjust.ox += dx; adjust.oy += dy; }
    else if (currentLayer === "text") { textConfig.ox += dx; textConfig.oy += dy; }
    else if (currentLayer === "bg") { bgConfig.ox += dx; bgConfig.oy += dy; }
    renderPreview();
    scheduleAutoSave();
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
    scheduleAutoSave();
  };

  $("#centerIllustBtn").onclick = () => { centerIllust(); renderPreview(); scheduleAutoSave(); };
  $("#fitWidth").onclick = () => { adjust.scale = preview.width / adjust.src.width; centerIllust(); syncCommonScaleSlider(); renderPreview(); scheduleAutoSave(); };

  $("#textPosTop").onclick = () => {
    textConfig.ox = preview.width / 2;
    textConfig.oy = (mode === "emoji") ? 22 : 34;
    renderPreview();
    scheduleAutoSave();
  };
  $("#textPosBottom").onclick = () => {
    textConfig.ox = preview.width / 2;
    textConfig.oy = (mode === "emoji") ? preview.height - 24 : preview.height - 40;
    renderPreview();
    scheduleAutoSave();
  };

  $("#bgCenterBtn").onclick = () => { bgConfig.ox = 0; bgConfig.oy = 0; renderPreview(); scheduleAutoSave(); };
  $("#bgFitFull").onclick = () => { bgConfig.style = "full"; bgConfig.ox = 0; bgConfig.oy = 0; bgConfig.scale = 1; updateBgUI(); syncCommonScaleSlider(); renderPreview(); scheduleAutoSave(); };

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
    if (txt) $("#stateText").textContent = `"${txt.slice(0, 6)}${txt.length > 6 ? '…' : ''}"`;
    else $("#stateText").textContent = "無選択";

    let stIllust = "標準";
    if (bgTransparent && illustBorder) stIllust = "透過+フチ";
    else if (bgTransparent) stIllust = "透過ON";
    else stIllust = "透過OFF";
    $("#stateIllust").textContent = stIllust;

    if (bgConfig.style === "none") $("#stateBg").textContent = "背景なし";
    else if (bgConfig.style === "image") $("#stateBg").textContent = "写真";
    else if (bgConfig.style === "circle") $("#stateBg").textContent = "まる型";
    else if (bgConfig.style === "roundRect") $("#stateBg").textContent = "角丸";
    else if (bgConfig.style === "full") $("#stateBg").textContent = "全面";
  }

  // ==========================================
  // 背景透過 & 白ぬけ防止（手足・隙間ガード強化）
  // ==========================================
  function updateIllustCache() {
    if (!adjust.src) return;
    if (!bgTransparent) {
      let c = cloneCanvas(adjust.src);
      if (illustBorder) {
        const px = Number($("#borderWidth").value);
        c = addIllustBorder(c, px, illustBorderColor);
      }
      adjust.processedSrc = c;
      return;
    }

    let c = removeBackground(adjust.src, bgTolerance, protectWhite, gapProtectLevel);
    if (illustBorder) {
      const px = Number($("#borderWidth").value);
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

    // 四隅のピクセルから背景色を算出
    const sampleCorners = [0, w - 1, (h - 1) * w, total - 1];
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let cp of sampleCorners) {
      if (a[cp * 4 + 3] > 10) {
        sumR += a[cp * 4]; sumG += a[cp * 4 + 1]; sumB += a[cp * 4 + 2]; count++;
      }
    }
    const bgR = count ? Math.round(sumR / count) : 255;
    const bgG = count ? Math.round(sumG / count) : 255;
    const bgB = count ? Math.round(sumB / count) : 255;

    // 輪郭線（色差・明度差）の検出
    const isLine = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      const idx = p * 4;
      if (a[idx + 3] < 10) continue;
      const dr = Math.abs(a[idx] - bgR);
      const dg = Math.abs(a[idx + 1] - bgG);
      const db = Math.abs(a[idx + 2] - bgB);
      if (Math.max(dr, dg, db) > tolerance) {
        isLine[p] = 1;
      }
    }

    // 8近傍モルフォロジー膨張（Dilation）による隙間ガード
    // 手首・顎・指などの1〜3pxの途切れ目をしっかり接着して透過の侵入を防ぐ
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

    // フラッドフィル：全外周ではなく「四隅（カド）」の背景からのみ浸透開始！
    // これにより、下端・左右端に猫の手が触れていても手の中からは透過が始まらない
    const visited = new Uint8Array(total);
    const q = new Int32Array(total);
    let head = 0, tail = 0;

    const cornerPoints = [0, w - 1, (h - 1) * w, total - 1];
    for (let cp of cornerPoints) {
      if (!wall[cp] && !visited[cp]) {
        visited[cp] = 1;
        q[tail++] = cp;
      }
    }

    // 四隅がキャラクターで埋まっている場合のフォールバック（外周サンプリング）
    if (tail === 0) {
      for (let xx = 0; xx < w; xx += 5) {
        if (!wall[xx] && !visited[xx]) { visited[xx] = 1; q[tail++] = xx; }
        const b = (h - 1) * w + xx;
        if (!wall[b] && !visited[b]) { visited[b] = 1; q[tail++] = b; }
      }
    }

    while (head < tail) {
      const p = q[head++];
      const xx = p % w, yy = (p / w) | 0;

      if (xx > 0 && !visited[p - 1] && !wall[p - 1]) { visited[p - 1] = 1; q[tail++] = p - 1; }
      if (xx < w - 1 && !visited[p + 1] && !wall[p + 1]) { visited[p + 1] = 1; q[tail++] = p + 1; }
      if (yy > 0 && !visited[p - w] && !wall[p - w]) { visited[p - w] = 1; q[tail++] = p - w; }
      if (yy < h - 1 && !visited[p + w] && !wall[p + w]) { visited[p + w] = 1; q[tail++] = p + w; }
    }

    // 浸透した背景部分のみを透明化
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

  $("#bgAutoTransparentToggle").onchange = e => {
    bgTransparent = e.target.checked;
    $("#transSettingsBody").classList.toggle("hidden", !bgTransparent);
    updateIllustCache();
    renderPreview();
    scheduleAutoSave();
  };

  $("#protectWhiteToggle").onchange = e => {
    protectWhite = e.target.checked;
    updateIllustCache();
    renderPreview();
    scheduleAutoSave();
  };

  $("#gapProtectLevel").onchange = e => {
    gapProtectLevel = Number(e.target.value);
    updateIllustCache();
    renderPreview();
    scheduleAutoSave();
  };

  $("#bgToleranceSlider").oninput = e => {
    bgTolerance = Number(e.target.value);
    $("#bgToleranceVal").textContent = e.target.value;
    updateIllustCache();
    renderPreview();
    scheduleAutoSave();
  };

  $("#illustBorderToggle").onchange = e => {
    illustBorder = e.target.checked;
    $("#illustBorderColorWrap").classList.toggle("hidden", !illustBorder);
    updateIllustCache();
    renderPreview();
    scheduleAutoSave();
  };

  $("#borderWidth").oninput = e => {
    $("#borderWidthValue").textContent = e.target.value;
    if (illustBorder) { updateIllustCache(); renderPreview(); scheduleAutoSave(); }
  };

  document.querySelectorAll("#illustBorderColorList .cBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      illustBorderColor = btn.dataset.color;
      $("#illustBorderColorPicker").value = illustBorderColor;
      updateIllustCache();
      renderPreview();
      scheduleAutoSave();
    };
  });

  $("#illustBorderColorPicker").oninput = e => {
    document.querySelectorAll("#illustBorderColorList .cBtn").forEach(b => b.classList.remove("active"));
    illustBorderColor = e.target.value;
    updateIllustCache();
    renderPreview();
    scheduleAutoSave();
  };

  // 文字パネル関連
  $("#stampText").oninput = e => { textConfig.text = e.target.value; renderPreview(); scheduleAutoSave(); };
  $("#clearTextBtn").onclick = () => { $("#stampText").value = ""; textConfig.text = ""; renderPreview(); scheduleAutoSave(); };
  document.querySelectorAll(".quickWords .qBtn").forEach(btn => {
    btn.onclick = () => { $("#stampText").value = btn.textContent; textConfig.text = btn.textContent; renderPreview(); scheduleAutoSave(); };
  });
  $("#textFont").onchange = e => { textConfig.font = e.target.value; renderPreview(); scheduleAutoSave(); };

  document.querySelectorAll("#textColorList .cBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      textConfig.color = btn.dataset.color;
      $("#textColorPicker").value = textConfig.color;
      renderPreview();
      scheduleAutoSave();
    };
  });
  $("#textColorPicker").oninput = e => {
    document.querySelectorAll("#textColorList .cBtn").forEach(b => b.classList.remove("active"));
    textConfig.color = e.target.value;
    renderPreview();
    scheduleAutoSave();
  };
  document.querySelectorAll("#textStrokeList .sBtn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#textStrokeList .sBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      textConfig.stroke = btn.dataset.stroke;
      renderPreview();
      scheduleAutoSave();
    };
  });

  // 背景パネル関連
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
      updateBgUI();
      syncCommonScaleSlider();
      renderPreview();
      scheduleAutoSave();
    };
  });

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

  $("#removeBgImgBtn").onclick = () => {
    bgConfig.image = null; bgConfig.style = "none";
    $("#bgFileInput").value = "";
    updateBgUI();
    syncCommonScaleSlider();
    renderPreview();
    scheduleAutoSave();
  };

  document.querySelectorAll("#bgColorList .cBtn").forEach(btn => {
    btn.onclick = () => { bgConfig.color = btn.dataset.bg; updateBgUI(); renderPreview(); scheduleAutoSave(); };
  });
  $("#bgColorPicker").oninput = e => {
    bgConfig.color = e.target.value; updateBgUI(); renderPreview(); scheduleAutoSave();
  };

  // ==========================================
  // レンダリング
  // ==========================================
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
      triggerAutoSave();
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
    triggerAutoSave();
  };

  $("#modalDeleteBtn").onclick = () => {
    if (currentModalIndex === null || !results[currentModalIndex]) return;
    if (confirm(`${currentModalIndex + 1}個目を削除しますか？`)) {
      results.splice(currentModalIndex, 1);
      $("#imageModal").classList.remove("show");
      refresh();
      toast("削除しました");
      triggerAutoSave();
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
    if (!$("#adjustStep").classList.contains("hidden")) renderPreview();
  });

  updateMode();
  restoreSavedSession();
});
