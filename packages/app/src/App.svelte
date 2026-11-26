<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, type SyncState, type Ticket } from './lib/api';
  import { customerColor, textOn } from './lib/colors';
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

  const shown = $derived(
    tickets.filter((t) => !hiddenStatuses.includes(t.status) && !hiddenKinds.includes(kindOf(t))),
  );

  async function refresh() {
    try {
      [tickets, sync] = await Promise.all([api.tickets(), api.syncState()]);
      error = null;
    } catch (err) {
      error = `Daemon nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function syncNow() {
    sync = await api.sync().catch(() => sync);
  }

  /** The last sync failed for want of a (working) stored account. */
  const loginFailed = $derived(/Anmeldung|nicht angemeldet/.test(sync?.lastError ?? ''));

  onMount(() => {
    if (pinned) void setAlwaysOnTop(true).catch(() => (pinned = false));
    void refresh();
    const timer = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

{#if showSettings}
  <Settings onclose={closeSettings} />
{:else}
<header>
  <h1>BSM-Tickets</h1>
  <div class="sync">
    {#if sync?.lastError}<span class="error" title={sync.lastError}>Sync fehlgeschlagen</span>{/if}
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

{#if error}
  <p class="error banner">{error}</p>
{/if}
{#if loginFailed}
  <p class="login banner error">
    {sync?.lastError} – ohne Anmeldung wird nichts aktualisiert.
    <button onclick={() => (showSettings = true)}>Einstellungen</button>
  </p>
{/if}

<!-- Every bubble switches its value on/off; off ones are faded. -->
<div class="filters">
  <div class="group" role="group" aria-label="Nach Kategorie filtern">
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
  <div class="group" role="group" aria-label="Nach Status filtern">
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

<ul>
  {#each shown as t (t.number)}
    <li class:blocker={t.categoryName === 'Blocker'}>
      <div class="head">
        <button
          class="chip number"
          style={chipStyle(t)}
          onclick={() => t.link && openUrl(t.link)}
          disabled={!t.link}
          title={t.link ? 'Im BSM öffnen' : undefined}>{t.number}</button
        >
        <span class="chip status-{t.status}">{statusLabel(t.status)}</span>
      </div>
      <div class="summary">{t.summary ?? '(ohne Titel)'}</div>
      <div class="muted">
        {[t.applicationName, t.categoryName, t.handler ?? 'nicht zugewiesen']
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div class="muted">
        Erstellt {formatDate(t.createDate)} · Geändert {formatDate(t.changeDate)}
      </div>
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
  .summary {
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
  .number:disabled {
    color: inherit;
    cursor: default;
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
  /* Categories and statuses in one row; the wider gap separates the two groups. */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
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
