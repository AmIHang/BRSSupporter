import { getCurrentWindow } from '@tauri-apps/api/window';

const KEY = 'brssupporter.always-on-top';

/** Remembered choice (per user, in the webview's local storage). */
export function savedAlwaysOnTop(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Keeps the window above all others (or not) and remembers the choice. */
export async function setAlwaysOnTop(on: boolean): Promise<void> {
  await getCurrentWindow().setAlwaysOnTop(on);
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: the choice just is not remembered
  }
}
