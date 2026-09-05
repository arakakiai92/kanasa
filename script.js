// ==========================================
  // 切り出し枠のドラッグ＆誤タップ防止ガード
  // ==========================================
  let cropDrag = null;
  if (wrap) {
    wrap.addEventListener("touchstart", e => {
      if (!img) return;
      const touch = e.touches[0];
      const p = getTouchPos(touch.clientX, touch.clientY);
      const handleEl = e.target.closest(".handle");
      const isInsideCrop = (e.target === crop || (crop && crop.contains(e.target)));

      if (handleEl) {
        // ハンドルをつかんだ時：リサイズ
        e.preventDefault();
        cropDrag = { type: "resize", handle: handleEl.dataset.h, startP: p, orig: { ...selectionRect } };
      } else if (isInsideCrop && selectionRect) {
        // 枠内をつかんだ時：移動
        e.preventDefault();
        cropDrag = { type: "move", startP: p, orig: { ...selectionRect } };
      } else if (!selectionRect) {
        // 枠がまだ無いとき（囲み直しモード時）だけ：新規ドラッグ描画
        e.preventDefault();
        cropDrag = { type: "draw", startP: p, orig: null };
      } else {
        // 枠がすでにある場合、枠外の誤タップ・誤スワイプは無視して枠を完全保護！
        cropDrag = null;
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
  }

  // 枠のリセット・囲み直しボタンの制御
  if ($("#resetCrop")) {
    $("#resetCrop").onclick = () => {
      initOrAdjustSelection();
      toast("枠を中央に戻しました");
    };
  }

  // 指で囲み直すボタン（押すと枠が一時クリアされて指でなぞれる状態になる）
  if ($("#reDrawBtn")) {
    $("#reDrawBtn").onclick = () => {
      resetSelection();
      toast("切り出したい絵を指で囲んでね");
    };
  }

  if ($("#startSelect")) {
    $("#startSelect").onclick = () => {
      initOrAdjustSelection();
      toast("切り出し枠を表示しました！");
    };
  }
