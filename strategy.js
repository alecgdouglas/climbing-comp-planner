// ============================================================
// Climbing Competition Strategy Engine
// ============================================================

// --- YDS Grade System ---
const YDS_GRADES = [
  '5.4','5.5','5.6','5.7','5.8','5.9',
  '5.10a','5.10b','5.10c','5.10d',
  '5.11a','5.11b','5.11c','5.11d',
  '5.12a','5.12b','5.12c','5.12d',
  '5.13a','5.13b','5.13c','5.13d',
];

const gradeToNum = Object.fromEntries(YDS_GRADES.map((g, i) => [g, i]));
const numToGrade = (n) => YDS_GRADES[Math.round(Math.max(0, Math.min(n, YDS_GRADES.length - 1)))];

// --- V-Grade System ---
const V_GRADES = ['VB','VB','VB','VB','VB','VB',
  'V0','V1','V1','V2',
  'V3','V4','V5','V5',
  'V5','V6','V7','V7',
  'V8','V9','V9','V10'];
// V_GRADES[i] = V-grade corresponding to YDS_GRADES[i]

const V_GRADE_LIST = ['VB','V0','V1','V2','V3','V4','V5','V6','V7','V8','V9','V10'];
const vGradeToNum = {};
// Map each V-grade to the midpoint of its YDS index range
const _vRanges = {};
V_GRADES.forEach((v, i) => { if (!_vRanges[v]) _vRanges[v] = []; _vRanges[v].push(i); });
Object.entries(_vRanges).forEach(([v, indices]) => {
  vGradeToNum[v] = (indices[0] + indices[indices.length - 1]) / 2;
});

function numToVGrade(n) { return V_GRADES[Math.round(Math.max(0, Math.min(n, V_GRADES.length - 1)))]; }
function numToDualGrade(n) { return numToGrade(n) + '/' + numToVGrade(n); }

// --- Default Parameters ---
const DEFAULT_PARAMS = {
  numRoutes: 37,
  compDuration: 180,       // minutes
  maxAttempts: 2,
  retryPenalty: 0.10,      // 10% point loss per extra attempt
  // Time model
  climbTimeMin: 3,         // minutes for easiest routes
  climbTimeMax: 8,         // minutes for hardest routes
  restTimeMin: 3,
  restTimeMax: 12,
  // Fatigue curve
  warmupEnd: 30,           // minutes
  rampEnd: 90,
  peakEnd: 120,
  warmupFloor: 0.55,       // performance at minute 0
  warmupCeil: 0.85,        // performance at end of warmup
  fatigueDecay: 0.003,     // exponential decay rate after peak
  perfToGradeRange: 10,    // how many grade steps a full perf swing covers
  // Fail probability
  failSigmoidK: 0.9,       // steepness of fail curve
  failSigmoidOffset: 0.5,  // midpoint offset above onsight grade
  failCeiling: 1.5,        // grades above onsight = 100% fail
  retryBenefitThreshold: 2, // grade gap below which retry helps
  retryFailReduction: 0.6,  // multiplier on fail rate for 2nd attempt
};

let PARAMS = { ...DEFAULT_PARAMS };

function setParams(overrides) { PARAMS = { ...DEFAULT_PARAMS, ...overrides }; }
function getParams() { return { ...PARAMS }; }
function resetParams() { PARAMS = { ...DEFAULT_PARAMS }; }

// --- Route Distribution ---
function buildRouteDistribution(minGrade, maxGrade, centerGrade, numRoutes) {
  numRoutes = numRoutes || PARAMS.numRoutes;
  const lo = gradeToNum[minGrade];
  const hi = gradeToNum[maxGrade];
  const mid = gradeToNum[centerGrade];

  const routes = [];
  for (let i = 0; i < numRoutes; i++) {
    const p = (i + 0.5) / numRoutes;
    const z = probit(p);
    let grade;
    if (z <= 0) {
      grade = mid + (z / 2.5) * (mid - lo);
    } else {
      grade = mid + (z / 2.5) * (hi - mid);
    }
    grade = Math.max(lo, Math.min(hi, grade));
    routes.push({
      routeNum: i + 1,
      points: (i + 1) * 100,
      gradeNum: grade,
      grade: numToGrade(grade),
    });
  }
  return routes;
}

function probit(p) {
  if (p <= 0) return -3;
  if (p >= 1) return 3;
  if (p < 0.5) return -rationalApprox(Math.sqrt(-2 * Math.log(p)));
  return rationalApprox(Math.sqrt(-2 * Math.log(1 - p)));
}
function rationalApprox(t) {
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  return t - (c[0] + c[1] * t + c[2] * t * t) / (1 + d[0] * t + d[1] * t * t + d[2] * t * t * t);
}

