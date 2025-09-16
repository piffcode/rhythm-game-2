// rhythm.js - Complete rhythm game logic with Spotify integration

// --- Configuration Constants --- TODO: REPLACE THESE VALUES
const CLIENT_ID = "314f6b8f332041dcb5f678b85acf36ea";
const REDIRECT_URI = "https://celebrated-gingersnap-9cd743.netlify.app/auth.html";

// --- Core tracks (URIs OR IDs accepted; normalize internally) ---
const ANCHOR_TRACK = "spotify:track:5FMyXeZ0reYloRTiCkPprT"; // TODO: Replace with your anchor track
const YOUR_TRACK = "spotify:track:0YWmeJtd7Fp1tH3978qUIH";   // TODO: Replace with your track
const FILLER_POOL = [
    "spotify:track:2FDTHlrBguDzQkp7PVj16Q", // TODO: Replace with 5-7 compatible tracks
    "spotify:track:21jGcNKet2qwijlDFuPiPb",
    "spotify:track:7qiZfU4dY1lWllzX7mPBI3",
    "spotify:track:0VjIjW4GlULA7vLyAoIf2Y",
    "spotify:track:6WrI0LAC5M1Rw2MnX2ZvEg"
];

// --- Session controls (naturalized) ---
const REQUIRED_MS_VARIANT = { baseMin: 11*60*1000, baseMax: 14*60*1000 }; // 11–14 min randomized
const MIN_TRACK_RATIO_DIST = { // per-track completion distribution
    lowBandProb: 0.15,   // 15% in ~72–79%
    midBandProb: 0.65,   // 65% in ~80–94%
    hiBandProb:  0.20    // 20% in ~95–100%
};
const EARLY_FINISH_WINDOW = { min: 0.80, max: 0.90 }; // early finish unlock range
const USE_PUBLIC_PLAYLIST_PROB = 0.40; // ~40% public, rest private

// Order variance: keep default order ~75% of sessions
const ORDER_VARIANCE = { defaultProb: 0.75, swap12: 0.13, swap23: 0.12 };

// Natural gaps between tracks (in ms)
const INTER_TRACK_GAP = { min: 1000, max: 9000, immediateProb: 0.15 };

// Optional interaction "noise"
const NOISE_OPTIONS = { enable: true, pauseProb: 0.4, volDipProb: 0.4, volDipSize: [0.05, 0.10] };

// Playlist naming - Highly randomized
const ADJECTIVES = ["Cosmic", "Electric", "Urban", "Neon", "Midnight", "Golden", "Fresh", "Vibe", "Pulse", "Echo", "Shadow", "Bliss", "Fury", "Dream", "Wild", "Silent", "Bright", "Dark", "Rapid", "Slow", "Hot", "Cool", "Deep", "High", "Low", "New", "Old", "Lost", "Found"];
const NOUNS = ["Waves", "Beats", "Mix", "Session", "Flow", "Rhythm", "Sound", "Track", "Vibe", "Pulse", "Echo", "Night", "Day", "City", "Road", "Air", "Fire", "Water", "Earth", "Space", "Time", "Dream", "Reality", "Shadow", "Light", "Beat", "Drop", "Rise", "Fall"];
const SUFFIXES = ["Mix", "Session", "Vibes", "Beats", "Flow", "Radar", "Room", "Pulse", "Blend", "Tapes", "Motion", "Cuts", "Drive", "Heat", "Waves"];
const TITLE_FLAVOR_GEO = true; // append " – TR/JP/ZA" when country hint provided

// Optional Save prompt probability
const SHOW_SAVE_PROMPT_PROB = 0.35;

// n8n telemetry webhooks (optional; safe to leave empty) TODO: REPLACE THESE URLs
const N8N_TELEMETRY_URL = ""; // "https://YOUR-N8N/telemetry"
const N8N_COMPLETED_URL = ""; // "https://YOUR-N8N/completed"

