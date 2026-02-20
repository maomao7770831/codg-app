/// CoDG Task (log + end-of-task CoDG estimate)
// 2 faces (M1, F1) × 11 gaze levels × 5 repeats = 110 trials
(() => {
  // ====== 設定 ======
  const GAZE_LEVELS = [-12, -9, -6, -3, -1, 0, 1, 3, 6, 9, 12];
  const FACES = ["M1", "F1"];           // 画像ファイル名の prefix
  const REPEATS = 5;                    // ランダム提示回数
  const EXT = "png";                    // "png" or "jpg" に合わせて変更
  const STIM_DIR = "stimuli";           // 刺激フォルダ名

  // タイミング（ms）
  const FIX_MS = 1000;                  // 十字
  const STIM_MS = 500;                  // 顔画像（反応はその後もOK）
  const POST_RESP_MS = 250;             // 反応後の待ち（誤タップ防止）

  // ====== DOM ======
  const setupCard = document.getElementById("setupCard");
  const taskCard = document.getElementById("taskCard");
  const doneCard = document.getElementById("doneCard");
  const pidInput = document.getElementById("pid");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");

  const fixEl = document.getElementById("fix");
  const stimImg = document.getElementById("stim");
  const trialNumEl = document.getElementById("trialNum");
  const trialTotalEl = document.getElementById("trialTotal");
  const statusEl = document.getElementById("status");
  const doneMsgEl = document.getElementById("doneMsg");
  const assetHintEl = document.getElementById("assetHint");

  const btnLeft = document.getElementById("btnLeft");
  const btnDirect = document.getElementById("btnDirect");
  const btnRight = document.getElementById("btnRight");

  // ====== Calibration DOM（追加済み） ======
  const calibCard = document.getElementById("calibCard");
  const calibStage = document.getElementById("calibStage");
  const calibVideo = document.getElementById("calibVideo");
  const calibCanvas = document.getElementById("calibCanvas");
  const calibBadge = document.getElementById("calibBadge");
  const calibBackBtn = document.getElementById("calibBackBtn");
  const calibOkBtn = document.getElementById("calibOkBtn");

  // ====== 状態 ======
  let trials = [];
  let logs = [];
  let tIndex = 0;
  let awaitingResponse = false;
  let stimOnsetPerf = null;
  let currentTrial = null;

  // ====== Calibration 状態 ======
  let faceDetector = null;
  let cam = null;
  let calibOkFrames = 0;
  let calibRunning = false;

  function nowISO() {
    return new Date().toISOString();
  }

  function userAgent() {
    return navigator.userAgent || "";
  }

  // Fisher–Yates shuffle
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function makeTrialList() {
    const list = [];
    for (const face of FACES) {
      for (const gaze of GAZE_LEVELS) {
        for (let r = 1; r <= REPEATS; r++) {
          const file = `${face}_${gaze}.${EXT}`;
          list.push({
            face_id: face,
            gaze_level: gaze,
            repeat: r,
            image_file: file,
            image_path: `./${STIM_DIR}/${file}`
          });
        }
      }
    }
    return shuffle(list);
  }

  function setButtonsEnabled(enabled) {
    btnLeft.disabled = !enabled;
    btnDirect.disabled = !enabled;
    btnRight.disabled = !enabled;
  }

  function showSetup() {
    setupCard.style.display = "";
    taskCard.style.display = "none";
    doneCard.style.display = "none";
    if (calibCard) calibCard.style.display = "none";
  }

  function showCalib() {
    setupCard.style.display = "none";
    taskCard.style.display = "none";
    doneCard.style.display = "none";
    if (calibCard) calibCard.style.display = "";
  }

  function showTask() {
    setupCard.style.display = "none";
    taskCard.style.display = "";
    doneCard.style.display = "none";
    if (calibCard) calibCard.style.display = "none";
  }

  function showDone(msg) {
    setupCard.style.display = "none";
    taskCard.style.display = "none";
    doneCard.style.display = "";
    if (calibCard) calibCard.style.display = "none";
    doneMsgEl.textContent = msg || "";
  }

  function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // ====== Calibration (楕円枠 + 自動OK判定) ======
  function resizeCalibCanvas() {
    if (!calibStage || !calibCanvas) return;
    const rect = calibStage.getBoundingClientRect();
    calibCanvas.width = Math.round(rect.width * devicePixelRatio);
    calibCanvas.height = Math.round(rect.height * devicePixelRatio);
  }

  function drawOverlay(statusOk, faceBoxPx) {
    const ctx = calibCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, calibCanvas.width, calibCanvas.height);

    const rect = calibStage.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // CSS座標で描画するためにスケール
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // 楕円フレーム（目標）
    const frameW = w * 0.62;
    const frameH = h * 0.72;
    const cx = w / 2;
    const cy = h / 2;

    // 外側を暗くして楕円を抜く
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.ellipse(cx, cy, frameW / 2, frameH / 2, 0, 0, Math.PI * 2);
    ctx.fill("evenodd");

    // 楕円枠
    ctx.lineWidth = 4;
    ctx.strokeStyle = statusOk ? "rgba(0,255,120,0.95)" : "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, frameW / 2, frameH / 2, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 顔bbox（デバッグ用：不要ならコメントアウト可）
    if (faceBoxPx) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = statusOk ? "rgba(0,255,120,0.9)" : "rgba(255,180,0,0.9)";
      ctx.strokeRect(faceBoxPx.x, faceBoxPx.y, faceBoxPx.w, faceBoxPx.h);
    }

    return { cx, cy, frameW, frameH };
  }

  function checkFaceInFrame(faceBox, frame) {
    // 顔bbox中心
    const faceCx = faceBox.x + faceBox.w / 2;
    const faceCy = faceBox.y + faceBox.h / 2;

    // 大きさ：顔の高さが楕円高さに近いか（距離の代理指標）
    const sizeRatio = faceBox.h / frame.frameH; // 1.0付近が理想
    const withinSize = (sizeRatio >= 0.88 && sizeRatio <= 1.12);

    // 中心：顔中心が楕円中心からズレすぎないか
    const dx = Math.abs(faceCx - frame.cx) / frame.frameW;
    const dy = Math.abs(faceCy - frame.cy) / frame.frameH;
    const withinCenter = (dx <= 0.12 && dy <= 0.12);

    return { ok: withinSize && withinCenter, sizeRatio, dx, dy };
  }

  function ensureMediaPipeLoaded() {
    // index.htmlで MediaPipe を読み込んでいないと動かない
    return (typeof FaceDetection !== "undefined") && (typeof Camera !== "undefined");
  }

    async function startCalibration() {
  calibOkBtn.disabled = true;
  calibOkFrames = 0;
  calibRunning = true;

  const say = (t) => { calibBadge.textContent = t; console.log("[calib]", t); };

  try {
    say("1/8: 開始ボタン押下OK");

    // 重要：API存在チェック
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say("❌ mediaDevices/getUserMedia が使えません。Safariで開いてますか？（アプリ内ブラウザだと不可なことが多い）");
      calibRunning = false;
      return;
    }
    say("2/8: getUserMedia API OK");

    resizeCalibCanvas();
    window.addEventListener("resize", resizeCalibCanvas);
    say("3/8: canvas準備OK");

    // FaceDetection 読み込みチェック
    if (typeof FaceDetection === "undefined") {
      say("❌ FaceDetectionが未定義。index.htmlでmediapipe scriptがtask.jsより先か確認");
      calibRunning = false;
      return;
    }
    say("4/8: FaceDetection OK");

    // FaceDetection初期化
    faceDetector = new FaceDetection.FaceDetection({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
    });
    faceDetector.setOptions({ model: "short", minDetectionConfidence: 0.6 });
    say("5/8: FaceDetection 初期化OK");

    faceDetector.onResults((results) => {
      if (!calibRunning) return;

      const rect = calibStage.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      if (results.detections && results.detections.length > 0) {
        const det = results.detections[0];
        const rb = det.locationData?.relativeBoundingBox;
        if (!rb) {
          drawOverlay(false, null);
          calibOkFrames = 0;
          calibOkBtn.disabled = true;
          calibBadge.textContent = "顔情報取得に失敗（別ブラウザ/別端末）";
          return;
        }

        const faceBoxPx = {
          x: rb.xMin * w, y: rb.yMin * h,
          w: rb.width * w, h: rb.height * h
        };

        const frame = drawOverlay(false, faceBoxPx);
        const chk = checkFaceInFrame(faceBoxPx, frame);

        if (chk.ok) calibOkFrames += 1;
        else calibOkFrames = 0;

        const stable = calibOkFrames >= 10;
        if (stable) {
          drawOverlay(true, faceBoxPx);
          calibBadge.textContent = "OK！その距離で固定してください";
          calibOkBtn.disabled = false;
        } else {
          calibBadge.textContent = "調整中…（顔を楕円枠にぴったり）";
          calibOkBtn.disabled = true;
        }
      } else {
        drawOverlay(false, null);
        calibOkFrames = 0;
        calibBadge.textContent = "顔が見つかりません（明るい場所で正面を向いて）";
        calibOkBtn.disabled = true;
      }
    });

    // ここが本丸：カメラ起動
    say("6/8: getUserMedia 呼び出し中…");

    // ★iPhoneで安定しやすい設定（facingModeは object で指定）
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    };

    // ★タイムアウトを付ける（固まり対策）
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia(constraints),
      new Promise((_, rej) => setTimeout(() => rej(new Error("getUserMedia_timeout")), 8000))
    ]);

    say("7/8: stream取得OK");

    calibVideo.srcObject = stream;

    // iOSはメタデータ待ちが必須級
    await Promise.race([
      new Promise((res) => { calibVideo.onloadedmetadata = () => res(); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("metadata_timeout")), 5000))
    ]);

    say("8/8: metadata OK → play()");

    await calibVideo.play();
    say("🎥 カメラ起動完了：解析開始中…");

    const loop = async () => {
      if (!calibRunning) return;
      try {
        await faceDetector.send({ image: calibVideo });
      } catch (e) {
        calibBadge.textContent = `解析エラー: ${e?.name || "unknown"}`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

  } catch (e) {
    const name = e?.name || "Error";
    const msg = e?.message || String(e);
    calibBadge.textContent = `❌ カメラ起動失敗: ${name} ${msg}`;
    calibRunning = false;
    console.error(e);
  }
}

   async function stopCalibration() {
    calibRunning = false;
    window.removeEventListener("resize", resizeCalibCanvas);

    // getUserMediaの停止（重要）
    try {
      const stream = calibVideo.srcObject;
      if (stream && stream.getTracks) {
        stream.getTracks().forEach(t => t.stop());
      }
    } catch (_) {}

    calibVideo.srcObject = null;
    faceDetector = null;
    calibOkFrames = 0;
  }

  // ====== CoDG 推定（終了時）======

  function sigmoid(t) {
    return 1 / (1 + Math.exp(-t));
  }

  function solve2x2(a11, a12, a21, a22, b1, b2) {
    const det = a11 * a22 - a12 * a21;
    if (Math.abs(det) < 1e-12) return null;
    return [
      ( b1 * a22 - b2 * a12) / det,
      (-b1 * a21 + b2 * a11) / det
    ];
  }

  // IRLS ロジスティック回帰（binomial: y successes out of n）
  // p(x) = sigmoid(b0 + b1*x)
  function fitLogisticIRLS(xs, ys, ns, maxIter = 50) {
    let b0 = 0, b1 = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      let a11 = 0, a12 = 0, a22 = 0;
      let c1 = 0, c2 = 0;

      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const n = ns[i];
        const y = ys[i];

        const eta = b0 + b1 * x;
        let p = sigmoid(eta);
        p = Math.min(1 - 1e-6, Math.max(1e-6, p));

        const w = n * p * (1 - p);
        const z = eta + (y - n * p) / (n * p * (1 - p));

        a11 += w;
        a12 += w * x;
        a22 += w * x * x;

        c1 += w * z;
        c2 += w * x * z;
      }

      // リッジ（特異対策）
      const ridge = 1e-6;
      a11 += ridge;
      a22 += ridge;

      const sol = solve2x2(a11, a12, a12, a22, c1, c2);
      if (!sol) return null;

      const newB0 = sol[0];
      const newB1 = sol[1];

      const maxDelta = Math.max(Math.abs(newB0 - b0), Math.abs(newB1 - b1));
      b0 = newB0;
      b1 = newB1;

      if (maxDelta < 1e-6) break;
    }

    return { b0, b1 };
  }

  function aggregateByGazeLevel(logs, faceFilter = null) {
    const map = new Map(); // gaze -> {n,left,right}
    for (const row of logs) {
      if (faceFilter && row.face_id !== faceFilter) continue;
      const x = Number(row.gaze_level);
      if (!map.has(x)) map.set(x, { n: 0, left: 0, right: 0 });
      const obj = map.get(x);
      obj.n += 1;
      if (row.response === "Left") obj.left += 1;
      if (row.response === "Right") obj.right += 1;
    }

    const xs = Array.from(map.keys()).sort((a, b) => a - b);
    const ns = xs.map(x => map.get(x).n);
    const lefts = xs.map(x => map.get(x).left);
    const rights = xs.map(x => map.get(x).right);
    return { xs, ns, lefts, rights };
  }

  function findRootBisection(f, a, b, tol = 1e-4, maxIter = 80) {
    let fa = f(a), fb = f(b);
    if (Number.isNaN(fa) || Number.isNaN(fb)) return null;
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (fa * fb > 0) return null;

    let lo = a, hi = b;
    for (let i = 0; i < maxIter; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Number.isNaN(fm)) return null;
      if (Math.abs(fm) < tol) return mid;
      if (fa * fm <= 0) {
        hi = mid;
        fb = fm;
      } else {
        lo = mid;
        fa = fm;
      }
    }
    return (lo + hi) / 2;
  }

  function estimateCoDGFromLogs(logs, gazeMin = -12, gazeMax = 12, faceFilter = null) {
    const { xs, ns, lefts, rights } = aggregateByGazeLevel(logs, faceFilter);

    const totalN = ns.reduce((a, b) => a + b, 0);
    if (xs.length < 5 || totalN < 30) {
      return { codg: null, x_left: null, x_right: null, note: "insufficient_data" };
    }

    const fitL = fitLogisticIRLS(xs, lefts, ns);
    const fitR = fitLogisticIRLS(xs, rights, ns);
    if (!fitL || !fitR) {
      return { codg: null, x_left: null, x_right: null, note: "fit_failed" };
    }

    const pL = (x) => sigmoid(fitL.b0 + fitL.b1 * x);
    const pR = (x) => sigmoid(fitR.b0 + fitR.b1 * x);

    const fLeft = (x) => (2 * pL(x) + pR(x) - 1);
    const fRight = (x) => (pL(x) + 2 * pR(x) - 1);

    function scanForRoot(f, preferNegative) {
      const step = 0.25;
      let prevX = gazeMin;
      let prevF = f(prevX);

      const candidates = [];
      for (let x = gazeMin + step; x <= gazeMax + 1e-9; x += step) {
        const fx = f(x);
        if (!Number.isNaN(prevF) && !Number.isNaN(fx) && prevF * fx <= 0) {
          const root = findRootBisection(f, prevX, x);
          if (root !== null) candidates.push(root);
        }
        prevX = x;
        prevF = fx;
      }

      if (candidates.length === 0) return null;

      if (preferNegative) {
        const negs = candidates.filter(v => v <= 0);
        return (negs.length ? negs[negs.length - 1] : candidates[0]);
      } else {
        const poss = candidates.filter(v => v >= 0);
        return (poss.length ? poss[0] : candidates[candidates.length - 1]);
      }
    }

    const x_left = scanForRoot(fLeft, true);
    const x_right = scanForRoot(fRight, false);

    if (x_left === null || x_right === null) {
      return { codg: null, x_left, x_right, note: "intersection_not_found", fitL, fitR };
    }

    return { codg: (x_right - x_left), x_left, x_right, note: "ok", fitL, fitR };
  }

  // ====== 実行 ======

  async function runTrial(trial) {
    currentTrial = trial;
    awaitingResponse = false;
    stimOnsetPerf = null;

    // Fixation
    fixEl.textContent = "+";
    stimImg.style.opacity = "0";
    setButtonsEnabled(false);
    statusEl.textContent = "fix";
    await sleep(FIX_MS);

    // Stimulus（画像読み込み完了を待ってから表示）
    fixEl.textContent = "";
    setButtonsEnabled(true);
    awaitingResponse = true;

    // 先に消してからsrcを変える（前の画像チラ見え防止）
    stimImg.style.opacity = "0";

    await new Promise((resolve) => {
      stimImg.onload = () => resolve();
      stimImg.onerror = () => resolve();
      stimImg.src = trial.image_path;
    });

    stimImg.style.opacity = "1";
    statusEl.textContent = "stim";
    stimOnsetPerf = performance.now();

    await sleep(STIM_MS);
    if (awaitingResponse) {
      stimImg.style.opacity = "0";
      statusEl.textContent = "respond";
    }
  }

  function recordResponse(respLabel) {
    if (!awaitingResponse) return;

    const rt = Math.round(performance.now() - stimOnsetPerf);
    awaitingResponse = false;
    setButtonsEnabled(false);

    const pid = (pidInput.value || "").trim();
    const trialNo = tIndex + 1;

    logs.push({
      participant_id: pid,
      trial_index: trialNo,
      face_id: currentTrial.face_id,
      gaze_level: currentTrial.gaze_level,
      repeat: currentTrial.repeat,
      image_file: currentTrial.image_file,
      response: respLabel,          // Left / Direct / Right
      rt_ms: rt,
      presented_at_iso: nowISO(),
      device: userAgent()
    });

    (async () => {
      await sleep(POST_RESP_MS);
      nextTrial();
    })();
  }

  function csvEscape(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCSV(rows, filename) {
    const cols = Object.keys(rows[0] || { participant_id: "" });
    const header = cols.join(",");
    const lines = rows.map(r => cols.map(c => csvEscape(r[c])).join(","));
    const csv = [header, ...lines].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function nextTrial() {
    tIndex += 1;
    if (tIndex >= trials.length) {
      finishTask();
      return;
    }
    trialNumEl.textContent = String(tIndex + 1);
    runTrial(trials[tIndex]);
  }

  function finishTask() {
    const pid = (pidInput.value || "").trim();
    const safePid = pid ? pid.replace(/[^\w\-]/g, "_") : "noid";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    // ① trialログCSV
    const fnameTrials = `codg_trials_${safePid}_${stamp}.csv`;
    if (logs.length > 0) {
      downloadCSV(logs, fnameTrials);
    }

    // ② CoDG 推定（男女まとめ）
    const estAll = estimateCoDGFromLogs(logs, -12, 12, null);

    // ③ summary CSV
    const summary = [{
      participant_id: pid,
      codg: estAll.codg,
      x_left: estAll.x_left,
      x_right: estAll.x_right,
      note: estAll.note,
      b0_left: estAll.fitL ? estAll.fitL.b0 : null,
      b1_left: estAll.fitL ? estAll.fitL.b1 : null,
      b0_right: estAll.fitR ? estAll.fitR.b0 : null,
      b1_right: estAll.fitR ? estAll.fitR.b1 : null,
      n_trials: logs.length,
      finished_at_iso: nowISO(),
      device: userAgent()
    }];

    const fnameSummary = `codg_summary_${safePid}_${stamp}.csv`;
    downloadCSV(summary, fnameSummary);

    // ④ 画面表示（ユーザー向け）
    let msg = "CSVを保存しました。必要ならもう一度実施できます。\n\n";

    if (estAll.codg === null) {
      msg += "⚠️ CoDGを計算できませんでした。\n";
      msg += `理由：${estAll.note}\n`;
      msg += "（反応が極端に偏った場合などに起こります。データ自体は保存されています。）\n\n";
    } else {
      msg += `🎉 あなたのCoDGは【${estAll.codg.toFixed(3)}】でした！\n`;
      msg += "（値が大きいほど、「自分を見ている」と判断する範囲が広い傾向を表します）\n\n";
      msg += `【詳細】左境界 L=${estAll.x_left.toFixed(3)} / 右境界 R=${estAll.x_right.toFixed(3)}\n\n`;
    }

    msg += `保存したファイル：\n- ${fnameTrials}\n- ${fnameSummary}\n`;
    msg += `試行数：${logs.length}`;

    showDone(msg);
  }

  function validateAssetsHint() {
    const examples = [
      `${FACES[0]}_${GAZE_LEVELS[0]}.${EXT}`,
      `${FACES[0]}_${GAZE_LEVELS[5]}.${EXT}`,
      `${FACES[1]}_${GAZE_LEVELS[10]}.${EXT}`
    ];
    assetHintEl.textContent = `画像は ./stimuli/ に置いてください。例: ${examples.join(" , ")}`;
  }

  function startTask() {
    const pid = (pidInput.value || "").trim();
    if (!pid) {
      alert("参加者IDを入力してください（例: P001）");
      return;
    }

    logs = [];
    trials = makeTrialList();
    tIndex = 0;

    trialTotalEl.textContent = String(trials.length);
    trialNumEl.textContent = "1";

    // ★ここで校正画面へ
    showCalib();
    startCalibration();
  }

  // ====== イベント ======
  startBtn.addEventListener("click", startTask);

  restartBtn.addEventListener("click", () => {
    showSetup();
  });

  // 校正画面：戻る / OK
  if (calibBackBtn) {
    calibBackBtn.addEventListener("click", async () => {
      await stopCalibration();
      showSetup();
    });
  }

  if (calibOkBtn) {
    calibOkBtn.addEventListener("click", async () => {
      await stopCalibration();
      showTask();
      runTrial(trials[0]);
    });
  }

  btnLeft.addEventListener("click", () => recordResponse("Left"));
  btnDirect.addEventListener("click", () => recordResponse("Direct"));
  btnRight.addEventListener("click", () => recordResponse("Right"));

  // 初期表示
  validateAssetsHint();
  showSetup();
})();