// --- Time Model ---
function climbTime(gradeNum) {
  const center = gradeToNum['5.10d'];
  const k = 0.5;
  return PARAMS.climbTimeMin + (PARAMS.climbTimeMax - PARAMS.climbTimeMin) / (1 + Math.exp(-k * (gradeNum - center)));
}

function restTime(gradeNum) {
  const center = gradeToNum['5.11a'];
  const k = 0.6;
  return PARAMS.restTimeMin + (PARAMS.restTimeMax - PARAMS.restTimeMin) / (1 + Math.exp(-k * (gradeNum - center)));
}

// --- Failure Probability ---
function failProbability(gradeNum, onsightGradeNum) {
  const midpoint = onsightGradeNum + PARAMS.failSigmoidOffset;
  const raw = 1 / (1 + Math.exp(-PARAMS.failSigmoidK * (gradeNum - midpoint)));
  return Math.min(0.99, Math.max(0, raw));
}

// --- Fatigue / Performance Curve ---
function performanceCurve(minute) {
  const { warmupEnd, rampEnd, peakEnd, warmupFloor, warmupCeil, fatigueDecay } = PARAMS;

  const warmup = warmupFloor + (warmupCeil - warmupFloor) / (1 + Math.exp(-0.2 * (minute - warmupEnd / 2)));
  const ramp = warmupCeil + (1.0 - warmupCeil) / (1 + Math.exp(-0.1 * (minute - (warmupEnd + rampEnd) / 2)));
  const decay = Math.exp(-fatigueDecay * Math.max(0, minute - peakEnd));

  if (minute <= warmupEnd) return warmup;
  if (minute <= rampEnd) return ramp;
  if (minute <= peakEnd) return 1.0;
  return decay;
}

function effectiveOnsight(baseOnsightNum, minute) {
  const perf = performanceCurve(minute);
  // Scale penalty to climber's ability — stronger climbers have more range to lose
  const maxDrop = baseOnsightNum * (PARAMS.perfToGradeRange / YDS_GRADES.length);
  return baseOnsightNum - (1 - perf) * maxDrop;
}

// --- Expected Value Calculation ---
function routeExpectedValue(route, onsightGradeNum, minute, timeMult) {
  timeMult = timeMult || 1.0;
  const effOnsight = effectiveOnsight(onsightGradeNum, minute);
  const pFail = failProbability(route.gradeNum, effOnsight);
  const pSend1 = 1 - pFail;

  const gradeGap = route.gradeNum - effOnsight;
  const retryBenefit = gradeGap < PARAMS.retryBenefitThreshold ? PARAMS.retryFailReduction : 1.0;
  const pFail2 = pFail * retryBenefit;
  const pSend2 = (1 - pSend1) * (1 - pFail2);

  const pSendTotal = pSend1 + pSend2;
  if (pSendTotal < 0.01) return { ev: 0, time: Infinity, pSend: 0, attempts: 0 };

  const penalty = PARAMS.retryPenalty;
  const expectedPoints = route.points * (pSend1 * 1.0 + pSend2 * (1 - penalty));

  const ct = climbTime(route.gradeNum);
  const rt = restTime(route.gradeNum);
  const attemptTime = (ct + rt) * timeMult;
  const expectedTime = attemptTime + (pFail * attemptTime);

  return {
    ev: expectedPoints,
    time: expectedTime,
    evPerMin: expectedPoints / expectedTime,
    pSend: pSendTotal,
    pSend1: pSend1,
    attempts: 1 + pFail,
  };
}

// --- Greedy Optimizer ---
function optimizeStrategy(routes, onsightGrade, totalTime, timeMult) {
  totalTime = totalTime || PARAMS.compDuration;
  timeMult = timeMult || 1.0;
  const onsightNum = gradeToNum[onsightGrade];
  const remaining = routes.map(r => ({ ...r }));
  const plan = [];
  let currentTime = 0;

  while (currentTime < totalTime && remaining.length > 0) {
    let best = null;
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const rv = routeExpectedValue(remaining[i], onsightNum, currentTime, timeMult);
      if (rv.time === Infinity) continue;
      if (currentTime + rv.time > totalTime + 5) continue;
      if (!best || rv.evPerMin > best.evPerMin) {
        best = { ...rv, route: remaining[i] };
        bestIdx = i;
      }
    }
    if (!best) break;

    plan.push({
      startMin: currentTime,
      route: best.route,
      expectedPoints: best.ev,
      expectedTime: best.time,
      evPerMin: best.evPerMin,
      pSend: best.pSend,
      pSend1: best.pSend1,
      effectiveGrade: numToGrade(effectiveOnsight(onsightNum, currentTime)),
    });
    currentTime += best.time;
    remaining.splice(bestIdx, 1);
  }

  return {
    plan,
    totalExpectedPoints: plan.reduce((s, p) => s + p.expectedPoints, 0),
    totalTime: currentTime,
    routesAttempted: plan.length,
  };
}

