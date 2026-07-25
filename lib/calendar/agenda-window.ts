/**
 * Agenda window for the Estate schedule: when the calendar cursor is on the
 * current (Sydney) month the agenda starts at today — past days are hidden;
 * any other month shows from day 1.
 *
 * `month` is 0-based, matching the EstateSchedule cursor state.
 * `todayIso` is a yyyy-MM-dd string (already Sydney-local upstream).
 */
export function agendaStartDay(
  cursor: { year: number; month: number },
  todayIso: string,
): number {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7)) - 1;
  if (cursor.year === year && cursor.month === month) {
    return Number(todayIso.slice(8, 10));
  }
  return 1;
}