// Global game state
let gameState = {
    user: null,
    player: null,
    deviceId: null,
    currentTrack: 0,
    tracks: [],
    trackOrder: [],
    playlist: null,
    startedAt: null,
    sessionDuration: 0,
    minTrackRatio: 0,
    earlyFinishThreshold: 0,
    tracksCompleted: new Set(),
    isPlaying: false,
    currentPosition: 0,
    currentDuration: 0,
    sessionTimer: null,
    unlockTimer: null,
    completionCode: null,
    noiseApplied: false,
    showSaveButton: false,
    countryHint: null
};

// Canvas animation state
let canvasState = {
    canvas: null,
    ctx: null,
    animationId: null,
    markers: [],
    lastMarkerTime: 0
};

// Utility functions
function normalizeTrackUri(trackIdOrUri) {
    if (trackIdOrUri.startsWith('spotify:track:')) {
        return trackIdOrUri;
    }
    return `spotify:track:${trackIdOrUri}`;
}

function extractTrackId(trackIdOrUri) {
    if (trackIdOrUri.startsWith('spotify:track:')) {
        return trackIdOrUri.split(':')[2];
    }
    return trackIdOrUri;
}

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function sha256Hash(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function showMessage(text, type = 'info') {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = text;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }
}

function updateButton(text, enabled = true) {
    const button = document.getElementById('main-button');
    button.textContent = text;
    button.disabled = !enabled;
}

function updateTimer() {
    if (!gameState.startedAt) return;
    
    const elapsed = Date.now() - gameState.startedAt;
    document.getElementById('session-timer').textContent = formatTime(elapsed);
}

function updateTrackProgress() {
    if (gameState.currentTrack > 0 && gameState.currentTrack <= 3) {
        const trackIndex = gameState.currentTrack;
        const progressRatio = gameState.currentDuration > 0 ? 
            gameState.currentPosition / gameState.currentDuration : 0;
        const percentage = Math.round(progressRatio * 100);
        
        const progressEl = document.getElementById(`track${trackIndex}-progress`);
        const percentEl = document.getElementById(`track${trackIndex}-percent`);
        
        if (progressEl && percentEl) {
            progressEl.style.width = `${percentage}%`;
            percentEl.textContent = `${percentage}%`;
        }
    }
}

// Canvas animation
function initCanvas() {
    canvasState.canvas = document.getElementById('rhythm-canvas');
    canvasState.ctx = canvasState.canvas.getContext('2d');
    
    // Set canvas size
    function resizeCanvas() {
        const rect = canvasState.canvas.getBoundingClientRect();
        canvasState.canvas.width = rect.width * window.devicePixelRatio;
        canvasState.canvas.height = rect.height * window.devicePixelRatio;
        canvasState.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    startCanvasAnimation();
}

function createMarker() {
    return {
        x: Math.random() * canvasState.canvas.width / window.devicePixelRatio,
        y: -10,
        speed: randomBetween(1, 3),
        size: randomBetween(3, 8),
        opacity: randomBetween(0.3, 0.8),
        color: `hsl(${randomBetween(120, 140)}, 70%, 60%)` // Green variants
    };
}

function updateMarkers() {
    const now = Date.now();
    const canvas = canvasState.canvas;
    const height = canvas.height / window.devicePixelRatio;
    
    // Create new markers when playing
    if (gameState.isPlaying && now - canvasState.lastMarkerTime > randomBetween(200, 800)) {
        canvasState.markers.push(createMarker());
        canvasState.lastMarkerTime = now;
    }
    
    // Update existing markers
    canvasState.markers.forEach((marker, index) => {
        marker.y += marker.speed;
        
        // Remove markers that are off screen
        if (marker.y > height + 20) {
            canvasState.markers.splice(index, 1);
        }
    });
}

function drawMarkers() {
    const ctx = canvasState.ctx;
    const canvas = canvasState.canvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
    
    // Draw markers
    canvasState.markers.forEach(marker => {
        ctx.globalAlpha = marker.opacity;
        ctx.fillStyle = marker.color;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, marker.size, 0, Math.PI * 2);
        ctx.fill();
    });
    
    ctx.globalAlpha = 1;
}

