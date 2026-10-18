/**
 * Opening-hours helpers — derive Restaurant.openNow from its weekly `hours`.
 *
 * `hours` is keyed by day (mon..sun) → { open: "HH:mm", close: "HH:mm", closed }.
 * A close time earlier than the open time means the slot runs past midnight;
 * equal open/close means open around the clock.
 *
 * Pure functions + a tiny timezone cache so the (sync) Restaurant pre-save hook
 * can compute openNow without a DB read. OpeningHoursService keeps the cache in
 * sync with Settings.timezone.
 */

// JS getDay() order.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

let currentTimezone = "Asia/Baku";

/** True when `tz` is an IANA zone the runtime understands. */
const isValidTimezone = (tz) => {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (_err) {
    return false;
  }
};

const setTimezone = (tz) => {
  if (isValidTimezone(tz)) currentTimezone = tz;
};

const getTimezone = () => currentTimezone;

/** "HH:mm" → minutes since midnight, or null when malformed. */
const toMinutes = (value) => {
  const match = HHMM.exec(String(value ?? "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

// Works for both a Mongoose Map (documents) and a plain object (lean / aggregate).
const dayEntry = (hours, day) => {
  if (!hours) return null;
  return typeof hours.get === "function" ? hours.get(day) : hours[day];
};

// A day counts as configured when it is explicitly closed or has valid times.
const isConfigured = (entry) =>
  !!entry && (entry.closed === true || (toMinutes(entry.open) !== null && toMinutes(entry.close) !== null));

/** True when at least one weekday has hours set. */
const hasHours = (hours) => DAY_KEYS.some((day) => isConfigured(dayEntry(hours, day)));

/** { day: "mon", minutes } for `date` in `timezone`. */
const zonedNow = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    day: String(get("weekday")).slice(0, 3).toLowerCase(),
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
};

// Open/close minutes for a configured, not-closed day; null otherwise.
const slotOf = (entry) => {
  if (!entry || entry.closed) return null;
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);
  return open === null || close === null ? null : { open, close };
};

/** Is a restaurant with these weekly hours open at `date`? */
const isOpenAt = (hours, date = new Date(), timezone = currentTimezone) => {
  const { day, minutes } = zonedNow(date, timezone);
  const index = DAY_KEYS.indexOf(day);
  const previous = DAY_KEYS[(index + 6) % 7];

  const today = slotOf(dayEntry(hours, day));
  if (today) {
    if (today.open === today.close) return true; // 24h
    if (today.close > today.open) {
      if (minutes >= today.open && minutes < today.close) return true;
    } else if (minutes >= today.open) {
      return true; // runs past midnight, before midnight part
    }
  }

  // Yesterday's slot spilling past midnight.
  const yesterday = slotOf(dayEntry(hours, previous));
  return !!yesterday && yesterday.close < yesterday.open && minutes < yesterday.close;
};

/**
 * Derived Restaurant.openNow: temporarily closed → false; no hours configured →
 * false (unknown — never reported or filtered as "Open now"); otherwise
 * computed from the weekly hours in the app timezone.
 */
const computeOpenNow = ({ hours, temporarilyClosed }, date = new Date(), timezone = currentTimezone) => {
  if (temporarilyClosed) return false;
  if (!hasHours(hours)) return false;
  return isOpenAt(hours, date, timezone);
};

// ----- Display helpers (Hours sheet, "Open until 11:00 PM") -----

const DAY_NAMES = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

// Fallback `label` / `text` / `name` copy per language. Clients build their own
// text from the structured fields (state, openUntil, opensAt, opensDay,
// opensInDays, hoursWeek open/close); these strings are the fallback.
const COPY = {
  en: {
    days: DAY_NAMES,
    clock: "12h",
    temporarilyClosed: "Temporarily closed",
    noHours: "Hours not available",
    openUntil: (time) => `Open until ${time}`,
    open24h: "Open 24 hours",
    opensAt: (time) => `Closed · Opens at ${time}`,
    opensTomorrow: (time) => `Closed · Opens tomorrow at ${time}`,
    opensOn: (day, time) => `Closed · Opens ${day} at ${time}`,
    closed: "Closed",
  },
  az: {
    days: {
      sun: "Bazar",
      mon: "Bazar ertəsi",
      tue: "Çərşənbə axşamı",
      wed: "Çərşənbə",
      thu: "Cümə axşamı",
      fri: "Cümə",
      sat: "Şənbə",
    },
    clock: "24h",
    temporarilyClosed: "Müvəqqəti bağlıdır",
    noHours: "İş saatları məlum deyil",
    openUntil: (time) => `Açıqdır · ${time}-dək`,
    open24h: "24 saat açıqdır",
    opensAt: (time) => `Bağlıdır · Açılır: ${time}`,
    opensTomorrow: (time) => `Bağlıdır · Sabah açılır: ${time}`,
    opensOn: (day, time) => `Bağlıdır · Açılır: ${day}, ${time}`,
    closed: "Bağlıdır",
  },
  ru: {
    days: {
      sun: "Воскресенье",
      mon: "Понедельник",
      tue: "Вторник",
      wed: "Среда",
      thu: "Четверг",
      fri: "Пятница",
      sat: "Суббота",
    },
    clock: "24h",
    temporarilyClosed: "Временно закрыто",
    noHours: "Часы работы не указаны",
    openUntil: (time) => `Открыто до ${time}`,
    open24h: "Открыто круглосуточно",
    opensAt: (time) => `Закрыто · Откроется в ${time}`,
    opensTomorrow: (time) => `Закрыто · Откроется завтра в ${time}`,
    opensOn: (day, time) => `Закрыто · Откроется: ${day}, ${time}`,
    closed: "Закрыто",
  },
};

const copyOf = (lang) => COPY[lang] || COPY.en;

/** Minutes since midnight → "11:00 PM" (12-hour clock, as in the Figma Hours sheet). */
const formatTime12 = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

/** Minutes since midnight → "23:00". */
const formatTime24 = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Display time in the language's clock (labels only; structured fields stay 12h).
const displayTime = (minutes, copy) => (copy.clock === "24h" ? formatTime24(minutes) : formatTime12(minutes));

/**
 * Current open/closed status in the app timezone, with the strings the cards
 * and the Hours sheet show:
 *   { isOpen, state, label, openUntil, opensAt, opensDay, opensInDays }
 * state: "open" | "open24h" | "noHours" | "closed" | "temporarilyClosed".
 * "noHours" = unknown (no weekly hours configured): isOpen is false and the
 * label says the hours are not available. openUntil / opensAt are "11:00 PM";
 * `label` is in `lang` (en / az / ru, English by default).
 */
const openStatus = ({ hours, temporarilyClosed }, date = new Date(), timezone = currentTimezone, lang = "en") => {
  const copy = copyOf(lang);
  const base = { openUntil: null, opensAt: null, opensDay: null, opensInDays: null };
  if (temporarilyClosed) {
    return { ...base, isOpen: false, state: "temporarilyClosed", label: copy.temporarilyClosed };
  }
  if (!hasHours(hours)) return { ...base, isOpen: false, state: "noHours", label: copy.noHours };

  const { day, minutes } = zonedNow(date, timezone);
  const index = DAY_KEYS.indexOf(day);
  const today = slotOf(dayEntry(hours, day));
  const yesterday = slotOf(dayEntry(hours, DAY_KEYS[(index + 6) % 7]));

  // Open: yesterday's slot spilling past midnight, or today's slot.
  if (yesterday && yesterday.close < yesterday.open && minutes < yesterday.close) {
    const openUntil = formatTime12(yesterday.close);
    return { ...base, isOpen: true, state: "open", label: copy.openUntil(displayTime(yesterday.close, copy)), openUntil };
  }
  if (today) {
    if (today.open === today.close) {
      return { ...base, isOpen: true, state: "open24h", label: copy.open24h };
    }
    const inSlot =
      today.close > today.open
        ? minutes >= today.open && minutes < today.close
        : minutes >= today.open;
    if (inSlot) {
      const openUntil = formatTime12(today.close);
      return { ...base, isOpen: true, state: "open", label: copy.openUntil(displayTime(today.close, copy)), openUntil };
    }
    if (minutes < today.open) {
      return {
        ...base,
        isOpen: false,
        state: "closed",
        label: copy.opensAt(displayTime(today.open, copy)),
        opensAt: formatTime12(today.open),
        opensDay: day,
        opensInDays: 0,
      };
    }
  }

  // Closed for the rest of today → the next day with a slot.
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const nextDay = DAY_KEYS[(index + ahead) % 7];
    const slot = slotOf(dayEntry(hours, nextDay));
    if (!slot) continue;
    const time = displayTime(slot.open, copy);
    return {
      ...base,
      isOpen: false,
      state: "closed",
      label: ahead === 1 ? copy.opensTomorrow(time) : copy.opensOn(copy.days[nextDay], time),
      opensAt: formatTime12(slot.open),
      opensDay: nextDay,
      opensInDays: ahead,
    };
  }
  return { ...base, isOpen: false, state: "closed", label: copy.closed };
};

