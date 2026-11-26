/**
 * Customer colors. Without a chosen color each customer gets one computed from its name, so
 * customers look different from the start and keep their color across restarts.
 */

/** FNV-1a: small, stable string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Computed color of a customer: hue from the name, saturation/lightness fixed for chips. */
export function defaultColor(customer: string): string {
  const h = hash(customer);
  // Lightness varies a little too, so neighbouring hues stay apart.
  return hslToHex(h % 360, 60, 38 + ((h >>> 9) % 3) * 6);
}

/** The color to show: chosen one, else computed; null without customer. */
export function customerColor(c: { customer: string | null; customerColor: string | null }) {
  return c.customerColor ?? (c.customer ? defaultColor(c.customer) : null);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Black or white text, whichever contrasts more with `bg` ("#rrggbb"). */
export function textOn(bg: string): string {
  const l = luminance(bg);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#1f2328';
}
