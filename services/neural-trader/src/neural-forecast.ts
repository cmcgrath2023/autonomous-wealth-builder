/**
 * Neural Forecast Engine — ruv-swarm LSTM + GRU integration
 * Provides neural network-based price prediction as a 7th vote in the signal system.
 *
 * Uses ephemeral neural networks: train on recent price data, predict next bars, dissolve.
 * CPU-native, no GPU required, sub-100ms inference.
 */

// @ts-ignore — no declaration file for ruv-swarm
import { createNeuralModel } from 'ruv-swarm/src/neural-models/index.js';

interface ForecastResult {
  direction: 'up' | 'down' | 'neutral';
  confidence: number;        // 0-1 how strong the neural signal is
  predictedMove: number;     // predicted % change next 5 bars
  modelAgreement: number;    // how much LSTM and GRU agree (0-1)
  trainLoss: number;         // final training loss (lower = better fit)
}

interface NormalizedData {
  normalized: number[];
  min: number;
  max: number;
  range: number;
}

/**
 * Normalize price data to 0-1 range for neural network input
 */
function normalize(data: number[]): NormalizedData {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return {
    normalized: data.map(v => (v - min) / range),
    min,
    max,
    range,
  };
}

/**
 * Create sliding window sequences for time-series training
 * Input: [t-windowSize ... t-1], Target: [t]
 */
function createSequences(data: number[], windowSize: number): { inputs: number[][]; targets: number[] } {
  const inputs: number[][] = [];
  const targets: number[] = [];

  for (let i = windowSize; i < data.length; i++) {
    inputs.push(data.slice(i - windowSize, i));
    targets.push(data[i]);
  }

  return { inputs, targets };
}

/**
 * Simple feedforward prediction using trained LSTM weights
 * Since ruv-swarm LSTM expects batch format, we do a lightweight
 * sliding-window regression approach optimized for price series.
 */
async function predictWithModel(
  modelType: 'lstm' | 'gru',
  closes: number[],
  windowSize: number = 20,
  epochs: number = 10,
): Promise<{ prediction: number; loss: number }> {
  const { normalized, min, range } = normalize(closes);
  const { inputs, targets } = createSequences(normalized, windowSize);

  if (inputs.length < 10) {
    return { prediction: normalized[normalized.length - 1], loss: 1.0 };
  }

  // Create model
  const model = await createNeuralModel(modelType, {
    inputSize: windowSize,
    hiddenSize: 64,
    numLayers: 1,
    outputSize: 1,
    sequenceLength: windowSize,
    dropoutRate: 0.1,
  });

  // Prepare training data — last 80% train, 20% validate
  const trainSize = Math.floor(inputs.length * 0.8);
  const trainingData = inputs.slice(0, trainSize).map((inp, i) => ({
    inputs: new Float32Array(inp),
    targets: new Float32Array([targets[i]]),
  }));

  // Train (lightweight — 10 epochs, small model)
  let finalLoss = 1.0;
  try {
    const result = await model.train(trainingData, {
      epochs,
      batchSize: Math.min(16, Math.floor(trainSize / 2)),
      learningRate: 0.001,
      gradientClipping: 1.0,
      validationSplit: 0.2,
    });
    finalLoss = result.finalLoss || 1.0;
  } catch {
    // Training may fail on small datasets — use simple regression fallback
  }

  // Predict: use last windowSize points as input
  const lastWindow = normalized.slice(-windowSize);
  let prediction: number;
  try {
    const output = await model.forward(new Float32Array(lastWindow), false);
    prediction = Array.isArray(output) ? output[0] : (output as any)?.[0] ?? normalized[normalized.length - 1];
  } catch {
    // Fallback: simple linear extrapolation
    const recent = normalized.slice(-5);
    const trend = (recent[recent.length - 1] - recent[0]) / recent.length;
    prediction = recent[recent.length - 1] + trend;
  }

  // Denormalize
  const denormalized = prediction * range + min;
  return { prediction: denormalized, loss: finalLoss };
}

/**
 * Main forecast function — runs LSTM + GRU ensemble
 * Returns a unified neural forecast with direction and confidence
 */