function startCanvasAnimation() {
    function animate() {
        updateMarkers();
        drawMarkers();
        canvasState.animationId = requestAnimationFrame(animate);
    }
    animate();
}

// Spotify API functions
async function getAccessToken() {
    const token = sessionStorage.getItem('access_token');
    const expiresAt = sessionStorage.getItem('expires_at');
    
    if (!token) return null;
    
    // Check if token is expired
    if (expiresAt && Date.now() >= parseInt(expiresAt)) {
        const refreshToken = sessionStorage.getItem('refresh_token');
        if (refreshToken) {
            return await refreshAccessToken(refreshToken);
        }
        return null;
    }
    
    return token;
}

async function refreshAccessToken(refreshToken) {
    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: CLIENT_ID
            })
        });
        
        if (!response.ok) throw new Error('Token refresh failed');
        
        const tokens = await response.json();
        
        sessionStorage.setItem('access_token', tokens.access_token);
        sessionStorage.setItem('expires_at', Date.now() + tokens.expires_in * 1000);
        
        if (tokens.refresh_token) {
            sessionStorage.setItem('refresh_token', tokens.refresh_token);
        }
        
        return tokens.access_token;
    } catch (error) {
        console.error('Token refresh failed:', error);
        showMessage('Session expired. Please log in again.', 'error');
        return null;
    }
}

async function spotifyApi(endpoint, options = {}) {
    const token = await getAccessToken();
    if (!token) {
        throw new Error('No valid access token');
    }
    
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    });
    
    if (!response.ok) {
        if (response.status === 401) {
            // Token expired, try refresh
            const refreshToken = sessionStorage.getItem('refresh_token');
            if (refreshToken) {
                const newToken = await refreshAccessToken(refreshToken);
                if (newToken) {
                    // Retry once with new token
                    const retryResponse = await fetch(`https://api.spotify.com/v1${endpoint}`, {
                        headers: {
                            'Authorization': `Bearer ${newToken}`,
                            'Content-Type': 'application/json',
                            ...options.headers
                        },
                        ...options
                    });
                    if (retryResponse.ok) {
                        return retryResponse.json();
                    }
                }
            }
            showMessage('Authentication failed. Please log in again.', 'error');
            redirectToAuth();
            throw new Error('Authentication failed');
        }
        
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }
    
    return response.json();
}

// Game initialization
async function initializeGame() {
    try {
        console.log('=== GAME INIT DEBUG ===');
        const urlParams = new URLSearchParams(window.location.search);

        // Verify bootstrap parameter
        const bootstrap = urlParams.get('bootstrap');
        const storedNonce = sessionStorage.getItem('bootstrap_nonce');
        if (!bootstrap || bootstrap !== storedNonce) {
            console.log('Bootstrap mismatch or direct access. Checking token...');
            const token = await getAccessToken();
            if (!token) {
                console.log('❌ No valid token - redirecting to auth');
                return redirectToAuth();
            }
            console.log('Valid token found, but setup not complete. Redirecting to setup page.');
            const setupUrl = new URL('./spotify-setup.html', window.location.href);
            if(bootstrap) setupUrl.searchParams.set('bootstrap', bootstrap);
            if(urlParams.get('country')) setupUrl.searchParams.set('country', urlParams.get('country'));
            window.location.href = setupUrl.toString();
            return;
        }

        // Check if setup was completed
        if (urlParams.get('setup_complete') === 'true') {
            const setupDeviceId = sessionStorage.getItem('setup_device_id');
            if (setupDeviceId) {
                gameState.deviceId = setupDeviceId;
                console.log(`Device setup completed. Using device ID: ${setupDeviceId}`);
            } else {
                 throw new Error("Setup complete but no device ID found.");
            }
        } else {
            console.log("Device setup not completed. Redirecting to setup page.");
            const setupUrl = new URL('./spotify-setup.html', window.location.href);
            setupUrl.searchParams.set('bootstrap', storedNonce);
            if(urlParams.get('country')) setupUrl.searchParams.set('country', urlParams.get('country'));
            window.location.href = setupUrl.toString();
            return;
        }

        // Get country hint
        gameState.countryHint = urlParams.get('country');
        
        // Fetch user profile
        gameState.user = await spotifyApi('/me');
        
        // Update UI with user info
        updateUserInfo();
        
        // Generate session parameters
        generateSessionParameters();
        
        // Initialize Spotify player
        await initializeSpotifyPlayer();
        
        showMessage('Device ready! Click "Start Session" to begin.', 'success');
        updateButton('Start Session', true);
        
    } catch (error) {
        console.error('Initialization failed:', error);
        showMessage(`Failed to initialize: ${error.message}`, 'error');
    }
}

