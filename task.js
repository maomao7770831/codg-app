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

  // データ不足なら終了
  if (xs.length < 5) return null;

  const fL = fit(xs, Ls, ns);
  const fR = fit(xs, Rs, ns);

  const pL = x => sigmoid(fL.b0 + fL.b1 * x);
  const pR = x => sigmoid(fR.b0 + fR.b1 * x);

  // Left-Direct の交点条件
  const gL = x => 2 * pL(x) + pR(x) - 1;

  // Right-Direct の交点条件
  const gR = x => pL(x) + 2 * pR(x) - 1;

  // 二分法
  function bisect(func, a, b, maxIter = 60) {
    let fa = func(a);
    let fb = func(b);

    if (isNaN(fa) || isNaN(fb)) return null;
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (fa * fb > 0) return null;

    for (let i = 0; i < maxIter; i++) {
      const mid = (a + b) / 2;
      const fm = func(mid);

      if (Math.abs(fm) < 1e-5) return mid;

      if (fa * fm < 0) {
        b = mid;
        fb = fm;
      } else {
        a = mid;
        fa = fm;
      }
    }
    return (a + b) / 2;
  }

  // 符号変化を探して根を見つける
  function findRoots(func, minX = -12, maxX = 12, step = 0.25) {
    const roots = [];
    let prevX = minX;
    let prevY = func(prevX);

    for (let x = minX + step; x <= maxX; x += step) {
      const y = func(x);

      if (!isNaN(prevY) && !isNaN(y)) {
        if (prevY === 0) {
          roots.push(prevX);
        } else if (prevY * y < 0) {
          const root = bisect(func, prevX, x);
          if (root !== null) roots.push(root);
        }
      }

      prevX = x;
      prevY = y;
    }

    return roots;
  }

  const rootsL = findRoots(gL);
  const rootsR = findRoots(gR);

  if (rootsL.length === 0 || rootsR.length === 0) return null;

  // 左交点は 0より左側を優先
  let xL = rootsL.filter(x => x <= 0).pop();
  if (xL === undefined) xL = rootsL[0];

  // 右交点は 0より右側を優先
  let xR = rootsR.filter(x => x >= 0)[0];
  if (xR === undefined) xR = rootsR[rootsR.length - 1];

  return {
    codg: Math.abs(xR - xL),
    xL,
    xR
  };
}
