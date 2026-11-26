import { z } from 'zod';

export const BSM_ORIGIN = 'https://bsm.boomsoftware.com';
export const OTMA_ORIGIN = 'https://otma.boomsoftware.com';

/**
 * Network access to the BSM Personal API, injected (tests run without network).
 * GET without `body`, POST with JSON `body`; resolves to the parsed JSON response.
 */
export type BsmFetch = (path: string, body?: unknown) => Promise<unknown>;

/** Filter of POST /personal/api/queryIndications, passed through as is (BSM validates names). */
export const bsmFilterSchema = z.looseObject({
  textFilter: z.string().optional(),
  customerFilter: z.string().optional(),
  applicationFilter: z.string().optional(),
  projectFilter: z.string().optional(),
  applicationAreaFilter: z.string().optional(),
  mainCategoryFilter: z.enum(['ErrorMessage', 'SupportRequest', 'ChangeRequest']).optional(),
  categoryFilter: z.string().optional(),
  reporterFilter: z.string().optional(),
  handlerFilter: z.string().optional(),
  statusFilter: z
    .array(z.enum(['new', 'inprocess', 'delivered', 'completed', 'archived']))
    .optional(),
  tagFilter: z.array(z.string()).optional(),
});
export type BsmFilter = z.infer<typeof bsmFilterSchema>;

const userSchema = z.looseObject({
  username: z.string(),
  name: z.string().nullish(),
  eMail: z.string().nullish(),
});
export type BsmUser = z.infer<typeof userSchema>;

const indicationSchema = z.looseObject({
  number: z.string(),
  link: z.string().nullish(),
  applicationName: z.string().nullish(),
  projectName: z.string().nullish(),
  summary: z.string().nullish(),
  categoryName: z.string().nullish(),
  status: z.string(),
  createDate: z.string(),
  changeDate: z.string(),
  createBy: z.string().nullish(),
  changeBy: z.string().nullish(),
  reporter: z.string().nullish(),
  handler: z.string().nullish(),
});
export type BsmIndication = z.infer<typeof indicationSchema>;

// The key must be present: a response without it is unexpected, not an empty snapshot.
const queryResponseSchema = z.object({
  indications: z.array(indicationSchema).nullable(),
  users: z.array(userSchema).nullish(),
  limitExceeded: z.boolean().optional(),
});

/** BSM answers in PascalCase ("Indications", "Number"), unlike its OpenAPI doc; keys → camelCase. */
export function camelKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelKeys);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => [k.charAt(0).toLowerCase() + k.slice(1), camelKeys(x)]),
  );
}

const applicationsResponseSchema = z.object({
  applications: z.array(
    z.looseObject({ name: z.string(), shortName: z.string().nullish(), customer: z.string() }),
  ),
});
export type BsmApplication = z.infer<typeof applicationsResponseSchema>['applications'][number];

/** All applications accessible by the user, with their customer. */
export async function fetchApplications(fetch: BsmFetch): Promise<BsmApplication[]> {
  return applicationsResponseSchema.parse(camelKeys(await fetch('/personal/api/application')))
    .applications;
}

const PAGE_SIZE = 500;
/** Guard against an API that keeps reporting limitExceeded. */
const MAX_PAGES = 100;

/** All tickets matching `filter` (pages through limitExceeded): a complete snapshot or an error. */
export async function queryAllIndications(
  fetch: BsmFetch,
  filter: BsmFilter,
): Promise<{ indications: BsmIndication[]; users: BsmUser[] }> {
  const indications: BsmIndication[] = [];
  const users = new Map<string, BsmUser>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = queryResponseSchema.parse(
      camelKeys(
        await fetch('/personal/api/queryIndications', {
          filter,
          details: { includeLink: true, includePropertyValues: true, includeTags: true },
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      ),
    );
    indications.push(...(res.indications ?? []));
    for (const u of res.users ?? []) users.set(u.username, u);
    if (!res.limitExceeded) return { indications, users: [...users.values()] };
  }
  throw new Error(`BSM: more than ${MAX_PAGES * PAGE_SIZE} tickets, narrow the filter`);
}