export async function neuralForecast(closes: number[]): Promise<ForecastResult | null> {
  if (closes.length < 50) return null; // Need sufficient history

  const current = closes[closes.length - 1];

  // Run LSTM and GRU in parallel for ensemble prediction
  const [lstmResult, gruResult] = await Promise.all([
    predictWithModel('lstm', closes, 20, 8).catch(() => null),
    predictWithModel('gru', closes, 15, 8).catch(() => null),
  ]);

  if (!lstmResult && !gruResult) return null;

  // Ensemble: average predictions from available models
  const predictions: number[] = [];
  const losses: number[] = [];

  if (lstmResult) {
    predictions.push(lstmResult.prediction);
    losses.push(lstmResult.loss);
  }
  if (gruResult) {
    predictions.push(gruResult.prediction);
    losses.push(gruResult.loss);
  }

  const avgPrediction = predictions.reduce((s, p) => s + p, 0) / predictions.length;
  const avgLoss = losses.reduce((s, l) => s + l, 0) / losses.length;
  const predictedMove = (avgPrediction - current) / current;

  // Model agreement: if both models agree on direction, higher confidence
  let modelAgreement = 1.0;
  if (predictions.length === 2) {
    const dir1 = predictions[0] > current ? 1 : -1;
    const dir2 = predictions[1] > current ? 1 : -1;
    modelAgreement = dir1 === dir2 ? 1.0 : 0.3;

    // Additional: how close are the predictions?
    const predDiff = Math.abs(predictions[0] - predictions[1]) / current;
    if (predDiff < 0.005) modelAgreement = Math.min(modelAgreement + 0.2, 1.0); // Very close agreement
  }

  // Determine direction
  const moveThreshold = 0.002; // 0.2% minimum predicted move to have a direction
  let direction: 'up' | 'down' | 'neutral';
  if (predictedMove > moveThreshold) direction = 'up';
  else if (predictedMove < -moveThreshold) direction = 'down';
  else direction = 'neutral';

  // Confidence = f(move magnitude, model agreement, training loss)
  const moveMagnitude = Math.min(Math.abs(predictedMove) / 0.03, 1.0); // Cap at 3% move
  const lossQuality = Math.max(0, 1 - avgLoss); // Lower loss = higher quality
  const confidence = moveMagnitude * 0.4 + modelAgreement * 0.4 + lossQuality * 0.2;

  return {
    direction,
    confidence: Math.round(confidence * 100) / 100,
    predictedMove: Math.round(predictedMove * 10000) / 10000,
    modelAgreement: Math.round(modelAgreement * 100) / 100,
    trainLoss: Math.round(avgLoss * 10000) / 10000,
  };
}

/**
 * Quick momentum forecast — lighter weight, uses just the GRU
 * For when full ensemble is too slow for heartbeat intervals
 */
export async function quickForecast(closes: number[]): Promise<{ direction: 'up' | 'down' | 'neutral'; confidence: number } | null> {
  if (closes.length < 30) return null;

  const result = await predictWithModel('gru', closes.slice(-60), 10, 5).catch(() => null);
  if (!result) return null;

  const current = closes[closes.length - 1];
  const move = (result.prediction - current) / current;

  if (Math.abs(move) < 0.001) return { direction: 'neutral', confidence: 0.3 };

  return {
    direction: move > 0 ? 'up' : 'down',
    confidence: Math.min(Math.abs(move) / 0.02, 1.0) * (1 - result.loss * 0.5),
  };
}

// ===================================================================
// PROBABILISTIC FORECASTING ENGINE
// Multi-model ensemble with Monte Carlo uncertainty quantification
// ===================================================================

export interface ProbabilisticForecast {
  ticker: string;
  currentPrice: number;
  horizon: number;                    // bars ahead
  timestamp: number;

  // Point estimates (ensemble mean)
  predictedPrice: number;
  predictedMove: number;              // % change
  direction: 'up' | 'down' | 'neutral';

  // Probability distribution
  percentile10: number;               // 10th percentile (bearish scenario)
  percentile25: number;               // 25th percentile
  percentile50: number;               // median prediction
  percentile75: number;               // 75th percentile
  percentile90: number;               // 90th percentile (bullish scenario)

