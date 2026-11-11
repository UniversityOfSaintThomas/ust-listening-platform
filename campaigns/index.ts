import type { Campaign } from "../src/shared/types";
import { stelar } from "./stelar";

/**
 * Every feedback campaign is one entry here. To add a unit (ITS, Aquinas AI),
 * copy stelar.ts, edit the text, and register it below. No other code changes.
 */
export const campaigns: Record<string, Campaign> = {
  [stelar.slug]: stelar,
};

export const defaultCampaign = stelar.slug;
