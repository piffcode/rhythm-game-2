// =================================================================================
// AUTHENTICATION MODULE
//
// Handles the entire Spotify PKCE (Proof Key for Code Exchange) authentication
// flow. This includes:
// 1. Redirecting the user to Spotify to grant permissions.
// 2. Handling the callback from Spotify after the user approves.
// 3. Exchanging the authorization code for an access token.
// 4. Storing the token securely and redirecting to the main application.
// =================================================================================

import { CONFIG } from './config.js';

// --- DOM Elements ---
const loginButton = document.getElementById('spotify-login');
const errorContainer = document.getElementById('error-container');
const authSection = document.getElementById('auth-section');
const loadingSection = document.getElementById('loading-section');

// --- PKCE Helper Functions ---

/**
 * Generates a cryptographically random string for the PKCE code verifier.
 * @returns {string} A 128-character URL-safe string.
 */
function generateCodeVerifier() {
    const randomBytes = new Uint8Array(96); // 96 bytes = 128 base64 characters
    window.crypto.getRandomValues(randomBytes);
    return base64urlencode(randomBytes);
}

/**
 * Hashes the code verifier using SHA-256 to create the code challenge.
 * @param {string} verifier - The PKCE code verifier.
 * @returns {Promise<string>} The base64-URL-encoded SHA-256 hash of the verifier.
 */
async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return base64urlencode(new Uint8Array(digest));
}

/**
 * Encodes an ArrayBuffer into a URL-safe base64 string.
 * @param {ArrayBuffer} buffer - The buffer to encode.
 * @returns {string} The URL-safe base64-encoded string.
 */
function base64urlencode(buffer) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

// --- UI Helper Functions ---

/**
 * Displays an error message in the UI.
 * @param {string} message - The error message to show.
 */
function showError(message) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
}

/**
 * Shows or hides the loading spinner and auth button.
 * @param {boolean} isLoading - If true, shows loading; otherwise, shows auth button.
 */
function showLoading(isLoading) {
    authSection.style.display = isLoading ? 'none' : 'block';
    loadingSection.style.display = isLoading ? 'block' : 'none';
}

// --- Authentication Flow ---

/**
 * Initiates the authentication process by redirecting the user to Spotify.
 * This function generates and stores the code verifier, creates the code
 * challenge, and constructs the authorization URL.
 */
async function redirectToSpotify() {
    // Prevent multiple clicks while processing
    loginButton.disabled = true;
    showLoading(true);

    // 1. Generate and store the code verifier
    const codeVerifier = generateCodeVerifier();
    sessionStorage.setItem('code_verifier', codeVerifier);

    // 2. Create the code challenge
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    
    // 3. Construct the authorization URL
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    const state = generateCodeVerifier(); // Use a random string for CSRF protection
    sessionStorage.setItem('oauth_state', state);

    authUrl.search = new URLSearchParams({
        client_id: CONFIG.CLIENT_ID,
        response_type: 'code',
        redirect_uri: CONFIG.REDIRECT_URI,
        scope: CONFIG.SCOPES,
        state: state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    }).toString();
    
    // 4. Redirect the user
    window.location.href = authUrl.toString();
}

/**
 * Handles the callback from Spotify after the user has authenticated.
 * It validates the state, exchanges the authorization code for an access token,
 * stores the token, and redirects to the main application.
 */
async function handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    // If there's no 'code', it's not a callback.
    if (!code) {
        if (error) {
            showError('Authentication failed: ' + error);
        }
        return; // Exit if not in a callback flow
    }

    showLoading(true);

    // 1. Verify the 'state' parameter to prevent CSRF attacks.
    const storedState = sessionStorage.getItem('oauth_state');
    if (!state || state !== storedState) {
        showError('State mismatch. The authentication request could not be verified. Please try again.');
        showLoading(false);
        return;
    }
    sessionStorage.removeItem('oauth_state');

    // 2. Retrieve the code verifier.
    const codeVerifier = sessionStorage.getItem('code_verifier');
    if (!codeVerifier) {
        showError('Authentication session expired. Please try signing in again.');
        showLoading(false);
        return;
    }

    try {
        // 3. Exchange the authorization code for an access token.
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: CONFIG.REDIRECT_URI,
                client_id: CONFIG.CLIENT_ID,
                code_verifier: codeVerifier,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error_description || 'Failed to get token');
        }

        const { access_token, expires_in } = await response.json();
        
        // 4. Store the token and its expiration time.
        // The token is stored in sessionStorage, so it will be cleared when the
        // user closes the browser tab. This is a secure practice for SPAs.
        const expiresAt = Date.now() + expires_in * 1000;
        sessionStorage.setItem('access_token', access_token);
        sessionStorage.setItem('expires_at', expiresAt);
        
        // 5. Clean up and redirect to the main application page.
        sessionStorage.removeItem('code_verifier');
        window.location.replace(CONFIG.APP_URL);

    } catch (err) {
        console.error('Token exchange error:', err);
        showError(`Error during authentication: ${err.message}. Please try again.`);
        showLoading(false);
    }
}

/**
 * Main initialization function for the authentication page.
 */
function initialize() {
    // Check if the page is loading as a result of the auth callback.
    if (new URLSearchParams(window.location.search).has('code')) {
        handleAuthCallback();
    } else {
        // Otherwise, set up the login button.
        loginButton.addEventListener('click', redirectToSpotify);
        // Ensure the auth section is visible by default
        showLoading(false); 
    }
}

// --- Entry Point ---
// Run the initialization logic once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', initialize);