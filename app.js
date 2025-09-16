// =================================================================================
// MAIN APPLICATION MODULE (APP.JS)
//
// This is the heart of the Rhythm Game. It controls the application flow after a
// user has authenticated. Its responsibilities include:
// - Managing UI state (showing/hiding views).
// - Initializing the Spotify Web Playback SDK.
// - Handling device discovery and selection.
// - Generating and managing the game session (tracks, timers).
// - Monitoring playback progress.
// - Handling session completion and displaying the final code.
// =================================================================================

import { CONFIG } from './config.js';
import * as SpotifyAPI from './spotify-api.js';

// --- Application State ---
const state = {
    user: null,
    player: null,
    deviceId: null,
    playerReady: false,
    session: {
        totalDuration: 0, // in seconds
        trackCompletionGoal: 0, // percentage
        tracks: [],
        playlistId: null,
        startTime: 0,
        timerInterval: null,
        progressInterval: null,
    },
};

// --- DOM Elements ---
const views = {
    loading: document.getElementById('loading-view'),
    device: document.getElementById('device-view'),
    session: document.getElementById('session-view'),
    completion: document.getElementById('completion-view'),
    error: document.getElementById('error-view'),
};
const deviceFeedback = document.getElementById('device-feedback');
const checkDevicesBtn = document.getElementById('check-devices-btn');
const sessionTimerEl = document.getElementById('session-timer');
const sessionProgressEl = document.getElementById('session-progress');
const trackListEl = document.getElementById('track-list');
const finishNowBtn = document.getElementById('finish-now-btn');
const completionCodeEl = document.getElementById('completion-code');
const errorMessageEl = document.getElementById('error-message');

// --- UI Management ---

/**
 * Switches the visible view in the single-page application.
 * @param {string} viewName - The name of the view to show (e.g., 'loading', 'device').
 */
function showView(viewName) {
    Object.values(views).forEach(view => view.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
    }
}

/**
 * Displays a critical error and stops the application.
 * @param {string} message - The error message to display.
 */
function showError(message) {
    errorMessageEl.textContent = message;
    showView('error');
    // Stop any running timers
    if (state.session.timerInterval) clearInterval(state.session.timerInterval);
    if (state.session.progressInterval) clearInterval(state.session.progressInterval);
}

// --- Web Playback SDK Initialization ---

/**
 * Initializes the Spotify Web Playback SDK.
 * This function is called after the SDK script has loaded.
 */
window.onSpotifyWebPlaybackSDKReady = () => {
    // Immediately check for a valid token before proceeding.
    try {
        const token = SpotifyAPI.getAccessToken(); // This will throw and redirect if token is invalid
        
        const player = new Spotify.Player({
            name: 'Rhythm Game Web Player',
            getOAuthToken: cb => { cb(token); },
            volume: 0.5,
        });

        state.player = player;

        // --- Player Event Listeners ---
        player.addListener('ready', ({ device_id }) => {
            console.log('Web Playback SDK ready with device ID:', device_id);
            state.deviceId = device_id;
            state.playerReady = true;
            deviceFeedback.textContent = 'Web player connected! Starting session...';
            // Once the player is ready, we can proceed with the game setup.
            startSession();
        });

        player.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline:', device_id);
            state.playerReady = false;
        });

        player.addListener('initialization_error', ({ message }) => {
            console.error('Failed to initialize player:', message);
            showError(`Spotify Player Error: ${message}. This may be due to a browser ad-blocker or missing Spotify Premium.`);
        });

        player.addListener('authentication_error', ({ message }) => {
            console.error('Failed to authenticate player:', message);
            // This error is critical and often means the token is invalid.
            showError(`Spotify Player Auth Error: ${message}. Your session may have expired.`);
            sessionStorage.clear(); // Force re-login
            // Optional: redirect after a delay
            setTimeout(() => window.location.href = 'index.html', 3000);
        });
        
        player.addListener('account_error', ({ message }) => {
            console.error('Account error:', message);
             showError(`Spotify Account Error: ${message}. A Premium account is required to use the Web Player.`);
        });

        // Connect the player
        player.connect().then(success => {
            if (success) {
                console.log('The Web Playback SDK successfully connected to Spotify!');
                showView('device');
                deviceFeedback.textContent = 'Web player is connecting... please wait.';
            } else {
                 throw new Error('The Web Playback SDK failed to connect.');
            }
        });

    } catch (error) {
        // This catch block handles the error thrown by getAccessToken() if the token is invalid.
        // The redirect is already handled, so we just log it.
        console.error("Initialization failed:", error.message);
    }
};


