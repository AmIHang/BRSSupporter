import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** BSM tickets matching the configured filter, as last seen by the sync. */
export const tickets = sqliteTable('tickets', {
  /** BSM ticket number, unique across all applications (e.g. "ELLBg0169"). */
  number: text('number').primaryKey(),
  summary: text('summary'),
  status: text('status').notNull(),
  applicationName: text('application_name'),
  projectName: text('project_name'),
  categoryName: text('category_name'),
  /** BSM usernames; details in `data.users`. */
  reporter: text('reporter'),
  handler: text('handler'),
  link: text('link'),
  createDate: text('create_date').notNull(),
  changeDate: text('change_date').notNull(),
  /** The full BSM response (indication + referenced users) as JSON. */
  data: text('data').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  /** OTMA ticket of the main work package ("Hauptarbeitspaket"), looked up while open. */
  otmaNumber: text('otma_number'),
  /** When the OTMA number was last looked up; again only after the ticket changed. */
  otmaCheckedAt: text('otma_checked_at'),
  /** "Verantwortlich" of the OTMA ticket (display name); null = none or not looked up yet. */
  otmaResponsible: text('otma_responsible'),
  /** Status of the OTMA ticket (e.g. "In Arbeit"), looked up with the responsible person. */
  otmaStatus: text('otma_status'),
  /** Last lookup of the responsible person; open tickets are refreshed in batches. */
  otmaResponsibleAt: text('otma_responsible_at'),
  /** Set when a complete snapshot no longer contains the ticket (left the filter). */
  goneAt: text('gone_at'),
});

/** BSM applications accessible by the user, with their customer (GET /personal/api/application). */
export const applications = sqliteTable('applications', {
  name: text('name').primaryKey(),
  shortName: text('short_name'),
  customer: text('customer').notNull(),
});

/** Small internal state, e.g. when the last sync ran (key/value). */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Customers of the applications, with user settings. */
export const customers = sqliteTable('customers', {
  name: text('name').primaryKey(),
  /** User-chosen color ("#rrggbb") for the ticket number chip; null = computed by the app. */
  color: text('color'),
  /** Link to the customer's TFS repository (Git or TFVC); default for its projects. */
  repoUrl: text('repo_url'),
  /** Wiki of that repository's TFS project, found when the link was saved. */
  wikiUrl: text('wiki_url'),
  /** TV ("Technical Lead") from that wiki's Security Architecture page; refreshed daily. */
  technicalLead: text('technical_lead'),
  /** Latest release per system from that wiki's Releases page, JSON (Release[]); refreshed hourly. */
  releases: text('releases'),
  /** Who pushed or opened pull requests in that repository lately, JSON (Contributor[]); hourly. */
  contributors: text('contributors'),
});

/**
 * BSM projects seen in synced tickets. Project names are only unique within an application,
 * hence the composite key ('' for tickets without application).
 */
export const projects = sqliteTable(
  'projects',
  {
    applicationName: text('application_name').notNull(),
    name: text('name').notNull(),
    /** User setting: tickets of this project are not shown. */
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    /** Link to the project's TFS repository; null = the customer's applies. */
    repoUrl: text('repo_url'),
    /** Wiki of that repository's TFS project, found when the link was saved. */
    wikiUrl: text('wiki_url'),
    /** TV ("Technical Lead") from that wiki's Security Architecture page; refreshed daily. */
    technicalLead: text('technical_lead'),
    /** Latest release per system from that wiki's Releases page, JSON (Release[]). */
    releases: text('releases'),
    /** Who pushed or opened pull requests in that repository lately, JSON (Contributor[]). */
    contributors: text('contributors'),
    firstSeenAt: text('first_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.applicationName, t.name] })],
);
