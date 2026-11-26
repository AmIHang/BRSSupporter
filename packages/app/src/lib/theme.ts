import { getCurrentWindow } from '@tauri-apps/api/window';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'brssupporter.theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function resolve(t: Theme): 'light' | 'dark' {
  return t === 'system' ? (systemDark.matches ? 'dark' : 'light') : t;
}

/** Sets the colors (app.css: `data-theme`) and the window's title bar, and remembers the choice. */
export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = resolve(t);
  // null: the title bar follows Windows again. Not available outside Tauri (browser preview).
  void getCurrentWindow()
    .setTheme(t === 'system' ? null : t)
    .catch(() => undefined);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Not remembered; the choice still applies until the app restarts.
  }
}

// "System" follows a change of the Windows setting while the app runs.
systemDark.addEventListener('change', () => {
  if (savedTheme() === 'system') document.documentElement.dataset.theme = resolve('system');
});
