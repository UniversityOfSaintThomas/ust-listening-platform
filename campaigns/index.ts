import type { Campaign } from "../src/shared/types";
import { stelar } from "./stelar";

/**
 * Starter campaigns. Each is copied into the database once, the first time the site
 * runs after it is added here. After that, campaigns are created and edited on the
 * admin page, and the database is the source of truth.
 */
export const seedCampaigns: Campaign[] = [stelar];

/** The campaign shown at the site's main address when it exists. */
export const defaultCampaign = stelar.slug;
