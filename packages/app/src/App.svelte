<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, type SyncState, type Ticket, type UpdateInfo } from './lib/api';
  import { customerColor, defaultColor, textOn } from './lib/colors';
  import { OTMA_TICKET_BASE, otmaResponsiblePerson, otmaStatusLabel } from './lib/otma';
  import { savedAlwaysOnTop, setAlwaysOnTop } from './lib/pin';
  import Settings from './Settings.svelte';

  let tickets = $state<Ticket[]>([]);
  let sync = $state<SyncState | null>(null);
  let error = $state<string | null>(null);
  /** Statuses switched off in the filter bar; by default only new and in process are shown. */
  let hiddenStatuses = $state<string[]>(['delivered', 'completed', 'archived']);
  let showSettings = $state(false);
  let pinned = $state(savedAlwaysOnTop());

  function closeSettings() {
    showSettings = false;
    // Hidden projects may have changed: reload the list on the way back.
    void refresh();
  }

  async function togglePinned() {
    const next = !pinned;
    try {
      await setAlwaysOnTop(next);
      pinned = next;
    } catch (e) {
      error = `Immer im Vordergrund: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const STATUS_LABELS: Record<string, string> = {
    new: 'Neu',
    inprocess: 'In Bearbeitung',
    delivered: 'Ausgeliefert',
    completed: 'Abgeschlossen',
    archived: 'Archiviert',
  };
  const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;
  /** Filter order as in STATUS_LABELS; unknown statuses last. */
  const statusRank = (s: string) => {
    const i = Object.keys(STATUS_LABELS).indexOf(s);
    return i < 0 ? Infinity : i;
  };

  /** BSM dates (UTC) in local time, e.g. "18.11.26, 10:02". */
  const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const formatDate = (iso: string) => dateFormat.format(new Date(iso));
  /** Wiki dates (YYYY-MM-DD) as "16.11.2026". */
  const formatDay = (ymd: string) => ymd.split('-').reverse().join('.');

  /** Number chip in the customer's color (chosen in the settings or computed). */
  function chipStyle(t: Ticket): string | undefined {
    const bg = customerColor(t);
    return bg ? `background: ${bg}; color: ${textOn(bg)}` : undefined;
  }

  const statusCounts = $derived(
    Object.entries(
      tickets.reduce<Record<string, number>>((c, t) => ((c[t.status] = (c[t.status] ?? 0) + 1), c), {}),
    ).sort(([a], [b]) => statusRank(a) - statusRank(b)),
  );
  /** BSM categories grouped by main category; anything not error or question counts as CR. */
  const KINDS = ['Bug', 'CR', 'Frage'] as const;
  type Kind = (typeof KINDS)[number];
  function kindOf(t: Ticket): Kind {
    const c = t.categoryName ?? '';
    if (/fehler|blocker|datenkorrektur/i.test(c)) return 'Bug';
    if (/frage|beratung/i.test(c)) return 'Frage';
    return 'CR';
  }
  let hiddenKinds = $state<Kind[]>([]);
  /** Filter bubbles: a click switches one value off or on again. */
  const toggled = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const toggleKind = (k: Kind) => (hiddenKinds = toggled(hiddenKinds, k));
  const toggleStatus = (s: string) => (hiddenStatuses = toggled(hiddenStatuses, s));
  const kindCount = (k: Kind) => tickets.filter((t) => kindOf(t) === k).length;

  /** Distributed: an OTMA responsible person other than the support queue. */
  const isDistributed = (t: Ticket) => otmaResponsiblePerson(t.otmaResponsible) !== null;
  /** Tri-state filter, a click goes to the next state. */
  const DISTRIBUTED = [
    ['all', 'Verteilt: alle'],
    ['yes', 'Nur verteilte'],
    ['no', 'Nur nicht verteilte'],
  ] as const;
  let distributed = $state<(typeof DISTRIBUTED)[number][0]>('all');
  const nextDistributed = () => {
    const i = DISTRIBUTED.findIndex(([v]) => v === distributed);
    distributed = DISTRIBUTED[(i + 1) % DISTRIBUTED.length]![0];
  };
  const distributedCount = $derived(tickets.filter(isDistributed).length);

  /** Second filter row: OTMA status groups (otmaStatusLabel); tickets without one count apart. */
  const NO_OTMA = 'Ohne OTMA-Status';
  const OTMA_ORDER = ['In Arbeit', 'Abgearbeitet', 'Freigegeben', 'Erledigt'];
  const otmaGroup = (t: Ticket) => (t.otmaStatus ? otmaStatusLabel(t.otmaStatus) : NO_OTMA);
  const otmaRank = (g: string) =>
    g === NO_OTMA ? Infinity : OTMA_ORDER.includes(g) ? OTMA_ORDER.indexOf(g) : OTMA_ORDER.length;
  const otmaCounts = $derived(
    Object.entries(
      tickets.reduce<Record<string, number>>((c, t) => ((c[otmaGroup(t)] = (c[otmaGroup(t)] ?? 0) + 1), c), {}),
    ).sort(([a], [b]) => otmaRank(a) - otmaRank(b)),
  );
  let hiddenOtma = $state<string[]>([]);
  /** Tickets whose details are unfolded. */
  let openDetails = $state<string[]>([]);

  const shown = $derived(
    tickets.filter(
      (t) =>
        !hiddenStatuses.includes(t.status) &&
        !hiddenKinds.includes(kindOf(t)) &&
        (distributed === 'all' || isDistributed(t) === (distributed === 'yes')) &&
        !hiddenOtma.includes(otmaGroup(t)),
    ),
  );

  async function refresh() {
    try {
      [tickets, sync] = await Promise.all([api.tickets(), api.syncState()]);
      error = null;
    } catch (err) {
      error = `Daemon nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Two clicks: "Übernehmen" arms the button for a few seconds, the second click takes over. */
  let confirming = $state<string | null>(null);
  let accepting = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  async function accept(t: Ticket) {
    if (confirming !== t.number) {
      confirming = t.number;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = null), 4_000);
      return;
    }
    confirming = null;
    accepting = t.number;
    try {
      await api.acceptTicket(t.number);
      error = null;
      await refresh();
    } catch (err) {
      error = `${t.number} übernehmen: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      accepting = null;
    }
  }

  async function syncNow() {
    sync = await api.sync().catch(() => sync);
  }

  /** Errors of the last sync (BSM, OTMA) caused by a missing or refused stored account. */
  const loginErrors = $derived(
    [sync?.lastError, sync?.otmaError].filter(
      (e): e is string => !!e && /Anmeldung|nicht angemeldet/.test(e),
    ),
  );

  /** Installed version and newer release on GitHub (the daemon checks at most every 6 h). */
  let version = $state<string | null>(null);
  let update = $state<UpdateInfo | null>(null);
  async function checkVersion() {
    try {
      [version, update] = await Promise.all([api.version(), api.update()]);
    } catch {
      // Daemon not reachable: the list shows that already.
    }
  }

  onMount(() => {
    if (pinned) void setAlwaysOnTop(true).catch(() => (pinned = false));
    void refresh();
    void checkVersion();
    const timer = setInterval(refresh, 15_000);
    const versionTimer = setInterval(checkVersion, 60 * 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      clearInterval(versionTimer);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

{#if showSettings}
  <Settings onclose={closeSettings} />
{:else}
<header>
  <h1>
    BSM-Tickets
    {#if version}<span class="version muted" title="Installierte Version">v{version}</span>{/if}
  </h1>
  <div class="sync">
    {#if sync?.lastError}<span class="error" title={sync.lastError}>BSM-Sync fehlgeschlagen</span>{/if}
    {#if sync?.otmaError}<span class="error" title={sync.otmaError}>OTMA-Sync fehlgeschlagen</span>{/if}
    {#if sync?.lastRunAt}<span class="muted"
        >Stand {new Date(sync.lastRunAt).toLocaleTimeString()}</span
      >{/if}
    <!-- Pin, refresh and settings icons as in BRSOrganizer. -->
    <button
      class="icon pin"
      class:active={pinned}
      title={pinned ? 'Immer im Vordergrund: an' : 'Immer im Vordergrund'}
      aria-label="Immer im Vordergrund"
      aria-pressed={pinned}
      onclick={togglePinned}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10.97 1.47a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 0 1-1.06 1.06l-.47-.47-2.6 2.6.53 2.12a.75.75 0 0 1-.2.71l-1 1a.75.75 0 0 1-1.06 0L6.5 9.81l-3.72 3.72a.75.75 0 0 1-1.06-1.06L5.44 8.75 3.28 6.59a.75.75 0 0 1 0-1.06l1-1a.75.75 0 0 1 .71-.2l2.12.53 2.6-2.6-.47-.47a.75.75 0 0 1 0-1.06l1.73-.27z"
        />
      </svg>
    </button>
    <button
      class="icon"
      title="Jetzt aus BSM abrufen"
      aria-label="Jetzt aus BSM abrufen"
      onclick={syncNow}
      disabled={sync?.running}
    >
      <span class:spin={sync?.running}>⟳</span>
    </button>
    <button
      class="icon"
      title="Einstellungen"
      aria-label="Einstellungen"
      onclick={() => (showSettings = true)}>⚙</button
    >
  </div>
</header>

{#if update?.available && update.url}
  <p class="login banner">
    Neue Version {update.latest} verfügbar (installiert: {update.current}).
    <button onclick={() => update?.url && openUrl(update.url)}>Herunterladen</button>
  </p>
{/if}
{#if error}
  <p class="error banner">{error}</p>
{/if}
{#each loginErrors as e (e)}
  <p class="login banner error">
    {e} – ohne Anmeldung wird nichts aktualisiert.
    <button onclick={() => (showSettings = true)}>Einstellungen</button>
  </p>
{/each}

<!-- Three rows, each with its title: category + distributed, BSM status, OTMA status. Every
     bubble switches its value on/off; off ones are faded. -->
<div class="filters">
  <div class="row">
    <span class="row-title" id="filter-kind">Kategorie</span>
    <div class="group" role="group" aria-labelledby="filter-kind">
      {#each KINDS as k (k)}
        <button
          class="filter kind-{k}"
          aria-pressed={!hiddenKinds.includes(k)}
          onclick={() => toggleKind(k)}
        >
          {k} ({kindCount(k)})
        </button>
      {/each}
    </div>
    <button
      class="filter tri tri-{distributed}"
      title="Verteilt = OTMA-Verantwortlicher gesetzt (nicht BRS Support). Klick: alle → nur verteilte → nur nicht verteilte"
      onclick={nextDistributed}
      >{DISTRIBUTED.find(([v]) => v === distributed)![1]} ({distributedCount} verteilt)</button
    >
  </div>
  <div class="row">
    <span class="row-title" id="filter-bsm">BSM-Status</span>
    <div class="group" role="group" aria-labelledby="filter-bsm">
      {#each statusCounts as [status, count] (status)}
        <button
          class="filter status-{status}"
          aria-pressed={!hiddenStatuses.includes(status)}
          onclick={() => toggleStatus(status)}
        >
          {statusLabel(status)} ({count})
        </button>
      {/each}
    </div>
  </div>
  <div class="row">
    <span class="row-title" id="filter-otma">OTMA-Status</span>
    <div class="group" role="group" aria-labelledby="filter-otma">
      {#each otmaCounts as [group, count] (group)}
        <button
          class="filter otma-filter"
          aria-pressed={!hiddenOtma.includes(group)}
          onclick={() => (hiddenOtma = toggled(hiddenOtma, group))}
        >
          {group} ({count})
        </button>
      {/each}
    </div>
  </div>
</div>

<ul>
  {#each shown as t (t.number)}
    {@const who = otmaResponsiblePerson(t.otmaResponsible)}
    <li class:blocker={t.categoryName === 'Blocker'}>
      <div class="head">
        <button
          class="chip number"
          style={chipStyle(t)}
          onclick={() => t.link && openUrl(t.link)}
          disabled={!t.link}
          title={t.link ? 'Im BSM öffnen' : undefined}>{t.number}</button
        >
        {#if t.otmaNumber}
          <button
            class="chip otma"
            title="OTMA-Ticket öffnen"
            onclick={() => openUrl(OTMA_TICKET_BASE + t.otmaNumber)}>OTMA {t.otmaNumber}</button
          >
          {#if t.otmaStatus}
            <span class="chip otma-status" title="OTMA-Status: {t.otmaStatus}"
              >{otmaStatusLabel(t.otmaStatus)}</span
            >
          {/if}
        {/if}
        <span class="chip status-{t.status}">{statusLabel(t.status)}</span>
        {#if t.status === 'new'}
          <button
            class="accept"
            class:armed={confirming === t.number}
            disabled={accepting !== null}
            title="Ticket in BSM übernehmen (dem hinterlegten BSM-Konto zuweisen)"
            onclick={() => accept(t)}
            >{accepting === t.number
              ? 'Wird übernommen…'
              : confirming === t.number
                ? 'Wirklich übernehmen?'
                : 'Übernehmen'}</button
          >
        {/if}
      </div>
      <div class="line">
        <div class="summary">{t.summary ?? '(ohne Titel)'}</div>
        {#if who}
          {@const bg = defaultColor(who)}
          <span
            class="chip responsible"
            style="background: {bg}; color: {textOn(bg)}"
            title="OTMA-Verantwortlich: {t.otmaResponsible}">{who}</span
          >
        {/if}
      </div>
      <div class="muted">
        {[
          t.applicationName,
          t.categoryName,
          t.handler ?? 'nicht zugewiesen',
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div class="line muted">
        Erstellt {formatDate(t.createDate)} · Geändert {formatDate(t.changeDate)}
        <button
          class="details-toggle"
          aria-expanded={openDetails.includes(t.number)}
          aria-controls="details-{t.number}"
          onclick={() => (openDetails = toggled(openDetails, t.number))}
          >Details {openDetails.includes(t.number) ? '▴' : '▾'}</button
        >
      </div>
      {#if openDetails.includes(t.number)}
        <!-- From the project's TFS repository (else the customer's), see the settings. -->
        <div class="details" id="details-{t.number}">
          <div class="detail-row">
            <span class="detail-label">Installation</span>
            <strong>{t.installation ?? '–'}</strong>
          </div>
          {#if t.wikiUrl}
            <div class="detail-row">
              <span class="detail-label">TV</span>
              <strong>{t.technicalLead ?? 'nicht im Wiki (Security Architecture) gefunden'}</strong>
              <button
                class="chip wiki"
                title="Wiki öffnen: {t.wikiUrl}"
                onclick={() => t.wikiUrl && openUrl(t.wikiUrl)}>Wiki</button
              >
            </div>
            <div class="detail-row">
              <span class="detail-label">Releases</span>
              {#each t.releases as r (r.system)}
                <!-- The system of the affected installation is highlighted. -->
                <button
                  class="chip release"
                  class:current={r.system.toLowerCase() === t.installation?.toLowerCase()}
                  disabled={!r.url}
                  title={r.url ? `Build öffnen: ${r.url}` : 'Zuletzt released laut Wiki'}
                  onclick={() => r.url && openUrl(r.url)}
                  >{r.system}: {r.version} · {formatDay(r.date)}</button
                >
              {:else}
                <span class="muted">keine im Wiki (Seite „Releases“)</span>
              {/each}
            </div>
            <div class="detail-row">
              <span
                class="detail-label"
                title="Commits und Pull-Requests auf den Standard-Branch (main/master) der letzten 31 Tage"
                >Aktiv (Monat)</span
              >
              {#each t.contributors as p (p.name)}
                {@const bg = defaultColor(p.account ?? p.name)}
                <span
                  class="chip"
                  style="background: {bg}; color: {textOn(bg)}"
                  title="{p.commits} Commits, {p.pullRequests} Pull-Requests, zuletzt {formatDate(
                    p.lastAt,
                  )}">{p.name}{p.account ? ` (${p.account})` : ''}</span
                >
              {:else}
                <span class="muted">niemand im letzten Monat</span>
              {/each}
            </div>
          {:else}
            <span class="muted">Kein TFS-Repo mit Wiki hinterlegt (Einstellungen → Projekte).</span>
          {/if}
        </div>
      {/if}
    </li>
  {:else}
    <li class="muted">Keine Tickets.</li>
  {/each}
</ul>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  h1 {
    font-size: 16px;
    margin: 0;
  }
  .version {
    font-size: 11px;
    font-weight: normal;
    margin-left: 4px;
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sync .icon {
    font-size: 16px;
  }
  .pin {
    display: inline-flex;
    align-items: center;
    transform: rotate(45deg);
    transition: transform 0.15s;
  }
  .pin.active {
    color: var(--accent);
    transform: none;
  }
  .spin {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .error {
    color: var(--danger);
  }
  .banner.login {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    font-weight: 600;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-bottom: 1px solid var(--border);
  }
  .banner.login.error {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .banner {
    padding: 0 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }
  /* Ticket number left, status on the right. */
  .head > [class*='status-'] {
    margin-left: auto;
  }
  /* Title left (cut off when too long), OTMA responsible chip on the far right. */
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .responsible {
    margin-left: auto;
  }
  .summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The number chip opens the ticket in BSM. */
  .number {
    font-family: ui-monospace, monospace;
    font-weight: 600;
    color: var(--accent);
    border: 1px solid transparent;
  }
  .number:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .otma {
    font-family: ui-monospace, monospace;
    border: 1px solid var(--border);
  }
  .otma:hover {
    border-color: var(--accent);
  }
  /* Belongs to the OTMA chip before it: same outline, no fill. */
  .details-toggle {
    margin-left: auto;
    font-size: 12px;
    padding: 0 6px;
    border: none;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    padding: 6px 8px;
    font-size: 13px;
    border-left: 3px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .detail-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .detail-label {
    width: 80px;
    color: var(--muted);
    font-size: 12px;
  }
  .release {
    border: 1px solid var(--border);
    font-family: ui-monospace, monospace;
  }
  .release:hover:not(:disabled) {
    border-color: var(--accent);
    cursor: pointer;
  }
  .release.current {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 600;
  }
  .wiki {
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .wiki:hover {
    border-color: var(--accent);
  }
  .otma-status {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .number:disabled {
    color: inherit;
    cursor: default;
  }
  .accept {
    font-size: 12px;
    padding: 1px 10px;
    border-radius: 10px;
    border: 1px solid var(--ok);
    color: var(--ok);
    background: transparent;
  }
  .accept.armed {
    background: var(--ok);
    color: var(--bg);
  }
  .chip {
    background: var(--chip);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .status-new {
    background: var(--chip-red-bg);
    color: var(--chip-red-fg);
    font-weight: 600;
  }
  .status-inprocess {
    background: var(--chip-blue-bg);
    color: var(--chip-blue-fg);
  }
  .status-delivered {
    background: var(--chip-teal-bg);
    color: var(--chip-teal-fg);
  }
  .status-completed {
    background: var(--chip-purple-bg);
    color: var(--chip-purple-fg);
  }
  li.blocker {
    border-left: 4px solid var(--danger);
    padding-left: 8px;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
  li.blocker .summary {
    color: var(--danger);
    font-weight: 600;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 24px;
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .filter {
    border-radius: 12px;
    font-size: 12px;
    padding: 2px 10px;
    border: 1px solid transparent;
  }
  /* Fixed width: the bubbles of all rows start in one column. */
  .row-title {
    width: 84px;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .otma-filter {
    background: var(--chip);
  }
  /* Tri-state: "all" neutral, the two restricting states filled (and named in the label). */
  .tri-all {
    background: var(--chip);
    color: var(--muted);
  }
  .tri-yes {
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  .tri-no {
    background: var(--chip-orange-bg);
    color: var(--chip-orange-fg);
    font-weight: 600;
  }
  /* Switched-off filter bubble: faded and struck through, so it does not rely on color alone. */
  .filter[aria-pressed='false'] {
    opacity: 0.35;
    text-decoration: line-through;
  }
  .kind-Bug {
    background: var(--chip-red-bg);
    color: var(--chip-red-fg);
  }
  .kind-CR {
    background: var(--chip-green-bg);
    color: var(--chip-green-fg);
  }
  .kind-Frage {
    background: var(--chip-blue-bg);
    color: var(--chip-blue-fg);
  }
</style>
