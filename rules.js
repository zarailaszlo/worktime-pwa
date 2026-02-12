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
  const netMinutes = netMinutesFromGross(grossMinutes, rules);
  return Math.max(0, grossMinutes - netMinutes);
}

export function netMinutesFromGross(grossMinutes, rules){
  let netMinutes = Math.max(0, Math.floor(grossMinutes));
  let prevDeduction = 0;

  for(const r of normalizeRules(rules)){
    if(grossMinutes < r.thresholdMin) break;

    const thresholdNet = Math.max(0, r.thresholdMin - prevDeduction);
    netMinutes = Math.max(thresholdNet, grossMinutes - r.deductionMin);
    prevDeduction = r.deductionMin;
  }

  return Math.max(0, netMinutes);
}

export function summarizeWork(startMs, endMs, rules){
  const grossMinutes = floorMinutesBetween(startMs, endMs);
  if(grossMinutes < 0) throw new Error('NEGATIVE_DURATION');
  const deductionMin = deductionMinutes(grossMinutes, rules);
  const netMinutes = Math.max(0, grossMinutes - deductionMin);
  return { grossMinutes, deductionMin, netMinutes };
}

export function targetGrossForNet(targetNetMinutes, rules){
  if(targetNetMinutes <= 0) return 0;

  const target = Math.floor(targetNetMinutes);
  let low = 0;
  let high = Math.max(1, target);

  while(netMinutesFromGross(high, rules) < target){
    high *= 2;
  }

  while(low < high){
    const mid = Math.floor((low + high) / 2);
    if(netMinutesFromGross(mid, rules) >= target){
      high = mid;
    }else{
      low = mid + 1;
    }
  }

  return low;
}

export function targetTimeMsForNet({checkInMs, targetNetMinutes, rules}){
  const grossNeeded = targetGrossForNet(targetNetMinutes, rules);
  return checkInMs + grossNeeded * 60000;
}

export function achievedAtMs({checkInMs, checkOutMsOrNow, targetNetMinutes, rules}){
  const t = targetTimeMsForNet({ checkInMs, targetNetMinutes, rules });
  return (checkOutMsOrNow >= t) ? t : null;
}
