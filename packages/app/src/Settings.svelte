<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, type Project, type Settings } from './lib/api';
  import Account from './Account.svelte';
  import { applyTheme, savedTheme, type Theme } from './lib/theme';
  import { customerColor, textOn } from './lib/colors';

  let { onclose }: { onclose: () => void } = $props();

  let settings = $state<Settings | null>(null);
  let projects = $state<Project[]>([]);
  let search = $state('');
  let message = $state<{ text: string; error: boolean } | null>(null);

  // Same flash message as in BRSOrganizer's settings.
  function flash(text: string, error = false) {
    message = { text, error };
    setTimeout(() => (message = null), 4000);
  }
  const fail = (e: unknown) => flash(e instanceof Error ? e.message : String(e), true);

  interface CustomerGroup {
    /** '' = application without known customer. */
    customer: string;
    /** Pseudo customer "Ohne Projekt": one entry per application (project name ''). */
    pseudo: boolean;
    /** All projects of the customer: the customer checkbox acts on these. */
    all: Project[];
    /** The ones matching the search. */
    shown: Project[];
  }

  const NO_PROJECT_LABEL = 'Ohne Projekt';

  const groups = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const byCustomer = new Map<string, CustomerGroup>();
    const pseudo: CustomerGroup = { customer: NO_PROJECT_LABEL, pseudo: true, all: [], shown: [] };
    for (const p of projects) {
      let g = pseudo;
      if (p.name !== '') {
        const customer = p.customer ?? '';
        g = byCustomer.get(customer) ?? { customer, pseudo: false, all: [], shown: [] };
        byCustomer.set(customer, g);
      }
      g.all.push(p);
      const text = `${g.customer} ${p.applicationName} ${p.name}`.toLowerCase();
      if (!q || text.includes(q)) g.shown.push(p);
    }
    return [...byCustomer.values(), pseudo].filter((g) => g.shown.length);
  });

  /** Tri-state: hide all of the customer's projects unless all already are, then show all. */
  async function toggleCustomer(g: CustomerGroup) {
    const hidden = !g.all.every((p) => p.hidden);
    try {
      if (g.pseudo) await Promise.all(g.all.map((p) => api.setProjectHidden(p, hidden)));
      else await api.setCustomerHidden(g.customer, hidden);
      for (const p of g.all) p.hidden = hidden;
    } catch (e) {
      fail(e);
    }
  }
  const hiddenCount = $derived(projects.filter((p) => p.hidden).length);

  /** null = back to the computed color. */
  async function saveColor(g: CustomerGroup, color: string | null) {
    try {
      await api.setCustomerColor(g.customer, color);
      for (const p of g.all) p.customerColor = color;
    } catch (e) {
      fail(e);
    }
  }

  /** Input value → link; empty removes it. The daemon checks it with TFS and completes it. */
  const repoValue = (v: string) => v.trim() || null;

  async function saveCustomerRepo(g: CustomerGroup, value: string) {
    const url = repoValue(value);
    try {
      const repo = await api.setCustomerRepoUrl(g.customer, url);
      for (const p of g.all) {
        p.customerRepoUrl = repo?.repoUrl ?? null;
        p.customerWikiUrl = repo?.wikiUrl ?? null;
        p.customerTechnicalLead = repo?.technicalLead ?? null;
        if (!p.repoUrl) {
          p.effectiveRepoUrl = p.customerRepoUrl;
          p.effectiveWikiUrl = p.customerWikiUrl;
          p.effectiveTechnicalLead = p.customerTechnicalLead;
        }
      }
      flash(repo ? 'Repo-Link geprüft und gespeichert' : 'Repo-Link entfernt');
    } catch (e) {
      fail(e);
    }
  }

  async function saveProjectRepo(p: Project, value: string) {
    const url = repoValue(value);
    try {
      const repo = await api.setProjectRepoUrl(p, url);
      p.repoUrl = repo?.repoUrl ?? null;
      p.wikiUrl = repo?.wikiUrl ?? null;
      p.technicalLead = repo?.technicalLead ?? null;
      p.effectiveRepoUrl = repo ? repo.repoUrl : p.customerRepoUrl;
      p.effectiveWikiUrl = repo ? repo.wikiUrl : p.customerWikiUrl;
      p.effectiveTechnicalLead = repo ? repo.technicalLead : p.customerTechnicalLead;
      flash(repo ? 'Repo-Link geprüft und gespeichert' : 'Repo-Link entfernt – der des Kunden gilt');
    } catch (e) {
      fail(e);
    }
  }

  async function reloadAll() {
    try {
      await api.sync(true);
      flash('Kompletter Abruf gestartet');
    } catch (e) {
      fail(e);
    }
  }

  async function save(patch: Parameters<typeof api.updateSettings>[0]) {
    try {
      settings = await api.updateSettings(patch);
      flash('Gespeichert');
    } catch (e) {
      fail(e);
    }
  }

  async function toggle(p: Project, hidden: boolean) {
    try {
      await api.setProjectHidden(p, hidden);
      p.hidden = hidden;
    } catch (e) {
      fail(e);
    }
  }

  onMount(async () => {
    try {
      [settings, projects] = await Promise.all([api.settings(), api.projects()]);
    } catch (e) {
      fail(e);
    }
  });
