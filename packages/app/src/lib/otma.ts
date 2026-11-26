export const OTMA_TICKET_BASE = 'https://otma.boomsoftware.com/ap/';

/**
 * Who is actually responsible for an OTMA ticket. An arrow means a handover in progress:
 * "HAM -> GRA" is passed from HAM to GRA, and GRA is the one responsible.
 */
export const otmaResponsibleNow = (responsible: string): string =>
  responsible.split('->').at(-1)!.trim();

/** The responsible person to show; null when nobody or only the support queue ("BRS Support -"). */
export function otmaResponsiblePerson(responsible: string | null): string | null {
  const now = responsible && otmaResponsibleNow(responsible);
  return now && now !== 'BRS Support -' ? now : null;
}

const OTMA_STATUS_GROUPS: Record<string, string> = {
  Neu: 'In Arbeit',
  Zugewiesen: 'In Arbeit',
  Feedback: 'In Arbeit',
  Bestätigt: 'In Arbeit',
  Abgearbeitet: 'Abgearbeitet',
  Freigegeben: 'Freigegeben',
  Geschlossen: 'Erledigt',
};
/** OTMA status as shown: grouped for supporters; unknown ones as OTMA sends them. */
export const otmaStatusLabel = (status: string): string => OTMA_STATUS_GROUPS[status] ?? status;