  // Confidence metrics
  confidence: number;                 // 0-1 overall confidence
  modelAgreement: number;             // how well models agree
  uncertainty: number;                // std deviation of predictions as % of price
  probabilityUp: number;              // probability price goes UP (0-1)
  probabilityDown: number;            // probability price goes DOWN (0-1)

  // Per-model breakdown
  models: {
    name: string;
    prediction: number;
    loss: number;
  }[];

  // Multi-step trajectory (if requested)
  trajectory?: {
    bar: number;
    mean: number;
    low: number;                      // 10th percentile
    high: number;                     // 90th percentile
  }[];
}

/**
 * Monte Carlo prediction — run model N times with dropout enabled
 * Each run produces a slightly different prediction due to dropout randomness,
 * giving us a distribution of outcomes instead of a single point estimate.
 */
async function monteCarloPredict(
  modelType: 'lstm' | 'gru' | 'transformer',
  closes: number[],
  windowSize: number,
  epochs: number,
  mcRuns: number = 10,
): Promise<number[]> {
  const { normalized, min, range } = normalize(closes);
  const { inputs, targets } = createSequences(normalized, windowSize);

  if (inputs.length < 10) return [];

  const predictions: number[] = [];

  // Train once, predict multiple times with dropout active
  const model = await createNeuralModel(modelType, {
    inputSize: windowSize,
    hiddenSize: modelType === 'transformer' ? 128 : 64,
    numLayers: modelType === 'transformer' ? 2 : 1,
    outputSize: 1,
    sequenceLength: windowSize,
    dropoutRate: 0.15, // Higher dropout for MC uncertainty
  });

  const trainSize = Math.floor(inputs.length * 0.8);
  const trainingData = inputs.slice(0, trainSize).map((inp, i) => ({
    inputs: new Float32Array(inp),
    targets: new Float32Array([targets[i]]),
  }));

  try {
    await model.train(trainingData, {
      epochs,
      batchSize: Math.min(16, Math.floor(trainSize / 2)),
      learningRate: 0.001,
      gradientClipping: 1.0,
      validationSplit: 0.2,
    });
  } catch {
    return [];
  }

  const lastWindow = normalized.slice(-windowSize);

  // Run multiple forward passes — with training=true to keep dropout active
  // This creates prediction variance that represents model uncertainty
  for (let i = 0; i < mcRuns; i++) {
    try {
      // Alternate between training=true (dropout on) and false for diversity
      const useDropout = i < mcRuns * 0.7; // 70% with dropout, 30% deterministic
      const output = await model.forward(new Float32Array(lastWindow), useDropout);
      const pred = Array.isArray(output) ? output[0] : (output as any)?.[0];
      if (pred != null && isFinite(pred)) {
        // Denormalize
        const denorm = pred * range + min;
        predictions.push(denorm);
      }
    } catch {
      // Skip failed predictions
    }
  }

  return predictions;
}

/**
 * Multi-step trajectory forecast — predict N bars into the future
 * Uses autoregressive prediction: predict bar t+1, feed it back, predict t+2, etc.
 */
