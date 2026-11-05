// Socials switches. Everything defaults to off, so Kess Cloud cannot post or run the daily jobs
// while the Vercel app (kess-socials) is still live. See README, "Switching socials over from Vercel".

/** Real sends to Publer happen only with SOCIALS_SEND=1. Anything else is a dry run. */
export const sendingOn = () => process.env.SOCIALS_SEND === '1';
/** The nightly sync, the daily suggest and the recaption run only with SOCIALS_JOBS=1. */
export const jobsOn = () => process.env.SOCIALS_JOBS === '1';
/** The caption writer. Override with SOCIALS_CAPTION_MODEL. */
export const captionModel = () => (process.env.SOCIALS_CAPTION_MODEL || '').trim() || 'claude-sonnet-5-5';
export const captionsConfigured = () => !!process.env.ANTHROPIC_API_KEY?.trim();
export const publerConfigured = () => !!(process.env.PUBLER_API_KEY?.trim() && process.env.PUBLER_WORKSPACE_ID?.trim());
export const shopifyConfigured = () => !!(process.env.SHOPIFY_STORE && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);

/** Which switches are on, for the UI and logs. Never includes a secret. */
export function socialsStatus() {
  return { sending: sendingOn(), jobs: jobsOn(), captions: captionsConfigured(), publer: publerConfigured(), shopify: shopifyConfigured(), model: captionModel() };
}
