import { BSM_WORKFLOW_PATH, type BsmFetch } from './bsm.js';

/**
 * The OTMA number is not in the Personal API. It comes from the BSM ticket view, like the SPA
 * gets it (same requests as BRSOrganizer): the "Hauptarbeitspaket" link runs a read-only workflow
 * that answers with the OTMA URL.
 */

type Node = Record<string, unknown>;

/** All objects of a form tree, depth-first (children in `items` and `ui`). */
function nodes(root: unknown): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      const o = n as Node;
      out.push(o);
      walk(o.items);
      walk(o.ui);
    }
  };
  walk(root);
  return out;
}

/** The ticket view, as the SPA requests it after /indication/<number>. */
export function bsmTicketRequest(number: string) {
  return {
    ContextOPath: `|${number}|@BoomSupportManager.UI.IndicationIdentifier,BoomSupportManager.Core`,
    WorkflowType: 'External',
    WorkflowName: 'JumpToIndication',
    WorkflowParameters: { publicurl: `indication/${number}` },
  };
}

/** Context of the main work package's OTMA link in the ticket view, if it has one. */
export function otmaLinkContext(view: unknown): string | null {
  const link = nodes((view as { ui?: { form?: unknown } } | null)?.ui?.form).find(
    (n) =>
      n.feat === 'cfNameLink' &&
      (n.style as Node | undefined)?.link === 'Workflow:RedirectToOTMAByIndicationNumber',
  );
  const ctx = typeof link?.linkContext === 'string' ? link.linkContext.trim() : '';
  return /^\*[\w-]{4,200}$/.test(ctx) ? ctx : null;
}

/** What a click on that link runs (read-only, no transaction): answers with the OTMA URL. */
export function otmaRedirectRequest(linkContext: string) {
  return {
    ContextOPath: linkContext,
    WorkflowType: 'Edit',
    WorkflowName: 'RedirectToOTMAByIndicationNumber',
    TransactionBehavior: 'NoTransaction',
  };
}

/** "https://otma.boomsoftware.com//ap//177329" → "177329"; null otherwise. */
export function otmaNumberFromRedirect(answer: unknown): string | null {
  const url = (answer as { link?: { url?: unknown } } | null)?.link?.url;
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/otma\.boomsoftware\.com\/+ap\/+(\d{1,10})\/?$/.exec(url);
  return m ? m[1]! : null;
}

/** OTMA number of a BSM ticket's main work package, or null when it has none. */
export async function lookupOtmaNumber(fetch: BsmFetch, number: string): Promise<string | null> {
  const ctx = otmaLinkContext(await fetch(BSM_WORKFLOW_PATH, bsmTicketRequest(number)));
  if (!ctx) return null;
  return otmaNumberFromRedirect(await fetch(BSM_WORKFLOW_PATH, otmaRedirectRequest(ctx)));
}

/** First step: answers with a link to the ticket view (read-only). */
export function otmaJumpRequest(otmaNumber: string) {
  return {
    ContextOPath: `|${otmaNumber}|@BoomCRM.UI.OrderProcessIdentifier,BoomCRM.Core`,
    WorkflowEntity: 'BoomCRM.UI.OrderProcessIdentifier,BoomCRM.core',
    WorkflowType: 'External',
    WorkflowName: 'JumpToOrderProcess',
    WorkflowParameters: { publicurl: `ap/${otmaNumber}` },
  };
}

/** Second step: the "View" workflow the jump answer points to; null if it is not one. */
export function otmaViewRequest(jump: unknown) {
  const wf = (jump as { link?: { wf?: Node } } | null)?.link?.wf;
  const formname = (wf?.args as Node | undefined)?.formname;
  if (
    !wf ||
    typeof wf.contextopath !== 'string' ||
    !/^[0-9A-F]{1,12}@[0-9A-F]{1,12}$/i.test(wf.contextopath) ||
    wf.entity !== 'dotNetBF.Modules.Resources.OrderProcess' ||
    wf.type !== 'View' ||
    typeof formname !== 'string' ||
    !/^[\w-]{1,50}$/.test(formname)
  ) {
    return null;
  }
  return {
    ContextOPath: wf.contextopath,
    WorkflowEntity: wf.entity,
    WorkflowType: wf.type,
    WorkflowParameters: { formname },
  };
}

/** "Verantwortlich" of an OTMA ticket view; null when unset ("Kein … zugewiesen"). */
export function otmaResponsible(view: unknown): string | null {
  const n = nodes((view as { ui?: { form?: unknown } } | null)?.ui?.form).find(
    (n) => n.feat === 'cfResponsiblePersonDisplayText',
  );
  const v = typeof n?.value === 'string' ? n.value.trim() : '';
  return v && !/^Kein .* zugewiesen\??$/.test(v) ? v.slice(0, 200) : null;
}

/**
 * Responsible person of an OTMA ticket; `fetch` must go to OTMA (OTMA_ORIGIN). null also when OTMA
 * reports the ticket as missing (BSM can point to deleted ones); any other odd answer throws.
 */
export async function lookupOtmaResponsible(
  fetch: BsmFetch,
  otmaNumber: string,
): Promise<string | null> {
  const view = await fetchOtmaView(fetch, otmaNumber);
  return view === null ? null : otmaResponsible(view);
}

/**
 * Where an OTMA number's view lives (the jump's answer) does not change: remembered, so a check
 * needs one request instead of two. In memory only; after a restart the jump runs once again.
 * shortcut: never pruned – a few thousand small entries; bound it if numbers grow far beyond.
 */
const viewRequests = new Map<string, NonNullable<ReturnType<typeof otmaViewRequest>>>();

/** The OTMA ticket view; null when OTMA reports the ticket as missing. */
async function fetchOtmaView(fetch: BsmFetch, otmaNumber: string): Promise<unknown> {
  const known = viewRequests.get(otmaNumber);
  if (known) {
    const view = await fetch(BSM_WORKFLOW_PATH, known);
    // Anything but a form (moved, deleted, error answer): forget it and go the long way.
    if ((view as { ui?: { form?: unknown } } | null)?.ui?.form) return view;
    viewRequests.delete(otmaNumber);
  }
  const jump = await fetch(BSM_WORKFLOW_PATH, otmaJumpRequest(otmaNumber));
  // e.g. {"error":{"message":"Die Meldung mit der Nummer 138426 konnte nicht gefunden werden. …"}}
  const error = (jump as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof error === 'string' && /nicht gefunden/i.test(error)) return null;
  const request = otmaViewRequest(jump);
  if (!request) throw new Error(`OTMA: unerwartete Antwort für Ticket ${otmaNumber}`);
  viewRequests.set(otmaNumber, request);
  return fetch(BSM_WORKFLOW_PATH, request);
}