function updateUserInfo() {
    const userInfoEl = document.getElementById('user-info');
    let html = `<div class="username">${gameState.user.display_name || 'User'}</div>`;
    
    if (gameState.countryHint) {
        const countryFlags = {
            'TR': '🇹🇷', 'JP': '🇯🇵', 'ZA': '🇿🇦', 'US': '🇺🇸', 
            'GB': '🇬🇧', 'DE': '🇩🇪', 'FR': '🇫🇷', 'BR': '🇧🇷'
        };
        const flag = countryFlags[gameState.countryHint] || '🌍';
        html = `<div class="country-flag">${flag}</div>` + html;
    }
    
    userInfoEl.innerHTML = html;
}

function generateSessionParameters() {
    // Session duration (11-14 minutes)
    gameState.sessionDuration = randomBetween(
        REQUIRED_MS_VARIANT.baseMin, 
        REQUIRED_MS_VARIANT.baseMax
    );
    
    // Early finish threshold (80-90% of session duration)
    gameState.earlyFinishThreshold = gameState.sessionDuration * 
        randomBetween(EARLY_FINISH_WINDOW.min, EARLY_FINISH_WINDOW.max);
    
    // Minimum track ratio per session
    const rand = Math.random();
    if (rand < MIN_TRACK_RATIO_DIST.lowBandProb) {
        gameState.minTrackRatio = randomBetween(0.72, 0.79);
    } else if (rand < MIN_TRACK_RATIO_DIST.lowBandProb + MIN_TRACK_RATIO_DIST.midBandProb) {
        gameState.minTrackRatio = randomBetween(0.80, 0.94);
    } else {
        gameState.minTrackRatio = randomBetween(0.95, 1.0);
    }
    
    // Determine if save button should appear
    gameState.showSaveButton = Math.random() < SHOW_SAVE_PROMPT_PROB;
    
    // Generate track order
    generateTrackOrder();
    
    console.log('Session parameters:', {
        duration: Math.round(gameState.sessionDuration / 60000) + ' minutes',
        minTrackRatio: Math.round(gameState.minTrackRatio * 100) + '%',
        trackOrder: gameState.trackOrder.map(extractTrackId),
        showSave: gameState.showSaveButton
    });
}

function generateTrackOrder() {
    // Pick random filler track
    const filler = randomChoice(FILLER_POOL);
    
    // Base order: anchor, your track, filler
    let order = [ANCHOR_TRACK, YOUR_TRACK, filler];
    
    // Apply order variance
    const rand = Math.random();
    if (rand > ORDER_VARIANCE.defaultProb) {
        if (rand < ORDER_VARIANCE.defaultProb + ORDER_VARIANCE.swap12) {
            // Swap positions 1 and 2
            [order[0], order[1]] = [order[1], order[0]];
        } else {
            // Swap positions 2 and 3
            [order[1], order[2]] = [order[2], order[1]];
        }
    }
    
    gameState.trackOrder = order.map(normalizeTrackUri);
}

