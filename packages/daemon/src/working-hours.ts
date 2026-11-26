/**
 * Mon–Fri 7:00–19:00 local time: background requests that are not needed right away (OTMA
 * responsible persons) only run then, like a person at work.
 */
export function isWorkingHours(d: Date): boolean {
  const day = d.getDay();
  const hour = d.getHours();
  return day >= 1 && day <= 5 && hour >= 7 && hour < 19;
}

/** 2–6 s, random: the pause between two OTMA tickets of a batch. */
export const ticketPause = (random = Math.random) =>
  new Promise<void>((r) => setTimeout(r, 2_000 + random() * 4_000));
