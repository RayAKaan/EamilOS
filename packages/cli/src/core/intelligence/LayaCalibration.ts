import type { LayaAnswer, LayaCalibrationConfig, LayaDecision } from './LayaDecisionTypes.js';

function clamp(value: number) { return Math.min(1, Math.max(0, value)); }
function normalize(probabilities: Record<string, number>) {
  const values = Object.entries(probabilities).map(([key, value]) => [key, Math.max(0, value)] as const);
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  return total ? Object.fromEntries(values.map(([key, value]) => [key, value / total])) : Object.fromEntries(values.map(([key]) => [key, 0]));
}
function temperatureScale(probabilities: Record<string, number>, temperature: number) {
  if (temperature === 1) return normalize(probabilities);
  const t = Math.max(0.05, temperature);
  const logits = Object.entries(normalize(probabilities)).map(([key, probability]) => [key, Math.log(Math.max(1e-12, probability)) / t] as const);
  const max = Math.max(...logits.map(([, value]) => value));
  const exps = logits.map(([key, value]) => [key, Math.exp(value - max)] as const);
  const total = exps.reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(exps.map(([key, value]) => [key, value / total]));
}
function entropyConfidence(probabilities: Record<string, number>) {
  const values = Object.values(normalize(probabilities)).filter(value => value > 0);
  if (values.length <= 1) return 1;
  const entropy = -values.reduce((sum, value) => sum + value * Math.log(value), 0);
  return clamp(1 - entropy / Math.log(values.length));
}
function transform(answer: LayaAnswer, temperature: number): LayaAnswer {
  if (answer.type === 'choice') {
    const probabilities = temperatureScale(answer.probabilities, temperature);
    const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? answer.choice;
    return { ...answer, choice, probabilities, confidence: entropyConfidence(probabilities), answerConfidence: Math.max(...Object.values(probabilities), 0) };
  }
  if (answer.type === 'score') {
    const probabilities = temperatureScale(answer.probabilities, temperature);
    const score = Object.entries(probabilities).reduce((sum, [index, probability]) => sum + Number(index) * probability, 0);
    return { ...answer, score, probabilities, confidence: entropyConfidence(probabilities), answerConfidence: Math.max(...Object.values(probabilities), 0) };
  }
  const p = clamp(answer.noul);
  const t = Math.max(0.05, temperature);
  const logit = Math.log(Math.max(1e-12, p) / Math.max(1e-12, 1 - p));
  const scaled = 1 / (1 + Math.exp(-logit / t));
  return { ...answer, noul: scaled, confidence: Math.max(scaled, 1 - scaled), answerConfidence: Math.max(scaled, 1 - scaled) };
}
export class LayaCalibration {
  constructor(private readonly config: LayaCalibrationConfig) {}
  apply(questionId: string, answer: LayaAnswer): LayaDecision {
    const temperature = answer.type === 'choice' ? this.config.choiceTemperature : answer.type === 'score' ? this.config.scoreTemperature : this.config.noulTemperature;
    const calibrated = this.config.enabled ? transform(answer, temperature) : answer;
    const confidence = calibrated.answerConfidence ?? calibrated.confidence ?? (calibrated.type === 'noul' ? Math.max(calibrated.noul, 1 - calibrated.noul) : 0);
    const probability = calibrated.type === 'noul' ? Math.max(calibrated.noul, 1 - calibrated.noul) : Math.max(...Object.values(calibrated.probabilities), 0);
    return { questionId, type: calibrated.type, answer: calibrated, calibrated: this.config.enabled, temperature, accepted: confidence >= this.config.minimumConfidence && probability >= this.config.minimumProbability, threshold: this.config.minimumProbability };
  }
}