// Spotify Player setup
function initializeSpotifyPlayer() {
    return new Promise((resolve, reject) => {
        if (!window.Spotify) {
            reject(new Error('Spotify Web Playback SDK not loaded'));
            return;
        }
        
        window.onSpotifyWebPlaybackSDKReady = async () => {
            const token = await getAccessToken();
            
            gameState.player = new Spotify.Player({
                name: 'Rhythm Game Player',
                getOAuthToken: async (cb) => {
                    const currentToken = await getAccessToken();
                    cb(currentToken);
                },
                volume: 0.8
            });
            
            // Error handling
            gameState.player.addListener('initialization_error', ({ message }) => {
                console.error('Initialization error:', message);
                reject(new Error(message));
            });
            
            gameState.player.addListener('authentication_error', ({ message }) => {
                console.error('Authentication error:', message);
                showMessage('Auth issue detected. Try clicking "Start Session" again.', 'warning');
            });
            
            gameState.player.addListener('account_error', ({ message }) => {
                console.error('Account error:', message);
                showMessage('Spotify Premium required for full playback', 'error');
            });
            
            gameState.player.addListener('playback_error', ({ message }) => {
                console.error('Playback error:', message);
                showMessage('Playback error occurred', 'error');
            });
            
            // Ready event
            gameState.player.addListener('ready', ({ device_id }) => {
                console.log('Ready with device ID:', device_id);
                gameState.deviceId = device_id;
                resolve();
            });
            
            // Not ready event
            gameState.player.addListener('not_ready', ({ device_id }) => {
                console.log('Device has gone offline:', device_id);
                showMessage('Playback device disconnected', 'warning');
            });
            
            // Player state changed
            gameState.player.addListener('player_state_changed', (state) => {
                handlePlayerStateChanged(state);
            });
            
            // Connect (requires user gesture)
            document.getElementById('main-button').addEventListener('click', async () => {
                if (!gameState.player._options.getOAuthToken) return;
                
                try {
                    await gameState.player.connect();
                } catch (error) {
                    console.error('Failed to connect player:', error);
                    showMessage('Failed to connect player. Try again.', 'error');
                }
            });
        };
        
        // Trigger the callback if SDK is already ready
        if (window.Spotify) {
            window.onSpotifyWebPlaybackSDKReady();
        }
    });
}

function handlePlayerStateChanged(state) {
    if (!state) return;
    
    const { position, duration, paused, track_window } = state;
    
    gameState.currentPosition = position;
    gameState.currentDuration = duration;
    gameState.isPlaying = !paused;
    
    // Update current track info
    if (track_window && track_window.current_track) {
        const track = track_window.current_track;
        document.getElementById('track-title').textContent = track.name;
        document.getElementById('track-artist').textContent = track.artists[0]?.name || 'Unknown Artist';
    }
    
    // Update progress
    updateTrackProgress();
    
    // Check track completion
    if (gameState.currentTrack > 0 && duration > 0) {
        const progressRatio = position / duration;
        
        // Mark track as completed if it reaches minimum ratio
        if (progressRatio >= gameState.minTrackRatio && !gameState.tracksCompleted.has(gameState.currentTrack)) {
            gameState.tracksCompleted.add(gameState.currentTrack);
            console.log(`Track ${gameState.currentTrack} completed at ${Math.round(progressRatio * 100)}%`);
        }
        
        // Auto-advance to next track if current track ends
        if (position >= duration - 1000 && gameState.isPlaying) { // 1 second before end
            setTimeout(() => playNextTrack(), 100);
        }
    }
    
    // Check for session completion
    maybeUnlockCompletion();
}

