import type { Design } from "../shared/types";

const scale = { compact: "0.72", standard: "1", large: "1.14" } as const;

/** Applies a campaign's colors and heading size to the page. */
export function applyDesign(design: Design, target: HTMLElement = document.documentElement): void {
  target.style.setProperty("--purple", design.accent);
  target.style.setProperty("--green", design.action);
  target.style.setProperty("--lime", design.highlight);
  // The second tone is the pilot's violet for the original purple, and a lighter version of any other main color.
  target.style.setProperty("--violet", design.accent === "#510c76" ? "#9e28b5" : `color-mix(in srgb, ${design.accent} 78%, #fff)`);
  target.style.setProperty("--heading-scale", scale[design.headingSize]);
}
