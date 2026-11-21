// Sequenzy in-app content for the signed-in user. The key accepts calls only
// from the app IDs on its list, so the desktop sends its bundle ID.
export const SEQUENZY_API_URL = "https://api.sequenzy.com";
export const SEQUENZY_APP_ID = "ai.amical.desktop";

// The placement slot that fills the widget notification card.
export const WIDGET_FEED_PLACEMENT = "desktop_widget";

/**
 * The workspace's public key and id, from SEQUENZY_PUBLIC_KEY and
 * SEQUENZY_COMPANY_ID (baked in at build time). Null when the build has none:
 * the widget feed is then off.
 */
export function getSequenzyConfig(): {
  publicKey: string;
  companyId: string;
} | null {
  const publicKey =
    process.env.SEQUENZY_PUBLIC_KEY || __BUNDLED_SEQUENZY_PUBLIC_KEY;
  const companyId =
    process.env.SEQUENZY_COMPANY_ID || __BUNDLED_SEQUENZY_COMPANY_ID;
  return publicKey && companyId ? { publicKey, companyId } : null;
}
