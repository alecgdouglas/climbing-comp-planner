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
  failSigmoidK: 1.8,       // steepness of fail curve
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
  if (gradeNum > onsightGradeNum + PARAMS.failCeiling) return 1.0;
  const midpoint = onsightGradeNum + PARAMS.failSigmoidOffset;
  const raw = 1 / (1 + Math.exp(-PARAMS.failSigmoidK * (gradeNum - midpoint)));
  return Math.min(1, Math.max(0, raw));
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
  return baseOnsightNum - (1 - perf) * (PARAMS.perfToGradeRange * 1.0);
}

// --- Expected Value Calculation ---
function routeExpectedValue(route, onsightGradeNum, minute) {
  const effOnsight = effectiveOnsight(onsightGradeNum, minute);
  const pFail = failProbability(route.gradeNum, effOnsight);
  const pSend1 = 1 - pFail;

  const gradeGap = route.gradeNum - effOnsight;
  const retryBenefit = gradeGap < PARAMS.retryBenefitThreshold ? PARAMS.retryFailReduction : 1.0;
  const pFail2 = pFail * retryBenefit;
  const pSend2 = (1 - pSend1) * (1 - pFail2);

  const pSendTotal = pSend1 + pSend2;
  if (pSendTotal < 0.05) return { ev: 0, time: Infinity, pSend: 0, attempts: 0 };

  const penalty = PARAMS.retryPenalty;
  const expectedPoints = route.points * (pSend1 * 1.0 + pSend2 * (1 - penalty));

  const ct = climbTime(route.gradeNum);
  const rt = restTime(route.gradeNum);
  const attemptTime = ct + rt;
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
function optimizeStrategy(routes, onsightGrade, totalTime) {
  totalTime = totalTime || PARAMS.compDuration;
  const onsightNum = gradeToNum[onsightGrade];
  const remaining = routes.map(r => ({ ...r }));
  const plan = [];
  let currentTime = 0;

  while (currentTime < totalTime && remaining.length > 0) {
    let best = null;
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const rv = routeExpectedValue(remaining[i], onsightNum, currentTime);
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
    totalErr += gradeToNum[log.actualGrade] - route.gradeNum;
    count++;
  }
  return count ? totalErr / count : 0;
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

  const completedNums = new Set(climbLog.filter(l => l.sent).map(l => l.routeNum));
  const remaining = calibrated.filter(r => !completedNums.has(r.routeNum));

  const onsightNum = gradeToNum[onsightGrade];
  const scored = remaining.map(r => {
    const rv = routeExpectedValue(r, onsightNum, elapsedMin);
    return { ...rv, route: r };
  }).filter(r => r.time !== Infinity && elapsedMin + r.time <= totalTime + 5)
    .sort((a, b) => b.evPerMin - a.evPerMin);

  const simResult = optimizeStrategy(remaining, onsightGrade, totalTime - elapsedMin);
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
    remaining: remaining.length,
    elapsedMin,
  };
}

// --- Exports ---
window.Strategy = {
  YDS_GRADES, gradeToNum, numToGrade,
  DEFAULT_PARAMS, setParams, getParams, resetParams,
  buildRouteDistribution, climbTime, restTime,
  failProbability, performanceCurve, effectiveOnsight,
  routeExpectedValue, optimizeStrategy,
  calibrateGradeOffset, applyCalibration, liveOptimize,
};
