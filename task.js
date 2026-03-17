// CoDG Task（カメラなし版）
(() => {

  // ====== 設定 ======
  const GAZE_LEVELS = [-12, -9, -6, -3, -1, 0, 1, 3, 6, 9, 12];
  const FACES = ["M1", "F1"];
  const REPEATS = 5;
  const EXT = "png";
  const STIM_DIR = "stimuli";

  const FIX_MS = 1000;
  const STIM_MS = 500;
  const POST_RESP_MS = 250;

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

  // ====== CoDG計算 ======

  function sigmoid(t) {
    return 1 / (1 + Math.exp(-t));
  }

  function fit(xs, ys, ns) {
    let b0 = 0, b1 = 0;

    for (let iter = 0; iter < 50; iter++) {
      let a11 = 0, a12 = 0, a22 = 0;
      let c1 = 0, c2 = 0;

      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const n = ns[i];
        const y = ys[i];

        const eta = b0 + b1 * x;
        let p = sigmoid(eta);
        p = Math.min(0.999999, Math.max(0.000001, p));

        const w = n * p * (1 - p);
        const z = eta + (y - n * p) / (n * p * (1 - p));

        a11 += w;
        a12 += w * x;
        a22 += w * x * x;

        c1 += w * z;
        c2 += w * x * z;
      }

      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-6) break;

      const newB0 = (c1 * a22 - c2 * a12) / det;
      const newB1 = (c2 * a11 - c1 * a12) / det;

      if (Math.abs(newB0 - b0) < 1e-6 && Math.abs(newB1 - b1) < 1e-6) break;

      b0 = newB0;
      b1 = newB1;
    }

    return { b0, b1 };
  }

  function estimateCoDG() {
    const map = new Map();

    for (const row of logs) {
      const x = row.gaze_level;
      if (!map.has(x)) map.set(x, { n: 0, L: 0, R: 0 });

      const d = map.get(x);
      d.n++;
      if (row.response === "Left") d.L++;
      if (row.response === "Right") d.R++;
    }

    const xs = [...map.keys()].sort((a, b) => a - b);
    const ns = xs.map(x => map.get(x).n);
    const Ls = xs.map(x => map.get(x).L);
    const Rs = xs.map(x => map.get(x).R);

    const fL = fit(xs, Ls, ns);
    const fR = fit(xs, Rs, ns);

    const pL = x => sigmoid(fL.b0 + fL.b1 * x);
    const pR = x => sigmoid(fR.b0 + fR.b1 * x);

    const find = (f) => {
      for (let x = -12; x <= 12; x += 0.25) {
        if (Math.abs(f(x)) < 0.01) return x;
      }
      return null;
    };

    const xL = find(x => 2*pL(x)+pR(x)-1);
    const xR = find(x => pL(x)+2*pR(x)-1);

    if (xL === null || xR === null) return null;

    return {
      codg: xR - xL,
      xL,
      xR
    };
  }

  // ====== 実験 ======

async function runTrial(trial) {
  currentTrial = trial;
  awaitingResponse = false;

  // 注視点
  fixEl.textContent = "+";
  stimImg.style.opacity = "0";
  stimImg.src = ""; // ←これ重要（前の画像を消す）
  setButtonsEnabled(false);
  await sleep(FIX_MS);

  // 刺激
  fixEl.textContent = "";
  setButtonsEnabled(true);
  awaitingResponse = true;

  // 画像を読み込んでから表示（←これが超重要）
  await new Promise((resolve) => {
    stimImg.onload = () => resolve();
    stimImg.onerror = () => resolve();
    stimImg.src = trial.image_path;
  });

  stimImg.style.opacity = "1";
  stimOnsetPerf = performance.now();

  await sleep(STIM_MS);

  if (awaitingResponse) {
    stimImg.style.opacity = "0";
  }
}

  function recordResponse(resp) {
    if (!awaitingResponse) return;

    awaitingResponse = false;
    setButtonsEnabled(false);
    stimImg.style.opacity = "0"; // ←これ追加

    logs.push({
      gaze_level: currentTrial.gaze_level,
      response: resp
    });

    setTimeout(nextTrial, POST_RESP_MS);
  }

  function nextTrial() {
    tIndex++;
    if (tIndex >= trials.length) return finishTask();

    trialNumEl.textContent = tIndex + 1;
    runTrial(trials[tIndex]);
  }

  function finishTask() {
    const est = estimateCoDG();

    let msg = "";
    if (!est) {
      msg = "CoDGを計算できませんでした";
    } else {
      msg = `あなたのCoDGは ${est.codg.toFixed(3)} でした！`;
    }

    showDone(msg);
  }

  function startTask() {
    const pid = pidInput.value.trim();
    if (!pid) return alert("IDを入力してください");

    trials = makeTrialList();
    logs = [];
    tIndex = 0;

    trialTotalEl.textContent = trials.length;
    trialNumEl.textContent = "1";

    showTask();
    runTrial(trials[0]);
  }

  // ====== イベント ======
  startBtn.addEventListener("click", startTask);
  restartBtn.addEventListener("click", showSetup);

  btnLeft.addEventListener("click", () => recordResponse("Left"));
  btnDirect.addEventListener("click", () => recordResponse("Direct"));
  btnRight.addEventListener("click", () => recordResponse("Right"));

  showSetup();
})();
