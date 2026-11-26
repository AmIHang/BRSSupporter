import { Entry } from '@napi-rs/keyring';
import { APP_NAME } from './settings.js';

/** Systems with an own stored account, typed into the login form when signed out. */
export const ACCOUNT_SYSTEMS = ['bsm', 'otma'] as const;
export type AccountSystem = (typeof ACCOUNT_SYSTEMS)[number];
export type SecretKey = `${AccountSystem}-${'user' | 'password'}`;

/** The stored account of `system`; null unless user and password are both set. */
export function storedAccount(
  secrets: SecretStore,
  system: AccountSystem,
): { user: string; password: string } | null {
  const user = secrets.get(`${system}-user`);
  const password = secrets.get(`${system}-password`);
  return user && password ? { user, password } : null;
}

/** Storage for secrets. Production: Windows Credential Manager. Never the DB, files or logs. */
export interface SecretStore {
  get(key: SecretKey): string | null;
  set(key: SecretKey, value: string): void;
  delete(key: SecretKey): void;
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<SecretKey, string>();
  get = (key: SecretKey) => this.values.get(key) ?? null;
  set = (key: SecretKey, value: string) => void this.values.set(key, value);
  delete = (key: SecretKey) => void this.values.delete(key);
}

/**
 * Windows Credential Manager ("Anmeldeinformationsverwaltung"), service `BRSSupporter` –
 * `BRSSUPPORTER_KEYRING_SERVICE` overrides it, e.g. for a dev profile.
 */
export class KeyringSecretStore implements SecretStore {
  constructor(private readonly service = process.env.BRSSUPPORTER_KEYRING_SERVICE ?? APP_NAME) {}

  get(key: SecretKey): string | null {
    try {
      return new Entry(this.service, key).getPassword() ?? null;
    } catch {
      // Missing entries throw on some platforms: "not set".
      return null;
    }
  }

  set(key: SecretKey, value: string): void {
    new Entry(this.service, key).setPassword(value);
  }

  delete(key: SecretKey): void {
    try {
      new Entry(this.service, key).deleteCredential();
    } catch {
      // Already gone.
    }
  }
}