// --- Grade Recalibration ---
function calibrateGradeOffset(routes, climbLog) {
  if (!climbLog.length) return 0;
  let totalErr = 0, count = 0;
  for (const log of climbLog) {
    const route = routes.find(r => r.routeNum === log.routeNum);
    if (!route || log.actualGrade == null) continue;
    // Support both YDS and V-grade inputs
    let actualNum = gradeToNum[log.actualGrade];
    if (actualNum == null) actualNum = vGradeToNum[log.actualGrade];
    if (actualNum == null) continue;
    totalErr += actualNum - route.gradeNum;
    count++;
  }
  return count ? totalErr / count : 0;
}

// --- Time Recalibration ---
// Computes ratio of actual time per climb vs model-predicted time.
// Each gap between consecutive log entries = total time consumed (climb + rest/belay).
function calibrateTimeMultiplier(routes, climbLog) {
  if (climbLog.length < 2) return 1.0;
  const sorted = [...climbLog].sort((a, b) => a.elapsedMin - b.elapsedMin);
  let totalActual = 0, totalPredicted = 0, count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const actual = sorted[i].elapsedMin - sorted[i - 1].elapsedMin;
    if (actual <= 0) continue;
    const route = routes.find(r => r.routeNum === sorted[i - 1].routeNum);
    if (!route) continue;
    const predicted = climbTime(route.gradeNum) + restTime(route.gradeNum);
    totalActual += actual;
    totalPredicted += predicted;
    count++;
  }
  if (!count || totalPredicted === 0) return 1.0;
  // Clamp to 0.5x–3x to avoid wild swings from one or two outliers
  return Math.max(0.5, Math.min(3.0, totalActual / totalPredicted));
}

function applyCalibration(routes, offset) {
  return routes.map(r => {
    const shifted = Math.max(0, Math.min(YDS_GRADES.length - 1, r.gradeNum + offset));
    return { ...r, gradeNum: shifted, grade: numToGrade(shifted) };
  });
}

// --- Live Optimizer ---
function liveOptimize(routes, onsightGrade, climbLog, elapsedMin, totalTime) {
  totalTime = totalTime || PARAMS.compDuration;
  const offset = calibrateGradeOffset(routes, climbLog);
  const calibrated = applyCalibration(routes, offset);
  const timeMult = calibrateTimeMultiplier(routes, climbLog);

  const completedNums = new Set(climbLog.filter(l => l.sent).map(l => l.routeNum));
  const remaining = calibrated.filter(r => !completedNums.has(r.routeNum));

  const onsightNum = gradeToNum[onsightGrade];
  const scored = remaining.map(r => {
    const rv = routeExpectedValue(r, onsightNum, elapsedMin, timeMult);
    return { ...rv, route: r };
  }).filter(r => r.time !== Infinity && elapsedMin + r.time <= totalTime + 5)
    .sort((a, b) => b.evPerMin - a.evPerMin);

  const simResult = optimizeStrategy(remaining, onsightGrade, totalTime - elapsedMin, timeMult);
  simResult.plan.forEach(p => { p.startMin += elapsedMin; });

  const actualPoints = climbLog.reduce((s, l) => {
    if (!l.sent) return s;
    const route = routes.find(r => r.routeNum === l.routeNum);
    const pen = 1 - PARAMS.retryPenalty * Math.max(0, l.attempts - 1);
    return s + (route ? route.points * Math.max(0, pen) : 0);
  }, 0);

  return {
    recommendations: scored.slice(0, 3),
    fullPlan: simResult,
    actualPoints,
    projectedTotal: actualPoints + simResult.totalExpectedPoints,
    gradeOffset: offset,
    timeMult,
    remaining: remaining.length,
    elapsedMin,
  };
}

// --- Exports ---
window.Strategy = {
  YDS_GRADES, gradeToNum, numToGrade,
  V_GRADES, V_GRADE_LIST, vGradeToNum, numToVGrade, numToDualGrade,
  DEFAULT_PARAMS, setParams, getParams, resetParams,
  buildRouteDistribution, climbTime, restTime,
  failProbability, performanceCurve, effectiveOnsight,
  routeExpectedValue, optimizeStrategy,
  calibrateGradeOffset, applyCalibration, calibrateTimeMultiplier, liveOptimize,
};
