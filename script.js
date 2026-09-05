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
    adjustArea.