// --- Game Logic ---

/**
 * Main function to start the game session after device setup.
 */
async function startSession() {
    try {
        // Ensure we have a device ID
        if (!state.deviceId) {
            throw new Error("No active device ID found.");
        }
        
         // 1. Transfer playback to the new device (our web player)
        await SpotifyAPI.transferPlayback(state.deviceId);
        console.log(`Playback transferred to device: ${state.deviceId}`);

        // 1. Get user profile
        state.user = await SpotifyAPI.getUserProfile();

        // 2. Generate random session parameters
        generateSessionParameters();

        // 3. Fetch a pool of tracks
        const trackPool = await getTrackPool();
        if (trackPool.length < 3) {
            throw new Error("Could not find enough suitable tracks to start the session.");
        }

        // 4. Select 3 random tracks for the session
        state.session.tracks = selectRandomTracks(trackPool, 3);

        // 5. Create a new private playlist
        const playlistName = `Rhythm Game Session - ${new Date().toLocaleString()}`;
        const playlist = await SpotifyAPI.createPlaylist(state.user.id, playlistName);
        state.session.playlistId = playlist.id;

        // 6. Add tracks to the playlist
        const trackUris = state.session.tracks.map(t => t.uri);
        await SpotifyAPI.addTracksToPlaylist(playlist.id, trackUris);
        
        // 7. Render the UI for the session
        renderTrackList();
        showView('session');

        // 8. Start playback and monitoring
        await SpotifyAPI.play(playlist.uri);
        startTimers();
        
        // 9. Send telemetry data
        SpotifyAPI.sendWebhook(CONFIG.N8N_TELEMETRY_URL, {
            event: 'session_start',
            userId: state.user.id,
            ...state.session
        });

    } catch (error) {
        console.error('Failed to start session:', error);
        showError(`Could not start the session: ${error.message}`);
    }
}


// --- Application Entry Point ---

/**
 * Initializes the application on page load.
 */
function main() {
    // Start with the loading view. The SDK initialization will handle the next steps.
    showView('loading');
    
    // The Spotify Web Playback SDK will be initialized via the `onSpotifyWebPlaybackSDKReady`
    // global function, which acts as our entry point after the script loads.
    // If the SDK fails to load, the app will remain on the loading screen.
}

/**
 * Generates random parameters for the session.
 */
function generateSessionParameters() {
    // Total session duration between 5 and 10 minutes
    state.session.totalDuration = Math.floor(Math.random() * (600 - 300 + 1)) + 300;
    // Required listening percentage per track between 50% and 80%
    state.session.trackCompletionGoal = Math.floor(Math.random() * (80 - 50 + 1)) + 50;

    if (CONFIG.DEBUG_MODE) {
        console.log(`Session Parameters: duration=${state.session.totalDuration}s, trackGoal=${state.session.trackCompletionGoal}%`);
    }
}

/**
 * Fetches a pool of suitable tracks for the game.
 * It tries fetching from several sources (new releases, featured playlists)
 * and filters them to be instrumental and of a certain duration.
 * @returns {Promise<object[]>} A list of track objects.
 */
async function getTrackPool() {
    let tracks = [];

    // Fetch from various sources to build a large pool
    const [newReleases, featuredPlaylists] = await Promise.all([
        SpotifyAPI.getNewReleases().catch(() => null),
        SpotifyAPI.getFeaturedPlaylists().catch(() => null),
    ]);

    if (newReleases) {
        const albumTracks = await Promise.all(
            newReleases.albums.items.map(album => SpotifyAPI.getPlaylistTracks(album.id.replace('album', 'playlist')).catch(() => null))
        );
        albumTracks.forEach(playlist => {
            if (playlist) tracks.push(...playlist.items.map(item => item.track).filter(Boolean));
        });
    }

    if (featuredPlaylists) {
         const playlistTracks = await Promise.all(
            featuredPlaylists.playlists.items.map(pl => SpotifyAPI.getPlaylistTracks(pl.id).catch(() => null))
        );
        playlistTracks.forEach(playlist => {
            if (playlist) tracks.push(...playlist.items.map(item => item.track).filter(Boolean));
        });
    }
    
    // Filter out nulls, long tracks, and non-instrumental tracks if possible
    const trackIds = tracks.map(t => t.id).filter(Boolean);
    const audioFeatures = await SpotifyAPI.getAudioFeaturesForTracks(trackIds.slice(0, 100)); // API limit
    
    const instrumentalTracks = tracks.filter(track => {
        const features = audioFeatures.audio_features.find(f => f && f.id === track.id);
        // Exclude long tracks and prefer instrumental ones
        return features && track.duration_ms > 90000 && track.duration_ms < 600000 && features.instrumentalness > 0.6;
    });

    return instrumentalTracks.length > 10 ? instrumentalTracks : tracks.filter(t => t.duration_ms > 90000 && t.duration_ms < 600000);
}

