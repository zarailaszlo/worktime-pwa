import { floorMinutesBetween } from './time.js';

export const DEFAULT_RULES = [
  { thresholdMin: 360, deductionMin: 30 },
  { thresholdMin: 540, deductionMin: 50 },
];

export function normalizeRules(rules){
  const cleaned = (rules || [])
    .map(r => ({ thresholdMin: Number(r.thresholdMin), deductionMin: Number(r.deductionMin) }))
    .filter(r => Number.isFinite(r.thresholdMin) && Number.isFinite(r.deductionMin))
    .map(r => ({ thresholdMin: Math.max(0, Math.floor(r.thresholdMin)), deductionMin: Math.max(0, Math.floor(r.deductionMin)) }))
    .sort((a,b) => a.thresholdMin - b.thresholdMin);

  // remove duplicates by threshold (keep last)
  const deduped = [];
  for(const r of cleaned){
    const idx = deduped.findIndex(x => x.thresholdMin === r.thresholdMin);
    if(idx >= 0) deduped[idx] = r; else deduped.push(r);
  }
  // Ensure strictly increasing thresholds (dedupe already). If still not, sort handled.
  return deduped;
}

export function deductionMinutes(grossMinutes, rules){
  let deduction = 0;
  for(const r of normalizeRules(rules)){
    if(grossMinutes > r.thresholdMin) deduction = r.deductionMin;
  }
  return deduction;
}

export function netMinutesFromGross(grossMinutes, rules){
  const d = deductionMinutes(grossMinutes, rules);
  return Math.max(0, grossMinutes - d);
}

export function summarizeWork(startMs, endMs, rules){
  const grossMinutes = floorMinutesBetween(startMs, endMs);
  if(grossMinutes < 0) throw new Error('NEGATIVE_DURATION');
  const deductionMin = deductionMinutes(grossMinutes, rules);
  const netMinutes = Math.max(0, grossMinutes - deductionMin);
  return { grossMinutes, deductionMin, netMinutes };
}

function buildSegments(rules){
  const rr = normalizeRules(rules);
  const segments = [];
  let prevThreshold = -1;
  let prevDed = 0;
  for(const r of rr){
    const end = r.thresholdMin;
    segments.push({ minGross: Math.max(0, prevThreshold + 1), maxGross: end, deductionMin: prevDed });
    prevThreshold = r.thresholdMin;
    prevDed = r.deductionMin;
  }
  segments.push({ minGross: Math.max(0, prevThreshold + 1), maxGross: Infinity, deductionMin: prevDed });
  return segments;
}

export function targetGrossForNet(targetNetMinutes, rules){
  if(targetNetMinutes <= 0) return 0;
  const segments = buildSegments(rules);
  for(const seg of segments){
    const grossNeeded = targetNetMinutes + seg.deductionMin;
    if(grossNeeded >= seg.minGross && grossNeeded <= seg.maxGross){
      return grossNeeded;
    }
  }
  // Should never happen due to Infinity last segment
  return targetNetMinutes;
}

export function targetTimeMsForNet({checkInMs, targetNetMinutes, rules}){
  const grossNeeded = targetGrossForNet(targetNetMinutes, rules);
  return checkInMs + grossNeeded * 60000;
}

export function achievedAtMs({checkInMs, checkOutMsOrNow, targetNetMinutes, rules}){
  const t = targetTimeMsForNet({ checkInMs, targetNetMinutes, rules });
  return (checkOutMsOrNow >= t) ? t : null;
}
