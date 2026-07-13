export default function(component) {
  const { parentElement } = component;

  // Prevent duplicate initialization if Streamlit remounts the component.
  if (parentElement.__gesturePuzzleMounted) {
    return () => {};
  }
  parentElement.__gesturePuzzleMounted = true;

  (async () => {

  const root = parentElement.querySelector(".gp-app");
  if (!root) return;

  const video = root.querySelector(".gp-video");
  const canvas = root.querySelector(".gp-canvas");
  const ctx = canvas.getContext("2d", {alpha: false});
  const loading = root.querySelector(".gp-loading");
  const loadingText = root.querySelector(".gp-loading-text");
  const statusEl = root.querySelector(".gp-status");
  const startBtn = root.querySelector(".gp-start");
  const captureBtn = root.querySelector(".gp-capture");
  const resetBtn = root.querySelector(".gp-reset");
  const stopBtn = root.querySelector(".gp-stop");

  const MP_VERSION = "0.4.1675469240";
  const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VERSION}`;

  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
  ];
  const TIP_IDS = new Set([4,8,12,16,20]);

  let handsModel = null;
  let stream = null;
  let running = false;
  let processing = false;
  let rafId = null;

  let state = "idle"; // idle | camera | countdown | captured | puzzle | solved
  let latestHands = [];
  let capturedCanvas = null;
  let capturedAt = 0;
  let countdownEnd = 0;
  let frameGestureSince = null;

  let order = [...Array(9).keys()];
  let grabbed = null;
  let pointer = {x: 0, y: 0};
  let pinchPreviouslyDown = false;
  let lastActiveHandCenter = null;

  function setStatus(text) {
    statusEl.innerHTML = text;
  }

  function setLoading(show, text="Memuat…") {
    loadingText.textContent = text;
    loading.classList.toggle("gp-hidden", !show);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const found = [...document.scripts].find(s => s.src === src);
      if (found) {
        if (window.Hands) return resolve();
        found.addEventListener("load", resolve, {once: true});
        found.addEventListener("error", reject, {once: true});
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Gagal memuat " + src));
      document.head.appendChild(script);
    });
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function angleDeg(a, b, c) {
    const abx = a.x - b.x;
    const aby = a.y - b.y;
    const cbx = c.x - b.x;
    const cby = c.y - b.y;
    const dot = abx * cbx + aby * cby;
    const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
    if (!mag) return 0;
    const cosValue = Math.max(-1, Math.min(1, dot / mag));
    return Math.acos(cosValue) * 180 / Math.PI;
  }

  function vectorAngleDeg(ax, ay, bx, by) {
    const dot = ax * bx + ay * by;
    const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (!mag) return 0;
    const cosValue = Math.max(-1, Math.min(1, dot / mag));
    return Math.acos(cosValue) * 180 / Math.PI;
  }

  function mirrorLandmarks(normalized) {
    return normalized.map(p => ({
      x: (1 - p.x) * canvas.width,
      y: p.y * canvas.height,
      z: p.z || 0
    }));
  }

  function drawMirroredVideo() {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawRoundedRect(x, y, w, h, radius, fill, stroke=null, lineWidth=1) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawBanner(text, position="top-left", accent=false) {
    ctx.save();
    ctx.font = `700 ${Math.max(18, canvas.width * 0.021)}px Arial`;
    const padX = 18;
    const padY = 12;
    const metrics = ctx.measureText(text);
    const w = metrics.width + padX * 2;
    const h = Math.max(46, canvas.height * 0.075);
    const margin = 18;
    let x = margin;
    let y = margin;
    if (position === "top-right") x = canvas.width - w - margin;
    drawRoundedRect(
      x, y, w, h, 12,
      accent ? "rgba(22,255,103,.91)" : "rgba(5,12,8,.78)",
      accent ? "rgba(255,255,255,.35)" : "rgba(86,255,146,.35)",
      2
    );
    ctx.fillStyle = accent ? "#06210e" : "#eafff0";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padX, y + h / 2 + 1);
    ctx.restore();
  }

  function drawHands(hands) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const hand of hands) {
      ctx.strokeStyle = "#38ff7d";
      ctx.lineWidth = Math.max(3, canvas.width / 320);
      ctx.shadowColor = "rgba(50,255,125,.75)";
      ctx.shadowBlur = 8;

      for (const [a, b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(hand[a].x, hand[a].y);
        ctx.lineTo(hand[b].x, hand[b].y);
        ctx.stroke();
      }

      for (let i = 0; i < hand.length; i++) {
        const p = hand[i];
        const radius = TIP_IDS.has(i)
          ? Math.max(6, canvas.width / 145)
          : Math.max(4, canvas.width / 220);

        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#47ff86";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(4,42,18,.9)";
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function fingerStraight(hand, mcp, pip, tip) {
    const jointAngle = angleDeg(hand[mcp], hand[pip], hand[tip]);
    const reachRatio = dist(hand[0], hand[tip]) / Math.max(1, dist(hand[0], hand[pip]));
    return jointAngle > 148 && reachRatio > 1.08;
  }

  function thumbStraight(hand) {
    const jointAngle = angleDeg(hand[2], hand[3], hand[4]);
    const reachRatio = dist(hand[1], hand[4]) / Math.max(1, dist(hand[1], hand[3]));
    return jointAngle > 142 && reachRatio > 1.12;
  }

  function isLShape(hand) {
    const indexOpen = fingerStraight(hand, 5, 6, 8);
    const middleOpen = fingerStraight(hand, 9, 10, 12);
    const ringOpen = fingerStraight(hand, 13, 14, 16);
    const pinkyOpen = fingerStraight(hand, 17, 18, 20);
    const thumbOpen = thumbStraight(hand);

    const ivx = hand[8].x - hand[5].x;
    const ivy = hand[8].y - hand[5].y;
    const tvx = hand[4].x - hand[2].x;
    const tvy = hand[4].y - hand[2].y;
    const openingAngle = vectorAngleDeg(ivx, ivy, tvx, tvy);

    const foldedCount = [middleOpen, ringOpen, pinkyOpen].filter(v => !v).length;
    return indexOpen && thumbOpen && foldedCount >= 2 &&
           openingAngle > 50 && openingAngle < 135;
  }

  function detectFrameGesture(hands) {
    if (hands.length < 2) return {ok: false, bbox: null};

    const l0 = isLShape(hands[0]);
    const l1 = isLShape(hands[1]);
    if (!l0 || !l1) return {ok: false, bbox: null};

    const c0 = {
      x: (hands[0][4].x + hands[0][8].x) / 2,
      y: (hands[0][4].y + hands[0][8].y) / 2
    };
    const c1 = {
      x: (hands[1][4].x + hands[1][8].x) / 2,
      y: (hands[1][4].y + hands[1][8].y) / 2
    };

    const pts = [hands[0][4], hands[0][8], hands[1][4], hands[1][8]];
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));

    const diagonalEnough =
      Math.abs(c0.x - c1.x) > canvas.width * 0.18 &&
      Math.abs(c0.y - c1.y) > canvas.height * 0.18;

    const frameLargeEnough =
      (maxX - minX) > canvas.width * 0.28 &&
      (maxY - minY) > canvas.height * 0.28;

    return {
      ok: diagonalEnough && frameLargeEnough,
      bbox: {minX, minY, maxX, maxY}
    };
  }

  function drawFrameGuide(frameInfo) {
    if (!frameInfo?.bbox) return;
    const b = frameInfo.bbox;
    ctx.save();
    ctx.strokeStyle = frameInfo.ok ? "#57ff91" : "rgba(255,255,255,.45)";
    ctx.lineWidth = Math.max(3, canvas.width / 300);
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.restore();
  }

  function captureCleanFrame() {
    if (!running || video.readyState < 2) return;

    capturedCanvas = document.createElement("canvas");
    capturedCanvas.width = canvas.width;
    capturedCanvas.height = canvas.height;
    const cctx = capturedCanvas.getContext("2d", {alpha: false});

    cctx.save();
    cctx.translate(capturedCanvas.width, 0);
    cctx.scale(-1, 1);
    cctx.drawImage(video, 0, 0, capturedCanvas.width, capturedCanvas.height);
    cctx.restore();

    state = "captured";
    capturedAt = performance.now();
    frameGestureSince = null;
    grabbed = null;
    pinchPreviouslyDown = false;
    setStatus("📸 Foto berhasil diambil. Puzzle akan diacak dalam <b>2 detik</b>…");

    // Efek flash
    ctx.save();
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function shuffledOrder() {
    let result;
    do {
      result = [...Array(9).keys()];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
    } while (
      result.every((v, i) => v === i) ||
      result.filter((v, i) => v !== i).length < 6
    );
    return result;
  }

  function startPuzzle() {
    if (!capturedCanvas) return;
    order = shuffledOrder();
    state = "puzzle";
    grabbed = null;
    pinchPreviouslyDown = false;
    lastActiveHandCenter = null;
    setStatus(
      "🧩 Puzzle dimulai. <b>Cubit ibu jari + telunjuk</b> pada tile, geser ke tile tujuan, lalu buka cubitan untuk melakukan swap."
    );
  }

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return -1;
    const col = Math.min(2, Math.floor(x / (canvas.width / 3)));
    const row = Math.min(2, Math.floor(y / (canvas.height / 3)));
    return row * 3 + col;
  }

  function handPinchData(hand) {
    const center = {
      x: (hand[4].x + hand[8].x) / 2,
      y: (hand[4].y + hand[8].y) / 2
    };
    const palmScale = Math.max(1, dist(hand[5], hand[17]));
    const ratio = dist(hand[4], hand[8]) / palmScale;
    return {hand, center, ratio};
  }

  function chooseActiveHand(hands) {
    if (!hands.length) return null;
    const items = hands.map(handPinchData);

    if (lastActiveHandCenter) {
      items.sort((a, b) =>
        dist(a.center, lastActiveHandCenter) - dist(b.center, lastActiveHandCenter)
      );
      const nearest = items[0];
      if (dist(nearest.center, lastActiveHandCenter) < canvas.width * 0.25) {
        return nearest;
      }
    }

    items.sort((a, b) => a.ratio - b.ratio);
    return items[0];
  }

  function processPuzzleGesture(hands) {
    const active = chooseActiveHand(hands);

    if (!active) {
      if (grabbed) {
        const target = cellAt(pointer.x, pointer.y);
        dropTile(target);
      }
      pinchPreviouslyDown = false;
      lastActiveHandCenter = null;
      return;
    }

    pointer = active.center;
    lastActiveHandCenter = active.center;

    const pinchDownThreshold = 0.42;
    const pinchReleaseThreshold = 0.60;
    const pinchDown = grabbed
      ? active.ratio < pinchReleaseThreshold
      : active.ratio < pinchDownThreshold;

    if (!grabbed && pinchDown && !pinchPreviouslyDown) {
      const selectedCell = cellAt(pointer.x, pointer.y);
      if (selectedCell >= 0) {
        grabbed = {
          cell: selectedCell,
          tile: order[selectedCell]
        };
        setStatus("🤏 Tile dipilih. Tahan cubitan, lalu geser ke posisi tujuan.");
      }
    }

    if (grabbed && !pinchDown) {
      const target = cellAt(pointer.x, pointer.y);
      dropTile(target);
    }

    pinchPreviouslyDown = pinchDown;
  }

  function dropTile(targetCell) {
    if (!grabbed) return;

    const sourceCell = grabbed.cell;
    if (targetCell >= 0 && targetCell !== sourceCell) {
      [order[sourceCell], order[targetCell]] =
        [order[targetCell], order[sourceCell]];
    }

    grabbed = null;
    pinchPreviouslyDown = false;
    lastActiveHandCenter = null;

    if (order.every((v, i) => v === i)) {
      state = "solved";
      setStatus("🎉 <b>Cihuuyy benar!</b> Puzzle berhasil disusun.");
    } else {
      setStatus(
        "🧩 Tile sudah ditukar. Lanjutkan sampai fotonya kembali ke susunan awal."
      );
    }
  }

  function drawPuzzle() {
    if (!capturedCanvas) return;

    const cellW = canvas.width / 3;
    const cellH = canvas.height / 3;
    ctx.fillStyle = "#07110b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let dest = 0; dest < 9; dest++) {
      const col = dest % 3;
      const row = Math.floor(dest / 3);
      const dx = col * cellW;
      const dy = row * cellH;

      if (grabbed && dest === grabbed.cell) {
        ctx.fillStyle = "rgba(40,255,112,.10)";
        ctx.fillRect(dx, dy, cellW, cellH);
        continue;
      }

      const tile = order[dest];
      const srcCol = tile % 3;
      const srcRow = Math.floor(tile / 3);
      const sx = srcCol * (capturedCanvas.width / 3);
      const sy = srcRow * (capturedCanvas.height / 3);
      const sw = capturedCanvas.width / 3;
      const sh = capturedCanvas.height / 3;

      ctx.drawImage(
        capturedCanvas,
        sx, sy, sw, sh,
        dx, dy, cellW, cellH
      );
    }

    // Highlight target saat drag
    if (grabbed) {
      const target = cellAt(pointer.x, pointer.y);
      if (target >= 0) {
        const col = target % 3;
        const row = Math.floor(target / 3);
        ctx.save();
        ctx.fillStyle = "rgba(66,255,130,.16)";
        ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
        ctx.strokeStyle = "#5cff96";
        ctx.lineWidth = Math.max(4, canvas.width / 260);
        ctx.strokeRect(
          col * cellW + 3,
          row * cellH + 3,
          cellW - 6,
          cellH - 6
        );
        ctx.restore();
      }
    }

    // Garis grid
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.68)";
    ctx.lineWidth = Math.max(2, canvas.width / 520);
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellW, 0);
      ctx.lineTo(i * cellW, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * cellH);
      ctx.lineTo(canvas.width, i * cellH);
      ctx.stroke();
    }
    ctx.restore();

    // Tile yang sedang di-drag
    if (grabbed) {
      const tile = grabbed.tile;
      const srcCol = tile % 3;
      const srcRow = Math.floor(tile / 3);
      const sw = capturedCanvas.width / 3;
      const sh = capturedCanvas.height / 3;
      const sx = srcCol * sw;
      const sy = srcRow * sh;

      const dragW = cellW * 0.88;
      const dragH = cellH * 0.88;
      const dx = pointer.x - dragW / 2;
      const dy = pointer.y - dragH / 2;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.65)";
      ctx.shadowBlur = 24;
      ctx.drawImage(
        capturedCanvas,
        sx, sy, sw, sh,
        dx, dy, dragW, dragH
      );
      ctx.strokeStyle = "#56ff91";
      ctx.lineWidth = Math.max(4, canvas.width / 240);
      ctx.strokeRect(dx, dy, dragW, dragH);
      ctx.restore();
    }

    drawBanner(grabbed ? "Tahan cubitan dan geser" : "Cubit tile untuk memilih");
  }

  function drawSolved() {
    if (!capturedCanvas) return;
    ctx.drawImage(capturedCanvas, 0, 0, canvas.width, canvas.height);

    // Sedikit gelap di pojok agar tulisan jelas
    const grad = ctx.createLinearGradient(canvas.width * 0.55, 0, canvas.width, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,.36)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawBanner("Cihuuyy benar! 🎉", "top-right", true);
  }

  function renderCapturedWait() {
    if (!capturedCanvas) return;
    ctx.drawImage(capturedCanvas, 0, 0, canvas.width, canvas.height);
    const remaining = Math.max(
      0,
      2 - (performance.now() - capturedAt) / 1000
    );
    drawBanner(`Foto diacak dalam ${remaining.toFixed(1)} detik`);
  }

  function onResults(results) {
    if (!running) return;

    latestHands = (results.multiHandLandmarks || []).map(mirrorLandmarks);
    const now = performance.now();

    if (state === "camera" || state === "countdown") {
      drawMirroredVideo();
      drawHands(latestHands);

      if (state === "camera") {
        const frameInfo = detectFrameGesture(latestHands);
        drawFrameGuide(frameInfo);

        if (frameInfo.ok) {
          if (frameGestureSince === null) frameGestureSince = now;
          const stableFor = now - frameGestureSince;
          drawBanner(
            stableFor > 450
              ? "Bingkai terdeteksi!"
              : "Tahan posisi sebentar…"
          );

          if (stableFor > 650) {
            state = "countdown";
            countdownEnd = now + 3000;
            setStatus(
              "✅ Bingkai terdeteksi. Pertahankan pose, foto diambil setelah countdown."
            );
          }
        } else {
          frameGestureSince = null;
          drawBanner("Bentuk bingkai dengan dua tangan");
        }
      }

      if (state === "countdown") {
        const remainingMs = countdownEnd - now;
        if (remainingMs <= 0) {
          captureCleanFrame();
        } else {
          const number = Math.ceil(remainingMs / 1000);
          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,.25)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `900 ${Math.max(110, canvas.height * 0.34)}px Arial`;
          ctx.lineWidth = Math.max(10, canvas.width / 100);
          ctx.strokeStyle = "rgba(0,0,0,.55)";
          ctx.strokeText(String(number), canvas.width / 2, canvas.height / 2);
          ctx.fillStyle = "#58ff92";
          ctx.fillText(String(number), canvas.width / 2, canvas.height / 2);
          ctx.restore();
        }
      }
      return;
    }

    if (state === "captured") {
      renderCapturedWait();
      if (now - capturedAt >= 2000) startPuzzle();
      return;
    }

    if (state === "puzzle") {
      processPuzzleGesture(latestHands);
      drawPuzzle();
      drawHands(latestHands);
      return;
    }

    if (state === "solved") {
      drawSolved();
    }
  }

  async function inferenceLoop() {
    if (!running) return;

    if (!processing && video.readyState >= 2 && handsModel) {
      processing = true;
      try {
        await handsModel.send({image: video});
      } catch (err) {
        console.error(err);
        setStatus(
          "⚠️ Proses hand tracking sempat gagal. Coba klik <b>Ulangi</b> atau jalankan ulang cell."
        );
      } finally {
        processing = false;
      }
    }

    rafId = requestAnimationFrame(inferenceLoop);
  }

  async function startCamera() {
    if (running) return;

    try {
      startBtn.disabled = true;
      setLoading(true, "Memuat model deteksi tangan…");
      setStatus("Memuat MediaPipe Hands dari internet…");

      if (!window.Hands) {
        await loadScript(`${MP_BASE}/hands.js`);
      }

      handsModel = new window.Hands({
        locateFile: file => `${MP_BASE}/${file}`
      });

      handsModel.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
      });

      handsModel.onResults(onResults);

      setLoading(true, "Meminta izin kamera…");
      setStatus(
        "Browser akan meminta izin kamera. Pilih <b>Allow / Izinkan</b>."
      );

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: {ideal: 1280},
          height: {ideal: 720}
        },
        audio: false
      });

      video.srcObject = stream;
      await video.play();

      await new Promise(resolve => {
        if (video.videoWidth && video.videoHeight) return resolve();
        video.addEventListener("loadedmetadata", resolve, {once: true});
      });

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      running = true;
      state = "camera";
      setLoading(false);
      captureBtn.disabled = false;
      resetBtn.disabled = false;
      stopBtn.disabled = false;

      setStatus(
        "🟢 Kamera aktif. Bentuk <b>bingkai kotak dengan dua tangan berbentuk L</b> pada sudut berlawanan."
      );

      inferenceLoop();
    } catch (err) {
      console.error(err);
      startBtn.disabled = false;
      setLoading(true, "Kamera tidak dapat dibuka");
      setStatus(
        "❌ Kamera tidak dapat diakses. Pastikan browser mendapat izin kamera, tidak sedang dipakai aplikasi lain, lalu klik <b>Mulai Kamera</b> lagi.<br><small>" +
        String(err.message || err) +
        "</small>"
      );
    }
  }

  function resetGame() {
    if (!running) return;
    state = "camera";
    capturedCanvas = null;
    order = [...Array(9).keys()];
    grabbed = null;
    pointer = {x: 0, y: 0};
    pinchPreviouslyDown = false;
    lastActiveHandCenter = null;
    frameGestureSince = null;
    countdownEnd = 0;
    capturedAt = 0;
    setStatus(
      "🔄 Diulang. Bentuk kembali bingkai dengan dua tangan untuk mengambil foto baru."
    );
  }

  async function stopCamera() {
    running = false;
    state = "idle";
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    if (video.srcObject) video.srcObject = null;

    try {
      if (handsModel && typeof handsModel.close === "function") {
        await handsModel.close();
      }
    } catch (_) {}

    handsModel = null;
    latestHands = [];
    capturedCanvas = null;
    startBtn.disabled = false;
    captureBtn.disabled = true;
    resetBtn.disabled = true;
    stopBtn.disabled = true;
    setLoading(true, "Kamera dihentikan");
    setStatus("Kamera dihentikan. Klik <b>Mulai Kamera</b> untuk memulai lagi.");
  }

  startBtn.addEventListener("click", startCamera);
  captureBtn.addEventListener("click", () => {
    if (running && (state === "camera" || state === "countdown")) {
      captureCleanFrame();
    }
  });
  resetBtn.addEventListener("click", resetGame);
  stopBtn.addEventListener("click", stopCamera);

  // Tampilan awal canvas
  canvas.width = 1280;
  canvas.height = 720;
  ctx.fillStyle = "#050806";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 42px Arial";
  ctx.fillStyle = "#dffff0";
  ctx.fillText("Klik “Mulai Kamera”", canvas.width / 2, canvas.height / 2 - 18);
  ctx.font = "400 24px Arial";
  ctx.fillStyle = "#8fb89c";
  ctx.fillText(
    "Hand tracking dan puzzle akan berjalan langsung di browser",
    canvas.width / 2,
    canvas.height / 2 + 34
  );

  })();

  return () => {
    try {
      const stopButton = parentElement.querySelector(".gp-stop");
      if (stopButton && !stopButton.disabled) stopButton.click();
    } catch (error) {
      console.debug("Gesture Puzzle cleanup:", error);
    }
    parentElement.__gesturePuzzleMounted = false;
  };
}