// Playlist creation
async function createPlaylist() {
    try {
        // Generate highly random playlist name
        const adj = randomChoice(ADJECTIVES);
        const noun = randomChoice(NOUNS);
        const suffix = randomChoice(SUFFIXES);
        let playlistName = `${adj} ${noun} ${suffix}`;
        
        // Add random number or emoji ~30% chance
        if (Math.random() < 0.3) {
            playlistName += ' ' + Math.floor(Math.random() * 99).toString().padStart(2, '0');
        }
        if (Math.random() < 0.2) {
            const emojis = ['🎵', '🔥', '🌊', '⭐', '✨', '🎧'];
            playlistName += ' ' + randomChoice(emojis);
        }
        
        // Optional geo flavor
        if (TITLE_FLAVOR_GEO && gameState.countryHint && Math.random() < 0.6) { // 60% chance
            playlistName += ` – ${gameState.countryHint.toUpperCase()}`;
        }
        
        // Create playlist (no description for randomness)
        const isPublic = Math.random() < USE_PUBLIC_PLAYLIST_PROB;
        const playlistData = {
            name: playlistName,
            public: isPublic
        };
        
        const playlist = await spotifyApi(`/users/${gameState.user.id}/playlists`, {
            method: 'POST',
            body: JSON.stringify(playlistData)
        });
        
        gameState.playlist = playlist;
        
        // Add tracks to playlist
        const trackUris = gameState.trackOrder;
        await spotifyApi(`/playlists/${playlist.id}/tracks`, {
            method: 'POST',
            body: JSON.stringify({
                uris: trackUris
            })
        });
        
        // Send telemetry
        await sendTelemetry({
            type: 'playlist_created',
            user_hash: await sha256Hash(gameState.user.id),
            playlist_id: playlist.id,
            country: gameState.countryHint,
            order: trackUris,
            title: playlistName,
            is_public: isPublic
        });
        
        console.log('Playlist created:', playlist.external_urls.spotify);
        return playlist;
        
    } catch (error) {
        console.error('Failed to create playlist:', error);
        throw error;
    }
}

// Playback control
async function startSession() {
    try {
        updateButton('Starting...', false);
        showMessage('Creating playlist and starting playback...', 'info');
        
        // Create playlist
        await createPlaylist();
        
        // Transfer playback to our device
        await transferPlayback();
        
        // Start playing first track
        gameState.currentTrack = 1;
        gameState.startedAt = Date.now();
        
        await playCurrentTrack();
        
        // Start timers
        gameState.sessionTimer = setInterval(updateTimer, 1000);
        gameState.unlockTimer = setInterval(() => maybeUnlockCompletion(), 10000);
        
        // Show progress bars
        document.querySelectorAll('.track-progress').forEach(el => {
            el.style.display = 'block';
        });
        
        updateButton('Playing...', false);
        showMessage('Session started! Enjoy the music 🎵', 'success');
        
    } catch (error) {
        console.error('Failed to start session:', error);
        showMessage(`Failed to start: ${error.message}`, 'error');
        updateButton('Start Session', true);
    }
}

async function transferPlayback() {
    try {
        // Get available devices
        const devices = await spotifyApi('/me/player/devices');
        
        // Find our device
        const ourDevice = devices.devices.find(d => d.id === gameState.deviceId);
        if (!ourDevice) {
            throw new Error('Player device not found. Click "Start Session" again.');
        }
        
        // Transfer playback
        await spotifyApi('/me/player', {
            method: 'PUT',
            body: JSON.stringify({
                device_ids: [gameState.deviceId],
                play: false
            })
        });
        
        // Wait a moment for transfer
        await new Promise(resolve => setTimeout(resolve, 1000));
        
    } catch (error) {
        console.error('Playback transfer failed:', error);
        throw new Error('Failed to connect to player. Make sure Spotify is open.');
    }
}

async function playCurrentTrack() {
    if (gameState.currentTrack > gameState.trackOrder.length) return;
    
    const trackUri = gameState.trackOrder[gameState.currentTrack - 1];
    
    try {
        await spotifyApi('/me/player/play', {
            method: 'PUT',
            body: JSON.stringify({
                device_id: gameState.deviceId,
                uris: [trackUri]
            })
        });
        
        // Send telemetry
        await sendTelemetry({
            type: 'track_event',
            track_id: extractTrackId(trackUri),
            event: 'started',
            track_number: gameState.currentTrack
        });
        
        console.log(`Playing track ${gameState.currentTrack}:`, trackUri);
        
        // Apply noise interaction if enabled and not done yet
        if (NOISE_OPTIONS.enable && !gameState.noiseApplied && Math.random() < 0.3) {
            scheduleNoiseInteraction();
        }
        
        // Show save button for your track
        if (trackUri === YOUR_TRACK && gameState.showSaveButton) {
            document.getElementById('save-button').style.display = 'block';
        }
        
    } catch (error) {
        console.error('Failed to play track:', error);
        showMessage('Failed to play track', 'error');
    }
}

