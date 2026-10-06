// Is a symbol's market trading right now (including the extended sessions Yahoo
// prices)? Drives the live price poll: open markets are polled, closed ones are only
// fetched when a page asks (load / Refresh). Exchange holidays aren't modelled - a
// holiday is polled like a trading day, which is harmless (the price just doesn't move).

interface Session { tz: string; open: number; close: number } // minutes after local midnight, Mon–Fri

const US: Session = { tz: 'America/New_York', open: 4 * 60, close: 20 * 60 }; // pre-market 4:00 → after-hours 20:00
const BY_SUFFIX: Record<string, Session> = {
  AX: { tz: 'Australia/Sydney', open: 10 * 60, close: 16 * 60 + 15 },
  NZ: { tz: 'Pacific/Auckland', open: 10 * 60, close: 17 * 60 },
  L: { tz: 'Europe/London', open: 8 * 60, close: 16 * 60 + 35 },
  TO: { tz: 'America/Toronto', open: 9 * 60 + 30, close: 16 * 60 },
  V: { tz: 'America/Toronto', open: 9 * 60 + 30, close: 16 * 60 },
  NS: { tz: 'Asia/Kolkata', open: 9 * 60 + 15, close: 15 * 60 + 30 },
  BO: { tz: 'Asia/Kolkata', open: 9 * 60 + 15, close: 15 * 60 + 30 },
  HK: { tz: 'Asia/Hong_Kong', open: 9 * 60 + 30, close: 16 * 60 + 10 },
  T: { tz: 'Asia/Tokyo', open: 9 * 60, close: 15 * 60 + 30 },
  SI: { tz: 'Asia/Singapore', open: 9 * 60, close: 17 * 60 + 5 },
  DE: { tz: 'Europe/Berlin', open: 8 * 60, close: 22 * 60 },
  PA: { tz: 'Europe/Paris', open: 9 * 60, close: 17 * 60 + 35 },
  AS: { tz: 'Europe/Amsterdam', open: 9 * 60, close: 17 * 60 + 35 },
};
const INDEX_SESSION: Record<string, Session> = {
  '^AXJO': BY_SUFFIX.AX, '^AORD': BY_SUFFIX.AX, '^NSEI': BY_SUFFIX.NS, '^BSESN': BY_SUFFIX.NS,
  '^FTSE': BY_SUFFIX.L, '^N225': BY_SUFFIX.T, '^HSI': BY_SUFFIX.HK, '^GSPTSE': BY_SUFFIX.TO,
};

// Weekday (0 = Sunday) and minutes after midnight in a time zone.
function localTime(tz: string, now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function inSession(s: Session, now: Date): boolean {
  const { day, minutes } = localTime(s.tz, now);
  return day >= 1 && day <= 5 && minutes >= s.open && minutes < s.close;
}

export function isMarketOpen(symbol: string, now = new Date()): boolean {
  const sym = symbol.toUpperCase();
  if (sym.endsWith('-USD') || sym.endsWith('-AUD')) return true; // crypto trades around the clock
  if (sym.endsWith('=X') || sym.endsWith('=F')) {
    // FX / futures: Sunday 17:00 to Friday 17:00 New York time.
    const { day, minutes } = localTime('America/New_York', now);
    if (day === 6) return false;
    if (day === 0) return minutes >= 17 * 60;
    if (day === 5) return minutes < 17 * 60;
    return true;
  }
  if (INDEX_SESSION[sym]) return inSession(INDEX_SESSION[sym], now);
  const dot = sym.lastIndexOf('.');
  const suffix = dot > 0 ? sym.slice(dot + 1) : '';
  if (!suffix || sym.startsWith('^')) return inSession(US, now); // US listings and US indices
  const session = BY_SUFFIX[suffix];
  // Unknown exchange: poll on weekdays rather than miss it.
  return session ? inSession(session, now) : inSession({ tz: 'UTC', open: 0, close: 24 * 60 }, now);
}
