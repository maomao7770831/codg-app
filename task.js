// CoDG Task (log + end-of-task CoDG estimate)
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

  // ====== 状態 ======
  let trials = [];
  let logs = [];
  let tIndex = 0;
  let awaitingResponse = false;
  let stimOnsetPerf = null;
  let currentTrial = null;

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
  }

  function showTask() {
    setupCard.style.display = "none";
    taskCard.style.display = "";
    doneCard.style.display = "none";
  }

  function showDone(msg) {
    setupCard.style.display = "none";
    taskCard.style.display = "none";
    doneCard.style.display = "";
    doneMsgEl.textContent = msg || "";
  }

  function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
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

    // 交点条件（Direct = 1 - pL - pR を用いる）：
    // Left-Direct: pL = 1 - pL - pR => 2pL + pR - 1 = 0
    // Right-Direct: pR = 1 - pL - pR => pL + 2pR - 1 = 0
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

    // ④ 画面表示
    const codgText =
      (estAll.codg === null)
        ? `CoDG: NA（${estAll.note}）`
        : `CoDG: ${estAll.codg.toFixed(3)} (L=${estAll.x_left.toFixed(3)}, R=${estAll.x_right.toFixed(3)})`;

    showDone(`Saved:\n- ${fnameTrials}\n- ${fnameSummary}\n\n${codgText}\nTrials: ${logs.length}`);
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

    showTask();
    runTrial(trials[0]);
  }

  // ====== イベント ======
  startBtn.addEventListener("click", startTask);
  restartBtn.addEventListener("click", () => {
    showSetup();
  });

  btnLeft.addEventListener("click", () => recordResponse("Left"));
  btnDirect.addEventListener("click", () => recordResponse("Direct"));
  btnRight.addEventListener("click", () => recordResponse("Right"));

  // 初期表示
  validateAssetsHint();
  showSetup();
})();
