// Color palette inspired by CodeBurn (github.com/AgentSeal/codeburn).
// One hex per semantic role so panels stay visually distinct.

export const ORANGE = '#FF8C42';
export const GOLD = '#FFD700';
export const BLUE = '#5B9EF5';
export const GREEN = '#5BF5A0';
export const MAGENTA = '#E05BF5';
export const AMBER = '#F5C85B';
export const CYAN = '#5BF5E0';
export const PINK = '#F55BE0';
export const RED = '#F55B5B';
export const DIM = '#555555';

// Severity-specific colors used in bar charts and badges.
export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#F55B5B',
  HIGH: '#FF8C42',
  MEDIUM: '#F5C85B',
  LOW: '#5B9EF5',
  UNKNOWN: '#888888',
};

export const STATUS_COLORS: Record<string, string> = {
  OPEN: '#F55B5B',
  ACKNOWLEDGED: '#F5C85B',
  RESOLVED: '#5BF5A0',
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Linear interpolate between two hex colors; t in [0, 1]. */
export function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** 3-stop gradient used by HBar: blue → amber → orange as ratio grows. */
export function gradientAt(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  if (t < 0.5) return lerpColor(BLUE, AMBER, t / 0.5);
  return lerpColor(AMBER, ORANGE, (t - 0.5) / 0.5);
}
