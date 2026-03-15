export const calculateSMA = (data: number[], period: number): number[] => {
  const sma = new Array(data.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) {
      sum -= data[i - period];
    }
    if (i >= period - 1) {
      sma[i] = sum / period;
    }
  }
  return sma;
};

export const calculateStdev = (data: number[], period: number): number[] => {
  const sma = calculateSMA(data, period);
  const stdev = new Array(data.length).fill(NaN);
  
  for (let i = period - 1; i < data.length; i++) {
    let sumSqDiff = 0;
    for (let j = 0; j < period; j++) {
      const diff = data[i - j] - sma[i];
      sumSqDiff += diff * diff;
    }
    stdev[i] = Math.sqrt(sumSqDiff / period);
  }
  return stdev;
};

export const calculateTR = (high: number[], low: number[], close: number[]): number[] => {
  const tr = new Array(high.length).fill(NaN);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < high.length; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  return tr;
};

export const calculateHighest = (data: number[], period: number): number[] => {
  const result = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let max = -Infinity;
    for (let j = 0; j < period; j++) {
      if (data[i - j] > max) max = data[i - j];
    }
    result[i] = max;
  }
  return result;
};

export const calculateLowest = (data: number[], period: number): number[] => {
  const result = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let min = Infinity;
    for (let j = 0; j < period; j++) {
      if (data[i - j] < min) min = data[i - j];
    }
    result[i] = min;
  }
  return result;
};

export const calculateLinReg = (data: number[], period: number): number[] => {
  const result = new Array(data.length).fill(NaN);
  
  // Pre-calculate x sums
  let sumX = 0;
  let sumX2 = 0;
  for (let i = 0; i < period; i++) {
    sumX += i;
    sumX2 += i * i;
  }
  
  const divisor = period * sumX2 - sumX * sumX;

  for (let i = period - 1; i < data.length; i++) {
    let sumY = 0;
    let sumXY = 0;
    
    // Linear regression on the last 'period' points
    // We treat the points as x=0 to x=period-1
    // Actually TradingView linreg(source, length, offset) calculates y = mx + b at x=length-1 (current bar)
    // x values are 0, 1, ..., period-1
    
    for (let j = 0; j < period; j++) {
      const val = data[i - (period - 1) + j]; // Oldest to newest
      sumY += val;
      sumXY += j * val;
    }
    
    const m = (period * sumXY - sumX * sumY) / divisor;
    const b = (sumY - m * sumX) / period;
    
    // Value at the current bar (x = period - 1)
    result[i] = m * (period - 1) + b;
  }
  return result;
};
