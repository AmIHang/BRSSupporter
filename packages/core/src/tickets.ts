import { and, asc, desc, eq, inArray, isNull, ne, not, or, sql } from 'drizzle-orm';
import type { BsmApplication, BsmIndication, BsmUser } from './bsm.js';
import type { Clock } from './clock.js';
import type { Db } from './db/open.js';
import { applications, customers, projects, tickets } from './db/schema.js';

/** Project name of the entry standing for an application's tickets without project. */
export const NO_PROJECT = '';
/** Key of the pseudo group of all NO_PROJECT entries (cannot collide with a customer name). */
const NO_PROJECT_GROUP = '\0no-project';

export interface Project {
  /** '' for tickets without application. */
  applicationName: string;
  /** NO_PROJECT ('') for the application's tickets without project. */
  name: string;
  /** null when the application is not in BSM's application list. */
  customer: string | null;
  /** User-chosen color of the customer ("#rrggbb"); null = computed by the app. */
  customerColor: string | null;
  hidden: boolean;
}

export class ProjectService {
  constructor(private readonly db: Db) {}

  list(): Project[] {
    return this.db
      .select({
        applicationName: projects.applicationName,
        name: projects.name,
        customer: applications.customer,
        customerColor: customers.color,
        hidden: projects.hidden,
      })
      .from(projects)
      .leftJoin(applications, eq(applications.name, projects.applicationName))
      .leftJoin(customers, eq(customers.name, applications.customer))
      .orderBy(asc(applications.customer), asc(projects.applicationName), asc(projects.name))
      .all();
  }

  /**
   * Hides/shows all real projects of a customer (not its "without project" entries, which form a
   * group of their own). Returns false when the customer is unknown.
   */
  setCustomerHidden(customer: string, hidden: boolean): boolean {
    const apps = this.db
      .select({ name: applications.name })
      .from(applications)
      .where(eq(applications.customer, customer));
    if (!apps.all().length) return false;
    this.db
      .update(projects)
      .set({ hidden })
      .where(and(inArray(projects.applicationName, apps), ne(projects.name, NO_PROJECT)))
      .run();
    return true;
  }

  /** Sets ("#rrggbb") or resets (null) the customer color. Returns false for unknown customers. */
  setCustomerColor(customer: string, color: string | null): boolean {
    return (
      this.db.update(customers).set({ color }).where(eq(customers.name, customer)).run().changes > 0
    );
  }

  /** Returns false when the project is unknown. */
  setHidden(applicationName: string, name: string, hidden: boolean): boolean {
    const res = this.db
      .update(projects)
      .set({ hidden })
      .where(and(eq(projects.applicationName, applicationName), eq(projects.name, name)))
      .run();
    return res.changes > 0;
  }
}

export interface Ticket {
  number: string;
  summary: string | null;
  status: string;
  applicationName: string | null;
  projectName: string | null;
  categoryName: string | null;
  reporter: string | null;
  handler: string | null;
  link: string | null;
  createDate: string;
  changeDate: string;
  firstSeenAt: string;
  /** OTMA ticket of the main work package; null while new, unknown or without one. */
  otmaNumber: string | null;
  /** "Verantwortlich" of the OTMA ticket; refreshed in batches while in process. */
  otmaResponsible: string | null;
  customer: string | null;
  /** User-chosen color of the customer; null = computed by the app. */
  customerColor: string | null;
}

export interface SyncResult {
  added: string[];
  changed: string[];
  gone: string[];
  /** Part of `changed` whose status changed. */
  statusChanged: string[];
}

/** A ticket's project row ('' for tickets without application/project). */
const projectOfTicket = and(
  eq(projects.applicationName, sql`coalesce(${tickets.applicationName}, '')`),
  eq(projects.name, sql`coalesce(${tickets.projectName}, '')`),
);
/** With `projects` left-joined: the project is not hidden by the user. */
const projectShown = not(eq(sql`coalesce(${projects.hidden}, 0)`, 1));

