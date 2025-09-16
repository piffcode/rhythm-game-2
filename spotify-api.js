// =================================================================================
// SPOTIFY API MODULE
//
// This module centralizes all communication with the Spotify Web API. It handles
// access token management, request signing, and standardized error handling.
// By abstracting API calls, it keeps the main application logic clean and
// focused on state management rather than HTTP requests.
// =================================================================================

import { CONFIG } from './config.js';

const API_BASE_URL = 'https://api.spotify.com/v1';

/**
 * Retrieves the access token from sessionStorage.
 * If the token is missing or expired, it redirects to the login page.
 * @returns {string} The valid access token.
 */
function getAccessToken() {
    const token = sessionStorage.getItem('access_token');
    const expiresAt = sessionStorage.getItem('expires_at');

    if (!token || !expiresAt || Date.now() > parseInt(expiresAt)) {
        // Token is invalid, clear session and force re-authentication
        sessionStorage.clear();
        window.location.replace('index.html');
        throw new Error('Access token expired or missing. Redirecting to login.');
    }

    return token;
}

/**
 * A wrapper around the native fetch API to handle Spotify API requests.
 * It automatically adds the Authorization header and handles common API errors.
 *
 * @param {string} endpoint - The API endpoint to call (e.g., '/me').
 * @param {object} [options={}] - Standard fetch options (method, headers, body).
 * @returns {Promise<any>} A promise that resolves to the JSON response.
 * @throws {Error} Throws an error for non-successful responses.
 */
async function spotifyFetch(endpoint, options = {}) {
    const token = getAccessToken();
    const url = `${API_BASE_URL}${endpoint}`;

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
        // If the token expires mid-session, a 401 will be returned.
        // getAccessToken() will handle the redirect on the next call.
        const errorData = await response.json().catch(() => ({})); // Catch if body is not JSON
        const errorMessage = errorData.error?.message || `HTTP Error: ${response.status} ${response.statusText}`;
        console.error(`Spotify API Error on ${endpoint}:`, errorMessage, errorData);
        throw new Error(errorMessage);
    }
    
    // For 204 No Content responses, there is no body to parse
    if(response.status === 204) {
        return null;
    }

    return response.json();
}

// --- Exported API Functions ---

/**
 * Fetches the current user's profile information.
 * @returns {Promise<object>} User profile object.
 */
export const getUserProfile = () => spotifyFetch('/me');

/**
 * Fetches the user's available playback devices.
 * @returns {Promise<object>} A list of available devices.
 */
export const getAvailableDevices = () => spotifyFetch('/me/player/devices');

/**
 * Transfers playback to a specified device.
 * @param {string} deviceId - The ID of the device to transfer playback to.
 */
export const transferPlayback = (deviceId) => spotifyFetch('/me/player', {
    method: 'PUT',
    body: JSON.stringify({
        device_ids: [deviceId],
        play: false, // Start paused
    }),
});

/**
 * Creates a new, private playlist for the user.
 * @param {string} userId - The user's Spotify ID.
 * @param {string} name - The name for the new playlist.
 * @returns {Promise<object>} The newly created playlist object.
 */
export const createPlaylist = (userId, name) => spotifyFetch(`/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({
        name: name,
        description: 'Temporary playlist for Rhythm Game session.',
        public: false,
    }),
});

/**
 * Adds tracks to a specified playlist.
 * @param {string} playlistId - The ID of the playlist.
 * @param {string[]} trackUris - An array of Spotify track URIs to add.
 * @returns {Promise<object>} The response from the API.
 */
export const addTracksToPlaylist = (playlistId, trackUris) => spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({
        uris: trackUris,
    }),
});

/**
 * Starts or resumes playback on the user's active device.
 * @param {string} playlistUri - The URI of the playlist to play.
 */
export const play = (playlistUri) => spotifyFetch('/me/player/play', {
    method: 'PUT',
    body: JSON.stringify({
        context_uri: playlistUri,
    }),
});

/**
 * Gets a selection of "new releases" from Spotify.
 * @returns {Promise<object>} A list of new album releases.
 */
export const getNewReleases = () => spotifyFetch('/browse/new-releases?limit=50');

/**
 * Gets a selection of "featured playlists" from Spotify.
 * @returns {Promise<object>} A list of featured playlists.
 */
export const getFeaturedPlaylists = () => spotifyFetch('/browse/featured-playlists?limit=50');

/**
 * Gets the tracks from a specific playlist.
 * @param {string} playlistId - The ID of the playlist.
 * @returns {Promise<object>} A list of tracks from the playlist.
 */
export const getPlaylistTracks = (playlistId) => spotifyFetch(`/playlists/${playlistId}/tracks?limit=50`);

/**
 * Fetches audio features for multiple tracks.
 * @param {string[]} trackIds - An array of Spotify track IDs.
 * @returns {Promise<object>} Audio features for the requested tracks.
 */
export const getAudioFeaturesForTracks = (trackIds) => spotifyFetch(`/audio-features?ids=${trackIds.join(',')}`);

/**
 * Sends a POST request to a webhook URL with the provided data.
 * @param {string} url - The webhook URL.
 * @param {object} data - The JSON payload to send.
 */
export const sendWebhook = (url, data) => {
    if (!url) return; // Don't send if URL is not configured
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).catch(error => console.error('Webhook failed to send:', error));
};