// =================================================================================
// RHYTHM GAME CONFIGURATION
//
// This file centralizes all environment-specific and application-wide settings.
// By deriving the configuration from the window's location, the app can
// seamlessly switch between local development and a live production environment.
// =================================================================================

// Detect if the application is running on localhost.
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// When deploying to Vercel, Vercel provides the exact URL via an environment variable.
// We will use that to construct the production URL. In local dev, we use localhost.
const getBaseUrl = () => {
    if (typeof window !== 'undefined') { // Browser environment
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return `${window.location.protocol}//${window.location.host}`;
        }
    }
    // For Vercel, the VERCEL_URL variable will be available.
    // It needs to be prefixed with https://.
    // We will handle the injection of this variable via vercel.json.
    // As a fallback for other environments, use a placeholder.
    return `https://rhythm-game-2.vercel.app`;
};

const APP_BASE_URL = getBaseUrl();

/**
 * @type {Object}
 * @property {string} CLIENT_ID - The Client ID from your Spotify Developer Dashboard.
 * @property {string} REDIRECT_URI - The URI to redirect to after Spotify authentication. Must be whitelisted.
 * @property {string} APP_URL - The URL of the main application page.
 * @property {string[]} SCOPES - The Spotify API scopes required for the application to function.
 * @property {string | null} N8N_TELEMETRY_URL - Optional webhook URL for sending telemetry data.
 * @property {string | null} N8N_COMPLETED_URL - Optional webhook URL for sending completion data.
 * @property {boolean} DEBUG_MODE - Enables or disables additional logging for development.
 */
const CONFIG = {
  CLIENT_ID: '314f6b8f332041dcb5f678b85acf36ea', // Replace with your app's Client ID
  REDIRECT_URI: `${APP_BASE_URL}/index.html`,
  APP_URL: `${APP_BASE_URL}/app.html`,
  SCOPES: [
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state',
    'streaming', // Required for Web Playback SDK
    'playlist-modify-private',
    'playlist-modify-public',
  ].join(' '),
  N8N_TELEMETRY_URL: null, // Optional: Replace with your N8N telemetry endpoint
  N8N_COMPLETED_URL: null, // Optional: Replace with your N8N completion endpoint
  DEBUG_MODE: isLocal,
};

// Log the configuration in debug mode for easier troubleshooting.
if (CONFIG.DEBUG_MODE) {
  console.log('Application running in debug mode.');
  console.log('Configuration:', CONFIG);
}

export { CONFIG };