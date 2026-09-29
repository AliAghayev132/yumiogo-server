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
 * open; otherwise computed from the weekly hours in the app timezone.
 */
const computeOpenNow = ({ hours, temporarilyClosed }, date = new Date(), timezone = currentTimezone) => {
  if (temporarilyClosed) return false;
  if (!hasHours(hours)) return true;
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

/** Minutes since midnight → "11:00 PM" (12-hour clock, as in the Figma Hours sheet). */
const formatTime12 = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

/**
 * Current open/closed status in the app timezone, with the strings the cards
 * and the Hours sheet show:
 *   { isOpen, state, label, openUntil, opensAt, opensDay }
 * state: "open" | "open24h" | "noHours" | "closed" | "temporarilyClosed".
 */
const openStatus = ({ hours, temporarilyClosed }, date = new Date(), timezone = currentTimezone) => {
  const base = { openUntil: null, opensAt: null, opensDay: null };
  if (temporarilyClosed) {
    return { ...base, isOpen: false, state: "temporarilyClosed", label: "Temporarily closed" };
  }
  if (!hasHours(hours)) return { ...base, isOpen: true, state: "noHours", label: "Open now" };

  const { day, minutes } = zonedNow(date, timezone);
  const index = DAY_KEYS.indexOf(day);
  const today = slotOf(dayEntry(hours, day));
  const yesterday = slotOf(dayEntry(hours, DAY_KEYS[(index + 6) % 7]));

  // Open: yesterday's slot spilling past midnight, or today's slot.
  if (yesterday && yesterday.close < yesterday.open && minutes < yesterday.close) {
    const openUntil = formatTime12(yesterday.close);
    return { ...base, isOpen: true, state: "open", label: `Open until ${openUntil}`, openUntil };
  }
  if (today) {
    if (today.open === today.close) {
      return { ...base, isOpen: true, state: "open24h", label: "Open 24 hours" };
    }
    const inSlot =
      today.close > today.open
        ? minutes >= today.open && minutes < today.close
        : minutes >= today.open;
    if (inSlot) {
      const openUntil = formatTime12(today.close);
      return { ...base, isOpen: true, state: "open", label: `Open until ${openUntil}`, openUntil };
    }
    if (minutes < today.open) {
      const opensAt = formatTime12(today.open);
      return {
        ...base,
        isOpen: false,
        state: "closed",
        label: `Closed · Opens at ${opensAt}`,
        opensAt,
        opensDay: day,
      };
    }
  }

  // Closed for the rest of today → the next day with a slot.
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const nextDay = DAY_KEYS[(index + ahead) % 7];
    const slot = slotOf(dayEntry(hours, nextDay));
    if (!slot) continue;
    const opensAt = formatTime12(slot.open);
    const when = ahead === 1 ? "tomorrow" : DAY_NAMES[nextDay];
    return {
      ...base,
      isOpen: false,
      state: "closed",
      label: `Closed · Opens ${when} at ${opensAt}`,
      opensAt,
      opensDay: nextDay,
    };
  }
  return { ...base, isOpen: false, state: "closed", label: "Closed" };
};

/**
 * The week for the Hours sheet, Sunday first (Figma 1:14965):
 * [{ day, name, isToday, closed, open, close, text }] with 12-hour times;
 * an unset day has text "" (unknown). Empty when no hours are configured.
 */
const hoursWeek = (hours, date = new Date(), timezone = currentTimezone) => {
  if (!hasHours(hours)) return [];
  const { day: todayKey } = zonedNow(date, timezone);
  return DAY_KEYS.map((day) => {
    const entry = dayEntry(hours, day);
    const slot = slotOf(entry);
    const closed = !!entry?.closed;
    let text = "";
    if (closed) text = "Closed";
    else if (slot && slot.open === slot.close) text = "Open 24 hours";
    else if (slot) text = `${formatTime12(slot.open)} - ${formatTime12(slot.close)}`;
    return {
      day,
      name: DAY_NAMES[day],
      isToday: day === todayKey,
      closed,
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
  openStatus,
  hoursWeek,
};
