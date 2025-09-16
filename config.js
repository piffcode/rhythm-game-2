// Environment-specific configuration for Rhythm Game 2
// Automatically detects localhost (dev) vs. production (Netlify)

const isLocal = window.location.hostname === 'localhost' || window.location.port === '8000';

const CONFIG = {
  CLIENT_ID: "314f6b8f332041dcb5f678b85acf36ea", // TODO: Replace with your app's CLIENT_ID
  REDIRECT_URI: isLocal
    ? "http://localhost:8000/auth.html"
    : "https://rhythm-game-2-rhc88p3ot-rhythm-games-projects.vercel.app/auth.html",
  NEXT_URL: isLocal
    ? "http://localhost:8000/rhythm.html"
    : "https://rhythm-game-2-rhc88p3ot-rhythm-games-projects.vercel.app/rhythm.html",
  N8N_TELEMETRY_URL: "", // TODO: Replace with your N8N telemetry endpoint
  N8N_COMPLETED_URL: "", // TODO: Replace with your N8N completion endpoint
  DEBUG_MODE: isLocal,
  ENCRYPTION_SALT: "rhythm-game-salt-2024" // Fixed salt for token encryption; use user-derived in prod
};

export { CONFIG };