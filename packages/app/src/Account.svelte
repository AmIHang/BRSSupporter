<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Account, type AccountSystem } from './lib/api';

  let {
    system,
    title,
    hint,
    flash,
  }: {
    system: AccountSystem;
    title: string;
    hint: string;
    flash: (text: string, error?: boolean) => void;
  } = $props();

  let account = $state<Account | null>(null);
  let user = $state('');
  /** Only ever typed in here and sent once; never loaded back from the daemon. */
  let password = $state('');
  const fail = (e: unknown) => flash(e instanceof Error ? e.message : String(e), true);

  async function save() {
    try {
      await api.saveAccount(system, user.trim(), password);
      password = '';
      account = await api.account(system);
      flash(`${title} gespeichert`);
    } catch (e) {
      fail(e);
    }
  }

  async function remove() {
    try {
      await api.deleteAccount(system);
      account = await api.account(system);
      user = '';
      flash(`${title} entfernt`);
    } catch (e) {
      fail(e);
    }
  }

  onMount(async () => {
    try {
      account = await api.account(system);
      user = account.user ?? '';
    } catch (e) {
      fail(e);
    }
  });
</script>

{#if account}
  <section>
    <h3>{title}</h3>
    <form
      class="inline"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        placeholder="E-Mail / Benutzername"
        autocomplete="off"
        aria-label="{title}: Benutzername"
        bind:value={user}
        required
      />
      <input
        type="password"
        placeholder={account.passwordSet ? 'Passwort (gespeichert)' : 'Passwort'}
        autocomplete="new-password"
        aria-label="{title}: Passwort"
        bind:value={password}
        required
      />
      <button type="submit">Speichern</button>
      {#if account.user}
        <button type="button" onclick={() => void remove()}>Entfernen</button>
      {/if}
    </form>
    <p class="hint muted">
      {account.user ? `Gespeichert für ${account.user}.` : 'Keine Anmeldung gespeichert.'}
      {hint}
    </p>
  </section>
{/if}

<style>
  section {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h3 {
    font-size: 13px;
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .inline {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .hint {
    font-size: 12px;
    margin: 0;
  }
</style>
