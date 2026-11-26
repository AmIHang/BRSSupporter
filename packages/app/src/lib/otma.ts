export const OTMA_TICKET_BASE = 'https://otma.boomsoftware.com/ap/';

/**
 * Who is actually responsible for an OTMA ticket. An arrow means a handover in progress:
 * "HAM -> GRA" is passed from HAM to GRA, and GRA is the one responsible.
 */
export const otmaResponsibleNow = (responsible: string): string =>
  responsible.split('->').at(-1)!.trim();
