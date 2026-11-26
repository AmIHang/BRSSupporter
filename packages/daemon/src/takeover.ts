import { BSM_ORIGIN, BSM_WORKFLOW_PATH, camelKeys, type BsmFetch } from '@brssupporter/core';
import type { BrowserContext, Response } from 'playwright-core';

/** BSM ticket numbers as the Personal API returns them (e.g. "ELLBg0169", "BRS_PWg0163"). */
export const TICKET_NUMBER = /^\w{1,40}$/;

/** The SPA posts the edit form's model back to the take-over workflow; BSM answers `{saved: n}`. */
function isTakeOverSave(res: Response): boolean {
  const req = res.request();
  return (
    req.method() === 'POST' &&
    res.url() === `${BSM_ORIGIN}${BSM_WORKFLOW_PATH}` &&
    (req.postData() ?? '').includes('"WorkflowRunnerInfos"') &&
    (req.postData() ?? '').includes('TakeOverTicketDeveloper')
  );
}

/**
 * Takes over a BSM ticket as the user does in the BSM UI (recorded 2026-11-18): "Ticket
 * übernehmen" opens the ticket's edit form, saving it unchanged assigns the ticket to the user
 * (status new → inprocess). No public API for this, so it runs in the session's Edge.
 * Unsaved, nothing happens: BSM only writes on save.
 */
export async function takeOverTicket(
  fetch: BsmFetch,
  ctx: BrowserContext,
  number: string,
  timeoutMs = 30_000,
): Promise<void> {
  if (!TICKET_NUMBER.test(number)) throw new Error(`Ungültige Ticketnummer: ${number}`);
  // Fresh from BSM, not the local list: someone may have taken it over since the last sync.
  // Answer: { Indication: {..., Status}, Users } (PascalCase, like the query).
  const answer = camelKeys(await fetch(`/personal/api/indication/${number}`)) as {
    indication?: { status?: unknown };
  } | null;
  const status = answer?.indication?.status;
  if (status !== 'new') {
    throw new Error(`${number} ist nicht mehr neu (Status in BSM: ${String(status)})`);
  }

  const page = await ctx.newPage();
  try {
    await page.goto(`${BSM_ORIGIN}/indication/${number}`);
    await page.locator('a.command-TakeOverTicketDeveloper').click({ timeout: timeoutMs });
    const saved = page.waitForResponse(isTakeOverSave, { timeout: timeoutMs });
    // shortcut: the save button's selector was not seen (only reachable by taking over); the
    // title is from the recorded form definition. Check here first if takeovers time out.
    await page
      .locator('a.command-Save')
      .or(page.getByTitle('Änderungen speichern', { exact: true }))
      .first()
      .click({ timeout: timeoutMs });
    const res = await saved;
    const body = (await res.json().catch(() => null)) as { saved?: unknown } | null;
    if (!res.ok() || typeof body?.saved !== 'number' || body.saved < 1) {
      throw new Error(`BSM hat das Übernehmen von ${number} nicht gespeichert`);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}