</script>

<!-- The wiki found for the repository that applies; inherited = the customer's (shown fainter). -->
{#snippet wiki(url: string | null, inherited: boolean, tv: string | null)}
  {#if url}
    <button
      type="button"
      class="wiki"
      class:inherited
      title={`Wiki öffnen: ${url}`}
      onclick={() => void openUrl(url)}>Wiki</button
    >
    <span class="wiki" class:inherited title="TV laut Wiki-Seite Security Architecture"
      >TV: {tv ?? '–'}</span
    >
  {:else}
    <span class="wiki none" title="Das TFS-Projekt hat kein Wiki">kein Wiki</span>
  {/if}
{/snippet}

<div class="settings">
  <header>
    <button class="icon" onclick={onclose} aria-label="Zurück">←</button>
    <h2>Einstellungen</h2>
  </header>

  {#if message}
    <p class:error={message.error} class="flash">{message.text}</p>
  {/if}

  <section>
    <h3>Darstellung</h3>
    <label class="inline">
      Design
      <select value={savedTheme()} onchange={(e) => applyTheme(e.currentTarget.value as Theme)}>
        <option value="system">System</option>
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
      </select>
    </label>
  </section>

  <Account
    system="bsm"
    title="BSM-Anmeldung"
    {flash}
    hint="Nur mit diesem Konto ruft BRSSupporter BSM ab (im Hintergrund, ohne Fenster). Wird es abgelehnt, wird es erst nach dem nächsten Speichern wieder versucht. Liegt nur im Windows-Anmeldeinformationsspeicher."
  />
  <Account
    system="otma"
    title="OTMA-Anmeldung"
    {flash}
    hint="Nur mit diesem Konto greift BRSSupporter auf OTMA zu. Muss eine andere E-Mail-Adresse haben als das BSM-Konto. Liegt nur im Windows-Anmeldeinformationsspeicher."
  />

  {#if settings}
    <section>
      <h3>Abruf</h3>
      <label class="inline">
        BSM abfragen alle
        <input
          type="number"
          min="1"
          max="1440"
          value={settings.syncIntervalMinutes}
          onchange={(e) => {
            const v = e.currentTarget.valueAsNumber;
            if (Number.isInteger(v) && v >= 1 && v <= 1440) void save({ syncIntervalMinutes: v });
            else flash('Bitte 1 bis 1440 Minuten angeben', true);
          }}
        />
        Minuten
      </label>
      <p class="hint muted">
        So oft holt BRSSupporter die Änderungen seit dem letzten Abruf (mit 5 Minuten Puffer) aus
        BSM. Gleich danach werden OTMA-Verantwortlicher und -Status aller Tickets „In Bearbeitung“
        und aller Tickets mit geändertem BSM-Status aus OTMA geholt (OTMA-Konto). Über ⟳ in der
        Liste geht es jederzeit sofort.
      </p>
      <div class="inline">
        <button type="button" onclick={() => void reloadAll()}>Alles neu laden</button>
      </div>
      <p class="hint muted">
        Holt einmal alle Tickets zum Filter neu, statt nur die Änderungen. Räumt auch Tickets
        weg, die sonst nicht als erledigt erkannt würden (z. B. gelöschte).
      </p>
    </section>

  {/if}

  <section>
    <h3>Projekte <span class="muted">({hiddenCount} von {projects.length} ausgeblendet)</span></h3>
    {#if projects.length}
      <input
        type="text"
        placeholder="Kunde oder Projekt suchen…"
        bind:value={search}
        aria-label="Kunde oder Projekt suchen"
      />
      {#each groups as g (g.pseudo ? 'pseudo' : `customer:${g.customer}`)}
        {@const hiddenAll = g.all.every((p) => p.hidden)}
        {@const hiddenSome = !hiddenAll && g.all.some((p) => p.hidden)}
        <div class="customer">
          {#if g.customer}
            <label class="check">
              <input
                type="checkbox"
                checked={hiddenAll}
                {@attach (el: HTMLInputElement) => {
                  el.indeterminate = hiddenSome;
                }}
                onchange={() => void toggleCustomer(g)}
              />
              <span class="customer-name" class:pseudo={g.pseudo}>{g.customer}</span>
            </label>
            {#if !g.pseudo}
            {@const chosen = g.all[0]?.customerColor ?? null}
            {@const color = customerColor({ customer: g.customer, customerColor: chosen })!}
            <div class="color">
              <!-- Preview: how the ticket number chip of this customer looks. -->
              <span class="chip-preview" style="background: {color}; color: {textOn(color)}"
                >Ticket-Nr.</span
              >
              <input
                type="color"
                value={color}
                title="Farbe für {g.customer}"
                aria-label="Farbe für {g.customer}"
                onchange={(e) => void saveColor(g, e.currentTarget.value)}
              />
              {#if chosen}
                <button
                  type="button"
                  class="icon reset"
                  title="Zurück zur berechneten Farbe"
                  aria-label="Farbe von {g.customer} zurücksetzen"
                  onclick={() => void saveColor(g, null)}>↺</button
                >
              {/if}
            </div>
            <div class="customer-links">
            <input
              type="url"
              class="repo customer-repo"
              placeholder="TFS-Git-Link des Kunden, z. B. …/tfs/boom/_git/Northrail"
              aria-label="TFS-Git-Link für {g.customer}"
              value={g.all[0]?.customerRepoUrl ?? ''}
              onchange={(e) => void saveCustomerRepo(g, e.currentTarget.value)}
            />
            {#if g.all[0]?.customerRepoUrl}
              {@render wiki(g.all[0].customerWikiUrl, false, g.all[0].customerTechnicalLead)}
            {/if}
            </div>
            {/if}
          {:else}
            <span class="customer-name">(ohne Kunde)</span>
          {/if}
          <div class="projects">
            {#each g.shown as p (`${p.applicationName}/${p.name}`)}
              <div class="project">
                <label class="check">
                  <input
                    type="checkbox"
                    checked={p.hidden}
                    onchange={(e) => void toggle(p, e.currentTarget.checked)}
                  />
                  {#if p.name === ''}
                    {p.applicationName || '(ohne Applikation)'}
                  {:else}
                    {p.name}
                    {#if p.applicationName !== p.name}<span class="muted">{p.applicationName}</span>{/if}
                  {/if}
                </label>
                <!-- Empty: the customer's link applies, shown as placeholder. -->
                <input
                  type="url"
                  class="repo"
                  placeholder={p.customerRepoUrl
                    ? `vom Kunden: ${p.customerRepoUrl}`
                    : 'TFS-Git-Link (leer: der des Kunden)'}
                  aria-label="TFS-Git-Link für {p.name || p.applicationName}"
                  value={p.repoUrl ?? ''}
                  onchange={(e) => void saveProjectRepo(p, e.currentTarget.value)}
                />
                {#if p.effectiveRepoUrl}
                  {@render wiki(p.effectiveWikiUrl, !p.repoUrl, p.effectiveTechnicalLead)}
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <p class="hint muted">Kein Projekt passt zur Suche.</p>
      {/each}
    {:else}
      <p class="hint muted">Noch keine Projekte. Sie werden beim nächsten Abruf gespeichert.</p>
    {/if}
    <p class="hint muted">
      Angehakte Projekte werden ausgeblendet: Ihre Tickets erscheinen nicht in der Liste. Der Haken
      beim Kunden blendet alle seine Projekte aus oder ein. Tickets ohne Projekt stehen pro
      Applikation unter „Ohne Projekt“. Die Farbe des Kunden bekommt der
      Ticketnummern-Chip; ohne eigene Wahl wird sie aus dem Namen berechnet (↺ setzt zurück). Neue Projekte kommen beim Abrufen
      automatisch dazu – bei einem ganz ausgeblendeten Kunden gleich ausgeblendet.
    </p>
    <p class="hint muted">
      Repo-Link: Git-Link des Kunden bzw. Projekts im TFS (z. B. …/tfs/boom/_git/Northrail, Kurzform
      erlaubt). Beim Speichern prüft BRSSupporter ihn mit deiner Windows-Anmeldung, ergänzt das Projekt
      und sucht das Wiki des TFS-Projekts. TFVC-Links (_versionControl) werden abgelehnt. Hat ein Projekt
      keinen eigenen Link, gelten Repo und Wiki des Kunden (grau). Feld leeren entfernt den Link.
    </p>
  </section>
</div>

<!-- Styles from BRSOrganizer's settings, so both apps look alike. -->
<style>
  .settings {
    padding-bottom: 24px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    font-size: 16px;
    margin: 0;
  }
  h3 {
    font-size: 13px;
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  h3 .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: normal;
  }
  .customer {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
  }
  .customer-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  /* Pseudo customer: not a real BSM customer. */
  .customer-name.pseudo {
    color: var(--muted);
    font-style: italic;
  }
  .color {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 22px;
  }
  .chip-preview {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 600;
    border-radius: 10px;
    padding: 1px 8px;
  }
  input[type='color'] {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }
  .reset {
    font-size: 14px;
  }
  /* Projects indented under their customer, like a tree. */
  .projects {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 22px;
  }
  .projects .muted {
    font-size: 12px;
  }
  /* Project left, its repository link to the right. */
  .project {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .project .check {
    flex: 1;
    min-width: 0;
  }
  .repo {
    width: 320px;
    max-width: 50%;
    font-size: 12px;
  }
  .customer-repo {
    margin-left: 22px;
  }
  .wiki {
    font-size: 12px;
    padding: 0 6px;
    white-space: nowrap;
  }
  .wiki.inherited,
  .wiki.none {
    color: var(--muted);
  }
  /* The customer's link and wiki on one line under its name. */
  .customer-links {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  section {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .inline {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  input[type='number'] {
    width: 70px;
  }
  .hint {
    font-size: 12px;
    margin: 0;
  }
  .flash {
    margin: 8px 12px;
  }
</style>