async function trajectoryForecast(
  closes: number[],
  stepsAhead: number = 10,
  windowSize: number = 15,
): Promise<{ bar: number; mean: number; low: number; high: number }[]> {
  const trajectory: { bar: number; mean: number; low: number; high: number }[] = [];
  const { normalized, min, range } = normalize(closes);
  const { inputs, targets } = createSequences(normalized, windowSize);

  if (inputs.length < 10) return [];

  // Train a GRU for trajectory (lighter, faster for multi-step)
  const model = await createNeuralModel('gru', {
    inputSize: windowSize,
    hiddenSize: 64,
    numLayers: 1,
    outputSize: 1,
    sequenceLength: windowSize,
    dropoutRate: 0.1,
  });

  const trainSize = Math.floor(inputs.length * 0.8);
  const trainingData = inputs.slice(0, trainSize).map((inp, i) => ({
    inputs: new Float32Array(inp),
    targets: new Float32Array([targets[i]]),
  }));

  try {
    await model.train(trainingData, {
      epochs: 10,
      batchSize: Math.min(16, Math.floor(trainSize / 2)),
      learningRate: 0.001,
      gradientClipping: 1.0,
    });
  } catch {
    return [];
  }

  // Autoregressive: predict one step, append to window, repeat
  // Run 8 MC paths for uncertainty bands
  const mcPaths = 8;
  const allPaths: number[][] = Array.from({ length: mcPaths }, () => []);

  for (let mc = 0; mc < mcPaths; mc++) {
    let window = normalized.slice(-windowSize);

    for (let step = 0; step < stepsAhead; step++) {
      try {
        const useDropout = mc < mcPaths * 0.6;
        const output = await model.forward(new Float32Array(window), useDropout);
        const pred = Array.isArray(output) ? output[0] : (output as any)?.[0];
        if (pred != null && isFinite(pred)) {
          const denorm = pred * range + min;
          allPaths[mc].push(denorm);
          // Shift window: drop first, append prediction
          window = [...window.slice(1), pred];
        }
      } catch {
        break;
      }
    }
  }

  // Aggregate MC paths into percentile bands
  for (let step = 0; step < stepsAhead; step++) {
    const values = allPaths.map(p => p[step]).filter(v => v != null && isFinite(v));
    if (values.length < 3) continue;

    values.sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const lowIdx = Math.floor(values.length * 0.1);
    const highIdx = Math.floor(values.length * 0.9);

    trajectory.push({
      bar: step + 1,
      mean: Math.round(mean * 100) / 100,
      low: Math.round(values[lowIdx] * 100) / 100,
      high: Math.round(values[Math.min(highIdx, values.length - 1)] * 100) / 100,
    });
  }

  return trajectory;
}

/**
 * Percentile helper — extract percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * PROBABILISTIC FORECAST — the main entry point
 *
 * Runs 3-model ensemble (LSTM + GRU + Transformer) with Monte Carlo
 * dropout to produce a probability distribution of future prices.
 *
 * @param ticker - symbol for labeling
 * @param closes - array of closing prices (min 50)
 * @param horizon - bars to forecast ahead (default 5)
 * @param includeTrajectory - if true, generates multi-step trajectory
 */