async function playNextTrack() {
    if (gameState.currentTrack >= gameState.trackOrder.length) {
        // Session complete
        return;
    }
    
    // Send telemetry for current track end
    const currentTrackUri = gameState.trackOrder[gameState.currentTrack - 1];
    await sendTelemetry({
        type: 'track_event',
        track_id: extractTrackId(currentTrackUri),
        event: 'ended',
        track_number: gameState.currentTrack,
        position_ms: gameState.currentPosition,
        duration_ms: gameState.currentDuration
    });
    
    gameState.currentTrack++;
    
    if (gameState.currentTrack <= gameState.trackOrder.length) {
        // Calculate gap between tracks
        const gapMs = Math.random() < INTER_TRACK_GAP.immediateProb ? 0 :
            randomBetween(INTER_TRACK_GAP.min, INTER_TRACK_GAP.max);
        
        setTimeout(() => {
            playCurrentTrack();
        }, gapMs);
    }
}

function scheduleNoiseInteraction() {
    const delayMs = randomBetween(30000, 120000); // 30s - 2min into track
    
    setTimeout(async () => {
        if (!gameState.isPlaying || gameState.noiseApplied) return;
        
        gameState.noiseApplied = true;
        
        if (Math.random() < NOISE_OPTIONS.pauseProb) {
            // Brief pause
            await gameState.player.pause();
            setTimeout(() => {
                if (gameState.player) gameState.player.resume();
            }, randomBetween(2000, 5000));
        } else if (Math.random() < NOISE_OPTIONS.volDipProb) {
            // Volume dip
            const originalVol = await gameState.player.getVolume();
            const dipAmount = randomBetween(...NOISE_OPTIONS.volDipSize);
            await gameState.player.setVolume(Math.max(0, originalVol - dipAmount));
            
            setTimeout(() => {
                if (gameState.player) gameState.player.setVolume(originalVol);
            }, randomBetween(3000, 8000));
        }
    }, delayMs);
}

// Completion logic
function maybeUnlockCompletion() {
    if (gameState.completionCode) return; // Already completed
    
    const elapsed = Date.now() - (gameState.startedAt || Date.now());
    const allTracksCompleted = gameState.tracksCompleted.size === gameState.trackOrder.length;
    
    // Check for full completion
    if (elapsed >= gameState.sessionDuration && allTracksCompleted) {
        unlockCompletion();
        return;
    }
    
    // Check for early finish eligibility
    if (elapsed >= gameState.earlyFinishThreshold && allTracksCompleted) {
        showEarlyFinishOption();
    }
}

function showEarlyFinishOption() {
    const finishBtn = document.getElementById('finish-button');
    if (finishBtn.style.display === 'none') {
        finishBtn.style.display = 'block';
        finishBtn.onclick = unlockCompletion;
        showMessage('All tracks completed! You can finish early if you want.', 'success');
    }
}

async function unlockCompletion() {
    if (gameState.completionCode) return;
    
    // Generate completion code
    gameState.completionCode = generateCompletionCode();
    
    // Stop timers
    if (gameState.sessionTimer) clearInterval(gameState.sessionTimer);
    if (gameState.unlockTimer) clearInterval(gameState.unlockTimer);
    
    // Update UI
    document.getElementById('completion-code').textContent = gameState.completionCode;
    document.getElementById('completion-area').style.display = 'block';
    document.getElementById('main-button').style.display = 'none';
    document.getElementById('finish-button').style.display = 'none';
    
    // Send completion telemetry
    const elapsed = Date.now() - gameState.startedAt;
    await sendTelemetry({
        type: 'session_completed',
        user_hash: await sha256Hash(gameState.user.id),
        playlist_id: gameState.playlist?.id,
        track_uris: gameState.trackOrder,
        order_chosen: gameState.trackOrder.map(extractTrackId),
        per_track_ratios: Array.from(gameState.tracksCompleted).map(() => gameState.minTrackRatio),
        elapsed_ms: elapsed,
        country: gameState.countryHint,
        completion_code: gameState.completionCode,
        tracks_completed: gameState.tracksCompleted.size
    }, N8N_COMPLETED_URL);
    
    showMessage('🎉 Congratulations! Session completed successfully!', 'success');
}

