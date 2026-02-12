import { formatTimeHMFromMs } from './time.js';
import { summarizeWork } from './rules.js';

function escapeCsv(v){
  const s = String(v ?? '');
  if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}

export function recordsToCsv(records, rules){
  const header = ['date','checkIn','checkOut','grossMinutes','deductionMinutes','netMinutes'];
  const lines = [header.join(',')];
  for(const r of records){
    const checkIn = r.checkInMs ? formatTimeHMFromMs(r.checkInMs) : '';
    const checkOut = r.checkOutMs ? formatTimeHMFromMs(r.checkOutMs) : '';
    let grossMinutes = '';
    let deductionMinutes = '';
    let netMinutes = '';
    if(r.checkInMs && r.checkOutMs){
      const sum = summarizeWork(r.checkInMs, r.checkOutMs, rules);
      grossMinutes = sum.grossMinutes;
      deductionMinutes = sum.deductionMin;
      netMinutes = sum.netMinutes;
    }
    const row = [r.date, checkIn, checkOut, grossMinutes, deductionMinutes, netMinutes].map(escapeCsv).join(',');
    lines.push(row);
  }
  return lines.join('\n');
}

export function buildExportJson(records, settings){
  return {
    schemaVersion: settings?.schemaVersion ?? 1,
    exportedAt: new Date().toISOString(),
    settings,
    records,
  };
}

export function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function shareOrDownload({filename, mime, data}){
  const blob = new Blob([data], { type: mime });
  const file = new File([blob], filename, { type: mime });

  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  if(navigator.share && canShareFiles){
    await navigator.share({ files: [file], title: filename });
    return 'shared';
  }
  downloadBlob(filename, blob);
  return 'downloaded';
}

export async function readFileAsText(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

export function validateImportJson(json){
  if(!json || typeof json !== 'object') throw new Error('INVALID_JSON');
  if(!Array.isArray(json.records)) throw new Error('MISSING_RECORDS');
  if(!json.settings || typeof json.settings !== 'object') throw new Error('MISSING_SETTINGS');
  return true;
}
