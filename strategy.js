// ============================================================
// Climbing Competition Strategy Engine
// ============================================================

// --- YDS Grade System ---
// Ordered list of YDS grades from easiest to hardest
const YDS_GRADES = [
  '5.4','5.5','5.6','5.7','5.8','5.9',
  '5.10a','5.10b','5.10c','5.10d',
  '5.11a','5.11b','5.11c','5.11d',
  '5.12a','5.12b','5.12c','5.12d',
  '5.13a','5.13b','5.13c','5.13d',
];

// Map grade string -> numeric index (0-based)
const gradeToNum = Object.fromEntries(YDS_GRADES.map((g, i) => [g, i]));
const numToGrade = (n) => YDS_GRADES[Math.round(Math.max(0, Math.min(n, YDS_GRADES.length - 1)))];

// --- Route Distribution ---
// Assigns a YDS grade to each of 37 routes using a normal-ish CDF mapping.
// Routes are evenly spaced in percentile space; the CDF stretches from min to max
// with the center grade at route #19 (median).
function buildRouteDistribution(minGrade, maxGrade, centerGrade, numRoutes = 37) {
  const lo = gradeToNum[minGrade];
  const hi = gradeToNum[maxGrade];
  const mid = gradeToNum[centerGrade];

  // Use inverse normal CDF (probit) to map uniform route indices to a bell-shaped spread.
  // We map route i in [0, numRoutes-1] to a percentile in (0,1), then through the
  // inverse CDF scaled to [lo, hi] with median at mid.
  const routes = [];
  for (let i = 0; i < numRoutes; i++) {
    // percentile in (0,1) — avoid exact 0 and 1
    const p = (i + 0.5) / numRoutes;
    // standard normal quantile (rational approximation)
    const z = probit(p);
    // z ranges roughly -2.5 to +2.5 for our 37 routes
    // Map z to grade space: z=0 -> centerGrade, stretch asymmetrically to min/max
    let grade;
    if (z <= 0) {
      grade = mid + (z / 2.5) * (mid - lo); // stretch toward low end
    } else {
      grade = mid + (z / 2.5) * (hi - mid); // stretch toward high end
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

// Rational approximation of the inverse normal CDF (probit function)
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
// Climb time (minutes) as a function of grade numeric index.
// Sigmoid ramp: ~3 min for easy grades, ~5.5 min mid, ~8 min for hard.
function climbTime(gradeNum) {
  // Sigmoid centered around 5.10d (index 9), steepness k
  const center = gradeToNum['5.10d'];
  const k = 0.5;
  const minTime = 3;
  const maxTime = 8;
  return minTime + (maxTime - minTime) / (1 + Math.exp(-k * (gradeNum - center)));
}

// Rest time (minutes) between attempts.
// ~3 min for easy, ~8 min mid, ~12 min for hard.
function restTime(gradeNum) {
  const center = gradeToNum['5.11a'];
  const k = 0.6;
  const minRest = 3;
  const maxRest = 12;
  return minRest + (maxRest - minRest) / (1 + Math.exp(-k * (gradeNum - center)));
}

// --- Failure Probability ---
// Probability of failing an onsight attempt, given the route grade and climber's max onsight grade.
// 0% at easy grades, sigmoid ramp to ~70% at onsight limit, ~100% two grades above.
function failProbability(gradeNum, onsightGradeNum) {
  // Hard ceiling: anything 2+ grades above onsight is essentially impossible
  if (gradeNum > onsightGradeNum + 1.5) return 1.0;
  // Sigmoid: ~0% fail at 4 grades below onsight, ~50% at onsight, ~100% at 2 grades above
  const midpoint = onsightGradeNum + 0.5;
  const k = 1.8;
  const raw = 1 / (1 + Math.exp(-k * (gradeNum - midpoint)));
  return Math.min(1, Math.max(0, raw));
}

// --- Fatigue / Performance Curve ---
// Returns a multiplier [0, 1] representing effective performance at a given minute.
// This shifts your effective onsight grade: effective = baseOnsight * performanceCurve(t)
// Shape: warm-up (0-30), ramp (30-90), peak (90-120), decline (120-180)
function performanceCurve(minute, totalTime = 180) {
  // Piecewise model using smooth sigmoid transitions
  // Warm-up: starts at ~0.7, rises to ~0.9 by minute 30
  // Ramp: 0.9 -> 1.0 by minute 90
  // Peak: 1.0 from 90-120
  // Decline: 1.0 -> ~0.8 by minute 180

  const warmupEnd = 30;
  const rampEnd = 90;
  const peakEnd = 120;

  // Warm-up sigmoid (0 -> warmupEnd)
  const warmupFloor = 0.55;
  const warmupCeil = 0.85;
  const warmup = warmupFloor + (warmupCeil - warmupFloor) / (1 + Math.exp(-0.2 * (minute - warmupEnd / 2)));

  // Ramp sigmoid (warmupEnd -> rampEnd)
  const ramp = warmupCeil + (1.0 - warmupCeil) / (1 + Math.exp(-0.1 * (minute - (warmupEnd + rampEnd) / 2)));

  // Fatigue decay after peak (exponential)
  const decayRate = 0.003;
  const decay = 1.0 * Math.exp(-decayRate * Math.max(0, minute - peakEnd));

  // Blend: use warmup early, ramp in middle, decay late
  if (minute <= warmupEnd) return warmup;
  if (minute <= rampEnd) return ramp;
  if (minute <= peakEnd) return 1.0;
  return decay;
}

// Effective onsight grade at a given minute
function effectiveOnsight(baseOnsightNum, minute) {
  const perf = performanceCurve(minute);
  // Scale: at perf=1.0, you're at full onsight. At perf=0.7, you're ~3 grades lower.
  // Map performance to grade offset: offset = (1 - perf) * range
  const range = 10; // ~10 grade steps from 5.8 to 5.12a
  return baseOnsightNum - (1 - perf) * (range * 1.0);
}

// --- Expected Value Calculation ---
// For a given route, compute expected points and expected time cost,
// factoring in fail probability, retry (max 2 attempts), and attempt penalty.
function routeExpectedValue(route, onsightGradeNum, minute) {
  const effOnsight = effectiveOnsight(onsightGradeNum, minute);
  const pFail = failProbability(route.gradeNum, effOnsight);
  const pSend1 = 1 - pFail;
  // Second attempt: reduced fail rate only if route is within ~2 grades of effective onsight
  const gradeGap = route.gradeNum - effOnsight;
  const retryBenefit = gradeGap < 2 ? 0.6 : 1.0; // no benefit if route is way above you
  const pFail2 = pFail * retryBenefit;
  const pSend2 = (1 - pSend1) * (1 - pFail2);

  const pSendTotal = pSend1 + pSend2;
  if (pSendTotal < 0.05) return { ev: 0, time: Infinity, pSend: 0, attempts: 0 };

  // Points: full on onsight, -10% per extra attempt
  const expectedPoints = route.points * (pSend1 * 1.0 + pSend2 * 0.9);

  // Time: attempt 1 always happens. Attempt 2 only if attempt 1 fails.
  const ct = climbTime(route.gradeNum);
  const rt = restTime(route.gradeNum);
  const time1 = ct + rt;
  const time2 = ct + rt;
  const expectedTime = time1 + (pFail * time2);

  return {
    ev: expectedPoints,
    time: expectedTime,
    evPerMin: expectedPoints / expectedTime,
    pSend: pSendTotal,
    pSend1: pSend1,
    attempts: 1 + pFail, // expected number of attempts
  };
}

// --- Greedy Optimizer ---
// Simulate the 3-hour competition, greedily picking the best EV/min route at each step.
function optimizeStrategy(routes, onsightGrade, totalTime = 180) {
  const onsightNum = gradeToNum[onsightGrade];
  const remaining = routes.map(r => ({ ...r }));
  const plan = [];
  let currentTime = 0;

  while (currentTime < totalTime && remaining.length > 0) {
    // Score each remaining route at current time
    let best = null;
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const rv = routeExpectedValue(remaining[i], onsightNum, currentTime);
      if (rv.time === Infinity) continue;
      if (currentTime + rv.time > totalTime + 5) continue; // allow slight overrun
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

// --- Exports for use in dashboard ---
window.Strategy = {
  YDS_GRADES,
  gradeToNum,
  numToGrade,
  buildRouteDistribution,
  climbTime,
  restTime,
  failProbability,
  performanceCurve,
  effectiveOnsight,
  routeExpectedValue,
  optimizeStrategy,
};