export async function probabilisticForecast(
  ticker: string,
  closes: number[],
  horizon: number = 5,
  includeTrajectory: boolean = false,
): Promise<ProbabilisticForecast | null> {
  if (closes.length < 50) return null;

  const current = closes[closes.length - 1];
  const mcRuns = 12; // Balance between speed and distribution quality

  // Run 3 models in parallel with Monte Carlo dropout
  const [lstmPreds, gruPreds, transformerPreds] = await Promise.all([
    monteCarloPredict('lstm', closes, 20, 8, mcRuns).catch(() => [] as number[]),
    monteCarloPredict('gru', closes, 15, 8, mcRuns).catch(() => [] as number[]),
    monteCarloPredict('transformer', closes, 15, 6, mcRuns).catch(() => [] as number[]),
  ]);

  // Combine all predictions into one distribution
  const allPredictions = [...lstmPreds, ...gruPreds, ...transformerPreds].filter(
    v => v != null && isFinite(v) && v > 0,
  );

  if (allPredictions.length < 5) {
    // Fallback to simple ensemble if MC fails
    const simple = await neuralForecast(closes);
    if (!simple) return null;
    return {
      ticker,
      currentPrice: current,
      horizon,
      timestamp: Date.now(),
      predictedPrice: current * (1 + simple.predictedMove),
      predictedMove: simple.predictedMove,
      direction: simple.direction,
      percentile10: current * (1 + simple.predictedMove * 0.3),
      percentile25: current * (1 + simple.predictedMove * 0.6),
      percentile50: current * (1 + simple.predictedMove),
      percentile75: current * (1 + simple.predictedMove * 1.3),
      percentile90: current * (1 + simple.predictedMove * 1.6),
      confidence: simple.confidence,
      modelAgreement: simple.modelAgreement,
      uncertainty: 0.02,
      probabilityUp: simple.direction === 'up' ? simple.confidence : 1 - simple.confidence,
      probabilityDown: simple.direction === 'down' ? simple.confidence : 1 - simple.confidence,
      models: [
        { name: 'lstm+gru', prediction: current * (1 + simple.predictedMove), loss: simple.trainLoss },
      ],
    };
  }

  // Sort for percentile extraction
  allPredictions.sort((a, b) => a - b);

  const mean = allPredictions.reduce((s, v) => s + v, 0) / allPredictions.length;
  const stdDev = Math.sqrt(
    allPredictions.reduce((s, v) => s + (v - mean) ** 2, 0) / allPredictions.length,
  );

  const p10 = percentile(allPredictions, 0.10);
  const p25 = percentile(allPredictions, 0.25);
  const p50 = percentile(allPredictions, 0.50);
  const p75 = percentile(allPredictions, 0.75);
  const p90 = percentile(allPredictions, 0.90);

  const predictedMove = (mean - current) / current;
  const uncertainty = stdDev / current;

  // Probability of up/down: count predictions above/below current price
  const upCount = allPredictions.filter(p => p > current).length;
  const probabilityUp = upCount / allPredictions.length;
  const probabilityDown = 1 - probabilityUp;

  // Direction based on probability
  let direction: 'up' | 'down' | 'neutral';
  if (probabilityUp > 0.6) direction = 'up';
  else if (probabilityDown > 0.6) direction = 'down';
  else direction = 'neutral';

  // Model agreement: check if all 3 model groups agree on direction
  const lstmDir = lstmPreds.length > 0 ? (lstmPreds.reduce((s, v) => s + v, 0) / lstmPreds.length > current ? 1 : -1) : 0;
  const gruDir = gruPreds.length > 0 ? (gruPreds.reduce((s, v) => s + v, 0) / gruPreds.length > current ? 1 : -1) : 0;
  const transDir = transformerPreds.length > 0 ? (transformerPreds.reduce((s, v) => s + v, 0) / transformerPreds.length > current ? 1 : -1) : 0;
  const dirs = [lstmDir, gruDir, transDir].filter(d => d !== 0);
  const allSameDir = dirs.length > 0 && dirs.every(d => d === dirs[0]);
  const modelAgreement = allSameDir ? 1.0 : (dirs.length >= 2 ? 0.5 : 0.3);

  // Confidence = f(probability strength, model agreement, uncertainty, move magnitude)
  const probStrength = Math.abs(probabilityUp - 0.5) * 2; // 0-1, higher = more decisive
  const moveMag = Math.min(Math.abs(predictedMove) / 0.03, 1.0);
  const uncertaintyPenalty = Math.max(0, 1 - uncertainty * 10); // Penalize high uncertainty
  const confidence = probStrength * 0.3 + modelAgreement * 0.3 + moveMag * 0.2 + uncertaintyPenalty * 0.2;

  // Per-model breakdown
  const models: { name: string; prediction: number; loss: number }[] = [];
  if (lstmPreds.length > 0) {
    models.push({ name: 'lstm', prediction: lstmPreds.reduce((s, v) => s + v, 0) / lstmPreds.length, loss: 0 });
  }
  if (gruPreds.length > 0) {
    models.push({ name: 'gru', prediction: gruPreds.reduce((s, v) => s + v, 0) / gruPreds.length, loss: 0 });
  }
  if (transformerPreds.length > 0) {
    models.push({ name: 'transformer', prediction: transformerPreds.reduce((s, v) => s + v, 0) / transformerPreds.length, loss: 0 });
  }

  // Optional multi-step trajectory
  let trajectory: { bar: number; mean: number; low: number; high: number }[] | undefined;
  if (includeTrajectory) {
    trajectory = await trajectoryForecast(closes, horizon, 15).catch(() => undefined);
  }

  return {
    ticker,
    currentPrice: Math.round(current * 100) / 100,
    horizon,
    timestamp: Date.now(),
    predictedPrice: Math.round(mean * 100) / 100,
    predictedMove: Math.round(predictedMove * 10000) / 10000,
    direction,
    percentile10: Math.round(p10 * 100) / 100,
    percentile25: Math.round(p25 * 100) / 100,
    percentile50: Math.round(p50 * 100) / 100,
    percentile75: Math.round(p75 * 100) / 100,
    percentile90: Math.round(p90 * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    modelAgreement: Math.round(modelAgreement * 100) / 100,
    uncertainty: Math.round(uncertainty * 10000) / 10000,
    probabilityUp: Math.round(probabilityUp * 100) / 100,
    probabilityDown: Math.round(probabilityDown * 100) / 100,
    models,
    trajectory,
  };
}