/**
 * Selects a specified number of random tracks from a pool.
 * @param {object[]} pool - The array of tracks to choose from.
 * @param {number} count - The number of tracks to select.
 * @returns {object[]} A new array with the selected tracks.
 */
function selectRandomTracks(pool, count) {
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(track => ({
        ...track,
        listenedPercent: 0,
        goalMet: false,
    }));
}

/**
 * Renders the list of session tracks in the UI.
 */
function renderTrackList() {
    trackListEl.innerHTML = ''; // Clear previous tracks
    state.session.tracks.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item';
        trackElement.innerHTML = `
            <img src="${track.album.images[2]?.url || ''}" alt="Album art for ${track.name}">
            <div class="track-info">
                <span class="track-name">${track.name}</span>
                <span class="track-artist">${track.artists.map(a => a.name).join(', ')}</span>
                <div class="progress-bar">
                    <div id="track-progress-${index}" class="progress-bar-inner"></div>
                </div>
            </div>
        `;
        trackListEl.appendChild(trackElement);
    });
}

/**
 * Starts the timers for session duration and progress tracking.
 */
function startTimers() {
    state.session.startTime = Date.now();

    // Overall session timer
    state.session.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.session.startTime) / 1000);
        const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const seconds = String(elapsed % 60).padStart(2, '0');
        sessionTimerEl.textContent = `Total Time: ${minutes}:${seconds}`;

        const sessionProgress = (elapsed / state.session.totalDuration) * 100;
        sessionProgressEl.style.width = `${Math.min(sessionProgress, 100)}%`;

        checkCompletion(); // Check if goals are met
    }, 1000);

    // Playback progress tracking
    state.session.progressInterval = setInterval(async () => {
        const playerState = await state.player.getCurrentState();
        if (!playerState || !playerState.track_window.current_track) return;
        
        const currentTrack = state.session.tracks.find(t => t.id === playerState.track_window.current_track.id);
        if (!currentTrack) return;

        currentTrack.listenedPercent = (playerState.position / playerState.duration) * 100;

        const trackIndex = state.session.tracks.findIndex(t => t.id === currentTrack.id);
        const trackProgressEl = document.getElementById(`track-progress-${trackIndex}`);
        if(trackProgressEl) {
             trackProgressEl.style.width = `${Math.min(currentTrack.listenedPercent, 100)}%`;
        }
       
        if (currentTrack.listenedPercent >= state.session.trackCompletionGoal && !currentTrack.goalMet) {
            currentTrack.goalMet = true;
            console.log(`Track goal met for: ${currentTrack.name}`);
        }
    }, 500);
}

/**
 * Checks if all session completion criteria have been met.
 */
function checkCompletion() {
    const allTracksGoalMet = state.session.tracks.every(t => t.goalMet);
    const totalTimeMet = (Date.now() - state.session.startTime) / 1000 >= state.session.totalDuration;

    // Show "Finish Now" button if track goals are met but time is not
    if (allTracksGoalMet && !totalTimeMet) {
        finishNowBtn.classList.remove('hidden');
        finishNowBtn.onclick = () => finishSession();
    } else {
        finishNowBtn.classList.add('hidden');
    }
    
    // Complete session if both goals are met
    if(allTracksGoalMet && totalTimeMet) {
        finishSession();
    }
}

/**
 * Finalizes the session and displays the completion view.
 */
function finishSession() {
    // Stop all timers
    clearInterval(state.session.timerInterval);
    clearInterval(state.session.progressInterval);
    state.player.pause();

    // Generate completion code
    const code = `${state.user.id.substring(0, 4)}-${Date.now().toString().slice(-5)}`;
    completionCodeEl.textContent = code;

    // Send completion data to webhook
    SpotifyAPI.sendWebhook(CONFIG.N8N_COMPLETED_URL, {
        event: 'session_complete',
        userId: state.user.id,
        completionCode: code,
        session: state.session,
    });
    
    
    console.log("Session Finished!");
    showView('completion');
}


// Run the main function when the DOM is ready.
document.addEventListener('DOMContentLoaded', main);