/**
 * The week for the Hours sheet, Sunday first (Figma 1:14965):
 * [{ day, name, isToday, closed, open24h, open, close, text }] with 12-hour
 * open / close times. Once any day has hours, a day without hours counts as
 * closed (as openStatus treats it). `name` / `text` are in `lang`. Empty when
 * no hours are configured.
 */
const hoursWeek = (hours, date = new Date(), timezone = currentTimezone, lang = "en") => {
  if (!hasHours(hours)) return [];
  const copy = copyOf(lang);
  const { day: todayKey } = zonedNow(date, timezone);
  return DAY_KEYS.map((day) => {
    const slot = slotOf(dayEntry(hours, day));
    const open24h = !!slot && slot.open === slot.close;
    let text = copy.closed;
    if (open24h) text = copy.open24h;
    else if (slot) text = `${displayTime(slot.open, copy)} - ${displayTime(slot.close, copy)}`;
    return {
      day,
      name: copy.days[day],
      isToday: day === todayKey,
      closed: !slot,
      open24h,
      open: slot ? formatTime12(slot.open) : null,
      close: slot ? formatTime12(slot.close) : null,
      text,
    };
  });
};

export {
  DAY_KEYS,
  DAY_NAMES,
  isValidTimezone,
  setTimezone,
  getTimezone,
  toMinutes,
  hasHours,
  isOpenAt,
  computeOpenNow,
  formatTime12,
  formatTime24,
  openStatus,
  hoursWeek,
};