function generateCompletionCode() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = 'PM-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Save track functionality
async function saveTrack() {
    try {
        const trackId = extractTrackId(YOUR_TRACK);
        await spotifyApi(`/me/tracks?ids=${trackId}`, {
            method: 'PUT'
        });
        
        document.getElementById('save-button').textContent = '💖 Saved!';
        document.getElementById('save-button').disabled = true;
        showMessage('Track saved to your library!', 'success');
        
    } catch (error) {
        console.error('Failed to save track:', error);
        showMessage('Failed to save track', 'error');
    }
}

// Telemetry
async function sendTelemetry(data, customUrl = null) {
    const url = customUrl || N8N_TELEMETRY_URL;
    if (!url) return; // Telemetry disabled
    
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                timestamp: new Date().toISOString(),
                ...data
            })
        });
    } catch (error) {
        console.warn('Telemetry failed:', error);
        // Don't show error to user for telemetry failures
    }
}

// Utility functions for redirects
function redirectToAuth() {
    // Clear session and persistent tokens for a full logout
    sessionStorage.clear();
    localStorage.removeItem('encrypted_refresh_token');
    
    // Use the config for the redirect URI
    const authUrl = new URL(CONFIG.REDIRECT_URI);
    const urlParams = new URLSearchParams(window.location.search);
    const country = urlParams.get('country');
    if (country) {
        authUrl.searchParams.set('country', country);
    }
    
    window.location.href = authUrl.toString();
}

// Event listeners and initialization
document.addEventListener('DOMContentLoaded', function() {
    // Initialize canvas
    initCanvas();
    
    // Set up main button
    const mainButton = document.getElementById('main-button');
    mainButton.addEventListener('click', async function() {
        if (this.textContent === 'Start Session') {
            await startSession();
        }
    });
    
    // Set up save button
    document.getElementById('save-button').addEventListener('click', saveTrack);
    
    // Initialize the game
    initializeGame().catch(error => {
        console.error('Game initialization failed:', error);
        showMessage('Failed to initialize game. Please try refreshing.', 'error');
    });
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Page is hidden, pause if playing
        if (gameState.player && gameState.isPlaying) {
            gameState.player.pause();
        }
    } else {
        // Page is visible again, resume if was playing
        if (gameState.player && gameState.startedAt && !gameState.completionCode) {
            gameState.player.resume();
        }
    }
});

// Handle page unload
window.addEventListener('beforeunload', function(e) {
    if (gameState.startedAt && !gameState.completionCode) {
        e.preventDefault();
        e.returnValue = 'Your rhythm session is still in progress. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (gameState.player) {
        switch(e.code) {
            case 'Space':
                e.preventDefault();
                if (gameState.isPlaying) {
                    gameState.player.pause();
                } else {
                    gameState.player.resume();
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                gameState.player.seek(Math.max(0, gameState.currentPosition - 10000));
                break;
            case 'ArrowRight':
                e.preventDefault();
                gameState.player.seek(Math.min(gameState.currentDuration, gameState.currentPosition + 10000));
                break;
        }
    }
});

// Export for debugging (in browser console)
window.gameState = gameState;
window.spotifyApi = spotifyApi;

// Function to trigger Spotify app open
function openSpotifyApp() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    let spotifyUrl;
    
    if (isMobile) {
        spotifyUrl = 'spotify://'; // Deep link for mobile app
    } else {
        spotifyUrl = 'spotify:'; // Desktop URI scheme
    }
    
    try {
        window.location.href = spotifyUrl;
        showMessage('Opening Spotify... Play a song to activate your device.', 'info');
    } catch (error) {
        // Fallback to web player
        window.open('https://open.spotify.com', '_blank');
        showMessage('Opening Spotify Web Player. Log in and play a song to activate.', 'info');
    }
    
    // Hide button after click
    document.getElementById('open-spotify-btn').style.display = 'none';
}
