// CoDG Task (log only; CoDGは後で解析)
// 2 faces (M1, F1) × 11 gaze levels × 5 repeats = 110 trials
(() => {
  // ====== 設定 ======
  const GAZE_LEVELS = [-12, -9, -6, -3, -1, 0, 1, 3, 6, 9, 12];
  const FACES = ["M1", "F1"];           // 画像ファイル名の prefix
  const REPEATS = 5;                    // ランダム提示回数
  const EXT = "png";                    // "png" or "jpg" に合わせて変更
  const STIM_DIR = "stimuli";           // 刺激フォルダ名

  // タイミング（ms）
  const FIX_MS = 1000;
  const STIM_MS = 500;                  // 刺激提示（反応はこの間もOK）
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

    // Stimulus
    fixEl.textContent = "";
    stimImg.src = trial.image_path;
    stimImg.style.opacity = "1";
    statusEl.textContent = "stim";
    setButtonsEnabled(true);
    awaitingResponse = true;
    stimOnsetPerf = performance.now();

    // 最大STIM_MS経過後は表示を消す（反応待ちは続ける設計でもOKだが、今回は消す）
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

    // 反応後の待ち → 次試行へ
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
    // trialログをCSVとして保存
    const pid = (pidInput.value || "").trim();
    const safePid = pid ? pid.replace(/[^\w\-]/g, "_") : "noid";
    const fname = `codg_trials_${safePid}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;

    if (logs.length > 0) {
      downloadCSV(logs, fname);
    }
    showDone(`Saved: ${fname}\nTrials: ${logs.length}`);
  }

  function validateAssetsHint() {
    // ユーザーに必要なファイル名を示す（初学者向け）
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