export class TicketService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Tickets currently matching the filter: blockers first, then most recently changed. */
  list(): Ticket[] {
    return (
      this.db
        .select({
          number: tickets.number,
          summary: tickets.summary,
          status: tickets.status,
          applicationName: tickets.applicationName,
          projectName: tickets.projectName,
          categoryName: tickets.categoryName,
          reporter: tickets.reporter,
          handler: tickets.handler,
          link: tickets.link,
          createDate: tickets.createDate,
          changeDate: tickets.changeDate,
          firstSeenAt: tickets.firstSeenAt,
          otmaNumber: tickets.otmaNumber,
          otmaResponsible: tickets.otmaResponsible,
          customer: applications.customer,
          customerColor: customers.color,
        })
        .from(tickets)
        .leftJoin(applications, eq(applications.name, tickets.applicationName))
        .leftJoin(customers, eq(customers.name, applications.customer))
        .leftJoin(projects, projectOfTicket)
        .where(and(isNull(tickets.goneAt), projectShown))
        // Blockers always on top, then most recently changed.
        .orderBy(
          desc(sql`coalesce(${tickets.categoryName} = 'Blocker', 0)`),
          desc(tickets.changeDate),
          asc(tickets.number),
        )
        .all()
    );
  }

  /**
   * In-process tickets whose OTMA number was never looked up, or that are still without one and
   * changed since (the main work package may have been set later). A found number is kept for
   * good. Closed tickets are not looked up. Most recently changed first.
   */
  otmaPending(): string[] {
    return this.db
      .select({ number: tickets.number })
      .from(tickets)
      .where(
        and(
          isNull(tickets.goneAt),
          eq(tickets.status, 'inprocess'),
          or(
            isNull(tickets.otmaCheckedAt),
            and(isNull(tickets.otmaNumber), sql`${tickets.changeDate} > ${tickets.otmaCheckedAt}`),
          ),
        ),
      )
      .orderBy(desc(tickets.changeDate))
      .all()
      .map((t) => t.number);
  }

  setOtmaNumber(number: string, otmaNumber: string | null): void {
    this.db
      .update(tickets)
      .set({ otmaNumber, otmaCheckedAt: this.clock.now().toISOString() })
      .where(eq(tickets.number, number))
      .run();
  }

  /**
   * Next batch of in-process tickets with an OTMA ticket whose responsible person is due:
   * never looked up first, then the longest ago – so repeated batches rotate through all.
   */
  otmaResponsibleDue(
    limit: number,
  ): { number: string; otmaNumber: string; otmaResponsible: string | null }[] {
    return (
      this.db
        .select({
          number: tickets.number,
          otmaNumber: sql<string>`${tickets.otmaNumber}`,
          otmaResponsible: tickets.otmaResponsible,
        })
        .from(tickets)
        // Only what the list shows: hidden projects would use up the batch for nothing.
        .leftJoin(projects, projectOfTicket)
        .where(
          and(
            isNull(tickets.goneAt),
            projectShown,
            eq(tickets.status, 'inprocess'),
            sql`${tickets.otmaNumber} is not null`,
          ),
        )
        .orderBy(
          sql`${tickets.otmaResponsibleAt} is not null`,
          asc(tickets.otmaResponsibleAt),
          asc(tickets.number),
        )
        .limit(limit)
        .all()
    );
  }

  setOtmaResponsible(number: string, otmaResponsible: string | null): void {
    this.db
      .update(tickets)
      .set({ otmaResponsible, otmaResponsibleAt: this.clock.now().toISOString() })
      .where(eq(tickets.number, number))
      .run();
  }

  /**
   * Applies a complete BSM snapshot. Idempotent: an unchanged snapshot writes nothing.
   * Only call with a complete snapshot – missing tickets are marked gone.
   */
  applySnapshot(
    indications: BsmIndication[],
    users: BsmUser[],
    apps: BsmApplication[] = [],
  ): SyncResult {
    return this.apply(indications, users, apps, 'missing');
  }

  /**
   * Applies the tickets changed since the last run (any status). Those still `matching` the
   * filter are added/updated, the others have left it and are marked gone. Unchanged tickets are
   * not in a delta, so nothing is marked gone for being missing.
   */
  applyDelta(
    changed: BsmIndication[],
    users: BsmUser[],
    apps: BsmApplication[],
    matching: (i: BsmIndication) => boolean,
  ): SyncResult {
    const left = changed.filter((i) => !matching(i)).map((i) => i.number);
    return this.apply(changed.filter(matching), users, apps, left);
  }

  /** `gone`: 'missing' = all known tickets not in `indications`; else these numbers. */
  private apply(
    indications: BsmIndication[],
    users: BsmUser[],
    apps: BsmApplication[],
    gone: 'missing' | string[],
  ): SyncResult {
    const now = this.clock.now().toISOString();
    const result: SyncResult = { added: [], changed: [], gone: [], statusChanged: [] };
    const userByName = new Map(users.map((u) => [u.username, u]));
    this.db.transaction((tx) => {
      for (const a of apps) {
        const row = { shortName: a.shortName ?? null, customer: a.customer };
        tx.insert(applications)
          .values({ name: a.name, ...row })
          .onConflictDoUpdate({
            target: applications.name,
            set: row,
            setWhere: or(
              ne(applications.customer, a.customer),
              sql`${applications.shortName} is not ${row.shortName}`,
            ),
          })
          .run();
        tx.insert(customers).values({ name: a.customer }).onConflictDoNothing().run();
      }
      // A group hidden as a whole stays hidden when it gets a new project. Groups: the customer,
      // or for tickets without project the pseudo group of all such entries.
      const customerOf = new Map(
        tx
          .select({ name: applications.name, customer: applications.customer })
          .from(applications)
          .all()
          .map((a) => [a.name, a.customer]),
      );
      const groupOf = (app: string, name: string) =>
        name === NO_PROJECT ? NO_PROJECT_GROUP : customerOf.get(app);
      const shownGroups = new Set<string>();
      const knownGroups = new Set<string>();
      for (const p of tx.select().from(projects).all()) {
        const g = groupOf(p.applicationName, p.name);
        if (g === undefined) continue;
        knownGroups.add(g);
        if (!p.hidden) shownGroups.add(g);
      }
      const groupHidden = (app: string, name: string) => {
        const g = groupOf(app, name);
        return g !== undefined && knownGroups.has(g) && !shownGroups.has(g);
      };

      const existing = new Map(
        tx
          .select({
            number: tickets.number,
            changeDate: tickets.changeDate,
            status: tickets.status,
            goneAt: tickets.goneAt,
          })
          .from(tickets)
          .all()
          .map((t) => [t.number, t]),
      );
      for (const i of indications) {
        const app = i.applicationName ?? '';
        const project = i.projectName ?? NO_PROJECT;
        tx.insert(projects)
          .values({
            applicationName: app,
            name: project,
            hidden: groupHidden(app, project),
            firstSeenAt: now,
          })
          .onConflictDoNothing()
          .run();
        const old = existing.get(i.number);
        existing.delete(i.number);
        if (old && old.changeDate === i.changeDate && old.goneAt === null) continue;
        const refs = new Set([i.reporter, i.handler, i.createBy, i.changeBy]);
        const row = {
          summary: i.summary ?? null,
          status: i.status,
          applicationName: i.applicationName ?? null,
          projectName: i.projectName ?? null,
          categoryName: i.categoryName ?? null,
          reporter: i.reporter ?? null,
          handler: i.handler ?? null,
          link: i.link ?? null,
          createDate: i.createDate,
          changeDate: i.changeDate,
          data: JSON.stringify({
            indication: i,
            users: [...refs].flatMap((r) => (r && userByName.get(r)) || []),
          }),
          goneAt: null,
        };
        if (old) {
          tx.update(tickets).set(row).where(eq(tickets.number, i.number)).run();
          result.changed.push(i.number);
          if (old.status !== i.status) result.statusChanged.push(i.number);
        } else {
          tx.insert(tickets)
            .values({ number: i.number, firstSeenAt: now, ...row })
            .run();
          result.added.push(i.number);
        }
      }
      const goneCandidates =
        gone === 'missing' ? [...existing.values()] : gone.flatMap((n) => existing.get(n) ?? []);
      for (const old of goneCandidates) {
        if (old.goneAt !== null) continue;
        tx.update(tickets).set({ goneAt: now }).where(eq(tickets.number, old.number)).run();
        result.gone.push(old.number);
      }
    });
    return result;
  }
}
