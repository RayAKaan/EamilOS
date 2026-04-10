export interface EWMAState {
  value: number;
  alpha: number;
}

export function ewmaUpdate(state: EWMAState, newValue: number): EWMAState {
  return {
    value: state.alpha * newValue + (1 - state.alpha) * state.value,
    alpha: state.alpha,
  };
}

export function ewmaInitialize(initialValue: number, alpha: number): EWMAState {
  return { value: initialValue, alpha };
}

export interface WilsonScoreResult {
  lowerBound: number;
  upperBound: number;
  center: number;
}

export function wilsonScore(successes: number, total: number, z: number = 1.645): WilsonScoreResult {
  if (total === 0) {
    return { lowerBound: 0, upperBound: 1, center: 0.5 };
  }
  
  const p = successes / total;
  const z2 = z * z;
  const n = total;
  
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator;
  
  return {
    lowerBound: Math.max(0, center - margin),
    upperBound: Math.min(1, center + margin),
    center,
  };
}

export interface PearsonCorrelationResult {
  correlation: number;
  pValue: number;
  sampleSize: number;
}

export function pearsonCorrelation(x: number[], y: number[]): PearsonCorrelationResult {
  const n = Math.min(x.length, y.length);
  
  if (n < 3) {
    return { correlation: 0, pValue: 1, sampleSize: n };
  }
  
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  let covariance = 0;
  let varX = 0;
  let varY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    covariance += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  
  const stdX = Math.sqrt(varX);
  const stdY = Math.sqrt(varY);
  
  if (stdX === 0 || stdY === 0) {
    return { correlation: 0, pValue: 1, sampleSize: n };
  }
  
  const correlation = covariance / (stdX * stdY);
  
  const tStatistic = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
  const pValue = 2 * (1 - tDistCDF(Math.abs(tStatistic), n - 2));
  
  return { correlation, pValue: Math.max(0, Math.min(1, pValue)), sampleSize: n };
}

function tDistCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;
  
  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  
  let f = 1;
  let c = 1;
  let d = 0;
  
  for (let i = 0; i <= 200; i++) {
    const m = i / 2;
    let numerator;
    
    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }
    
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    
    const cd = c * d;
    f *= cd;
    
    if (Math.abs(cd - 1) < 1e-10) break;
  }
  
  return front * (f - 1);
}

function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += coefficients[j] / ++y;
  }
  
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  standardError: number;
}

export function linearRegression(x: number[], y: number[]): LinearRegressionResult {
  const n = Math.min(x.length, y.length);
  
  if (n < 3) {
    return { slope: 0, intercept: 0, rSquared: 0, standardError: 0 };
  }
  
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * x[i] + intercept;
    ssRes += (y[i] - predicted) ** 2;
  }
  
  const rSquared = ssYY === 0 ? 0 : 1 - ssRes / ssYY;
  const standardError = Math.sqrt(ssRes / (n - 2));
  
  return { slope, intercept, rSquared, standardError };
}

export function movingAverage(values: number[], window: number): number[] {
  if (window <= 0 || values.length === 0) return [];
  if (window > values.length) window = values.length;
  
  const result: number[] = [];
  let sum = 0;
  
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) {
      sum -= values[i - window];
      result.push(sum / window);
    } else {
      result.push(sum / (i + 1));
    }
  }
  
  return result;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) return sorted[lower];
  
  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  
  return Math.sqrt(variance);
}

export function minSampleSize(baseline: number, minimumDetectable: number, _alpha: number = 0.05, _power: number = 0.8): number {
  const zAlpha = 1.96;
  const zBeta = 0.84;
  
  const p1 = baseline;
  const p2 = baseline + minimumDetectable;
  
  const pBar = (p1 + p2) / 2;
  const delta = Math.abs(p2 - p1);
  
  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  const denominator = delta ** 2;
  
  return Math.ceil(numerator / denominator);
}
