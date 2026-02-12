export const TZ = 'Europe/Budapest';

const dtfDateKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dtfTimeHM = new Intl.DateTimeFormat('hu-HU', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function nowMs(){
  return Date.now();
}

export function dateKeyFromMs(ms){
  return dtfDateKey.format(ms); // YYYY-MM-DD
}

export function todayKey(){
  return dateKeyFromMs(nowMs());
}

export function formatTimeHMFromMs(ms){
  return dtfTimeHM.format(ms); // HH:MM
}

export function formatDateHUFromKey(dateKey){
  // dateKey: YYYY-MM-DD
  const [y,m,d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, year:'numeric', month:'long', day:'2-digit', weekday:'short' }).format(dt);
}

export function formatMinutesHHMM(totalMinutes){
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

export function floorMinutesBetween(startMs, endMs){
  return Math.floor((endMs - startMs) / 60000);
}

export function isValidHHMM(s){
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function partsFromZonedEpoch(ms, timeZone){
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t)=> parts.find(p=>p.type===t)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

function offsetMillisAt(ms, timeZone){
  // returns: (zonedTimeAsUTC - actualUTC) in ms
  const p = partsFromZonedEpoch(ms, timeZone);
  const asUTC = Date.UTC(p.year, p.month-1, p.day, p.hour, p.minute, p.second);
  return asUTC - ms;
}

export function zonedDateTimeToEpochMs({dateKey, timeHM, timeZone = TZ, preferNextDayIfBefore = false, notAfterMs = null}){
  // Converts a dateKey (YYYY-MM-DD) and time (HH:MM) in `timeZone` to epoch ms.
  // Uses a small iteration to handle DST.
  if(!isValidHHMM(timeHM)) throw new Error('INVALID_TIME');
  const [y,m,d] = dateKey.split('-').map(Number);
  const [hh,mm] = timeHM.split(':').map(Number);

  const buildEpoch = (addDays)=>{
    const baseUTC = Date.UTC(y, m-1, d + addDays, hh, mm, 0);
    let guess = baseUTC;
    for (let i=0;i<3;i++){
      const off = offsetMillisAt(guess, timeZone);
      const next = baseUTC - off;
      if (Math.abs(next - guess) < 1) return next;
      guess = next;
    }
    return guess;
  };

  let ms = buildEpoch(0);

  if(preferNextDayIfBefore && notAfterMs != null){
    // optional guard, used by callers.
  }

  if(preferNextDayIfBefore){
    // The caller will compare with a startMs; we only provide both candidates.
  }

  // If a maximum is specified (e.g. manual time cannot be in future), enforce.
  if(notAfterMs != null && ms > notAfterMs){
    throw new Error('FUTURE_TIME');
  }
  return ms;
}

export function addDaysDateKey(dateKey, days){
  const [y,m,d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dtfDateKey.format(dt);
}

export function deviceTimeZone(){
  return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
}

export function startMinuteTicker(fn){
  // runs fn immediately and then on each minute boundary (not every second)
  fn();
  const now = Date.now();
  const msToNextMinute = 60000 - (now % 60000);
  let intervalId = null;
  const timeoutId = setTimeout(() => {
    fn();
    intervalId = setInterval(fn, 60000);
  }, msToNextMinute + 10);

  return () => {
    clearTimeout(timeoutId);
    if(intervalId) clearInterval(intervalId);
  };
}
