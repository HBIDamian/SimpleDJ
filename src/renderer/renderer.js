const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Audio context for equalizer and effects
let audioContext;
let audioSource;
let audioSource2; // Second audio source for crossfading
let gainNode;
let gainNode2; // Second gain node for crossfading
let analyser;
let equalizer = {};

// Player state
let currentPlaylist = null;
let currentTrackIndex = 0;
let shuffledQueue = []; // Shuffled order of track indices
let shuffledIndex = 0; // Current position in shuffled queue
let isPlaying = false;
let isShuffled = true;
let repeatMode = 'all'; // 'off', 'all', 'one'
let volume = 0.7;
let isMuted = false;
let previousVolume = 0.7;
let isInMuteOperation = false; // Flag to track mute/unmute operations

// Safe/Lock mode
let safeModeEnabled = false;

// Crossfade system
let crossfadeEnabled = true;
let crossfadeDuration = 3; // 3 seconds default
let isCrossfading = false;
let crossfadeTimer = null;
let activePlayer = 1; // 1 or 2, tracks which player is currently primary
let preloadedNextTrack = false;

// Audio processing
let compressor;
let normalizationEnabled = true;

// Playlist editor state
let editingPlaylist = null;
let editingTracks = [];

// DOM elements
const audioPlayer = document.getElementById('audioPlayer');
let audioPlayer2; // Will be created dynamically
const playPauseBtn = document.getElementById('playPauseBtn');
const previousBtn = document.getElementById('previousBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const volumeSlider = document.getElementById('volumeSliderBar');
const muteBtn = document.getElementById('muteBtn');
const fadeOutBtn = document.getElementById('fadeOutBtn');
const fadeInBtn = document.getElementById('fadeInBtn');
const volumeDisplay = document.getElementById('volumeDisplay');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressHandle = document.getElementById('progressHandle');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const trackTitle = document.getElementById('trackTitle');
const trackArtist = document.getElementById('trackArtist');
const trackAlbum = document.getElementById('trackAlbum');
const trackArt = document.getElementById('trackArt');
const playlistList = document.getElementById('playlistList');
const trackList = document.getElementById('trackList');
const currentPlaylistTitle = document.getElementById('currentPlaylistTitle');
const crossfadeBtn = document.getElementById('crossfadeCheckbox');

// Modal elements
const equalizerModal = document.getElementById('equalizerModal');
const addPlaylistModal = document.getElementById('addPlaylistModal');
const playlistNameInput = document.getElementById('playlistNameInput');

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
  await initializeAudio();
  await loadPlaylists();
  await validateAllTracks(); // Validate tracks on startup
  await restoreLastSession();
  await loadDefaultPlaylist(); // Load default playlist if set
  await loadSafeModeState(); // Load safe mode state
  setupEventListeners();
  setupKeyboardShortcuts();
  
  // Initialize fade button states
  updateFadeButtonStates();
  
  // Ensure playlist name input is always ready
  if (playlistNameInput) {
    playlistNameInput.disabled = false;
    playlistNameInput.readOnly = false;
  }
});

// Audio initialization with Web Audio API
async function initializeAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create second audio player for crossfading
    audioPlayer2 = document.createElement('audio');
    audioPlayer2.preload = 'metadata';
    document.body.appendChild(audioPlayer2);
    
    // Create audio nodes for both players
    audioSource = audioContext.createMediaElementSource(audioPlayer);
    audioSource2 = audioContext.createMediaElementSource(audioPlayer2);
    
    gainNode = audioContext.createGain();
    gainNode2 = audioContext.createGain();
    
    analyser = audioContext.createAnalyser();
    compressor = audioContext.createDynamicsCompressor();
    
    // Setup equalizer bands (shared between both players)
    const frequencies = [60, 170, 350, 1000, 3000, 6000, 12000, 14000, 16000];
    frequencies.forEach(freq => {
      const filter = audioContext.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      equalizer[freq] = filter;
    });
    
    // Connect audio nodes for player 1
    let currentNode = audioSource;
    Object.values(equalizer).forEach(filter => {
      currentNode.connect(filter);
      currentNode = filter;
    });
    currentNode.connect(compressor);
    compressor.connect(gainNode);
    
    // Connect audio nodes for player 2 (shares EQ and compressor)
    let currentNode2 = audioSource2;
    Object.values(equalizer).forEach(filter => {
      currentNode2.connect(filter);
      currentNode2 = filter;
    });
    currentNode2.connect(compressor);
    compressor.connect(gainNode2);
    
    // Mix both gain nodes and connect to output
    const mixer = audioContext.createGain();
    gainNode.connect(mixer);
    gainNode2.connect(mixer);
    mixer.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // Setup compressor for normalization
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    
    // Initialize gain levels
    gainNode.gain.value = volume;
    gainNode2.gain.value = 0; // Start with player 2 silent
    
  } catch (error) {
    console.error('Failed to initialize audio context:', error);
  }
}

// Progress-bar based slider handling functions
function initializeSlider(sliderId, callback, isVertical = false) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;

  const fill = slider.querySelector('.progress-fill');
  const handle = slider.querySelector('.progress-handle');
  
  let isDragging = false;

  function updateSlider(event) {
    const rect = slider.getBoundingClientRect();
    let percent;
    
    if (isVertical) {
      // For vertical sliders, calculate from bottom (0%) to top (100%)
      percent = Math.max(0, Math.min(100, ((rect.bottom - event.clientY) / rect.height) * 100));
    } else {
      // For horizontal sliders, calculate from left (0%) to right (100%)
      percent = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    }
    
    const min = parseFloat(slider.dataset.min) || 0;
    const max = parseFloat(slider.dataset.max) || 100;
    const step = parseFloat(slider.dataset.step) || 1;
    
    // Calculate actual value based on percentage
    const rawValue = min + (percent / 100) * (max - min);
    const steppedValue = Math.round(rawValue / step) * step;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));
    
    // Update visual position
    const visualPercent = ((clampedValue - min) / (max - min)) * 100;
    
    if (isVertical) {
      fill.style.height = visualPercent + '%';
      handle.style.top = (100 - visualPercent) + '%';
    } else {
      fill.style.width = visualPercent + '%';
      handle.style.left = visualPercent + '%';
    }
    
    // Update data attribute
    slider.dataset.value = clampedValue;
    
    // Call callback
    if (callback) callback(clampedValue);
  }

  slider.addEventListener('mousedown', (event) => {
    isDragging = true;
    updateSlider(event);
    event.preventDefault();
  });

  document.addEventListener('mousemove', (event) => {
    if (isDragging) {
      updateSlider(event);
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

function setSliderValue(sliderId, value, isVertical = false) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;

  const fill = slider.querySelector('.progress-fill');
  const handle = slider.querySelector('.progress-handle');
  
  const min = parseFloat(slider.dataset.min) || 0;
  const max = parseFloat(slider.dataset.max) || 100;
  
  const clampedValue = Math.max(min, Math.min(max, value));
  const percent = ((clampedValue - min) / (max - min)) * 100;
  
  if (isVertical) {
    fill.style.height = percent + '%';
    handle.style.top = (100 - percent) + '%';
  } else {
    fill.style.width = percent + '%';
    handle.style.left = percent + '%';
  }
  
  slider.dataset.value = clampedValue;
}

function getSliderValue(sliderId) {
  const slider = document.getElementById(sliderId);
  if (!slider) return 0;
  return parseFloat(slider.dataset.value) || 0;
}

// Event listeners setup
function setupEventListeners() {
  // Title bar controls (using ipcRenderer for better security)
  document.getElementById('minimizeBtn').addEventListener('click', () => {
    ipcRenderer.send('window-minimize');
  });
  
  document.getElementById('maximizeBtn').addEventListener('click', () => {
    ipcRenderer.send('window-maximize');
  });
  
  document.getElementById('closeBtn').addEventListener('click', () => {
    ipcRenderer.send('window-close');
  });

  // Player controls
  playPauseBtn.addEventListener('click', togglePlayPause);
  previousBtn.addEventListener('click', playPrevious);
  nextBtn.addEventListener('click', playNext);
  shuffleBtn.addEventListener('click', toggleShuffle);
  repeatBtn.addEventListener('click', toggleRepeat);
  crossfadeBtn.addEventListener('change', toggleCrossfade);
  
  // Initialize and setup progress-bar sliders
  initializeSlider('volumeSliderBar', updateVolume, false);
  initializeSlider('crossfadeTimeSlider', updateCrossfadeTime, false);
  initializeSlider('fadeOutDurationSlider', updateFadeOutDuration, false);
  initializeSlider('fadeInDurationSlider', updateFadeInDuration, false);
  
  // Initialize EQ sliders (vertical)
  const frequencies = [60, 170, 350, 1000, 3000, 6000, 12000, 14000, 16000];
  frequencies.forEach(freq => {
    const slider = document.querySelector(`.eq-slider[data-frequency="${freq}"]`);
    if (slider) {
      const sliderId = `eq-slider-${freq}`;
      // Set unique ID if not present
      if (!slider.id) {
        slider.id = sliderId;
      }
      initializeSlider(slider.id, (value) => updateEqualizerBand(freq, value), true);
    }
  });
  
  // Volume controls
  muteBtn.addEventListener('click', toggleMute);
  fadeOutBtn.addEventListener('click', startFadeOut);
  fadeInBtn.addEventListener('click', startFadeIn);
  
  // Progress bar
  progressBar.addEventListener('click', seekToPosition);
  progressHandle.addEventListener('mousedown', startProgressDrag);
  
  // Audio player events
  audioPlayer.addEventListener('loadedmetadata', onTrackLoaded);
  audioPlayer.addEventListener('timeupdate', updateProgress);
  audioPlayer.addEventListener('ended', onTrackEnded);
  audioPlayer.addEventListener('error', onAudioError);
  
  // Second audio player events (for crossfading)
  audioPlayer2.addEventListener('loadedmetadata', onTrack2Loaded);
  audioPlayer2.addEventListener('timeupdate', updateProgress); // Add timeupdate for player 2 too
  audioPlayer2.addEventListener('ended', onTrack2Ended);
  audioPlayer2.addEventListener('error', onAudio2Error);
  
  // Playlist management
  document.getElementById('addPlaylistBtn').addEventListener('click', showAddPlaylistModal);
  document.getElementById('importMusicBtn').addEventListener('click', handleImportMusic);
  
  // Modal controls
  document.getElementById('equalizerBtn').addEventListener('click', showEqualizerModal);
  document.getElementById('closeEqModal').addEventListener('click', hideEqualizerModal);
  document.getElementById('resetEqBtn').addEventListener('click', resetEqualizer);
  
  document.getElementById('closeAddPlaylistModal').addEventListener('click', (e) => {
    console.log('Close button clicked');
    hideAddPlaylistModal();
  });
  document.getElementById('cancelAddPlaylistBtn').addEventListener('click', (e) => {
    console.log('Cancel button clicked');
    hideAddPlaylistModal();
  });
  document.getElementById('createPlaylistBtn').addEventListener('click', (e) => {
    console.log('Create button clicked');
    createNewPlaylist();
  });
  
  // Edit Playlist Modal controls
  document.getElementById('closeEditPlaylistModal').addEventListener('click', hideEditPlaylistModal);
  document.getElementById('cancelEditPlaylistBtn').addEventListener('click', hideEditPlaylistModal);
  document.getElementById('savePlaylistBtn').addEventListener('click', savePlaylistChanges);
  document.getElementById('deletePlaylistBtn').addEventListener('click', showDeleteConfirmation);
  
  // Delete Confirmation Modal controls
  document.getElementById('cancelDeleteBtn').addEventListener('click', hideDeleteConfirmation);
  document.getElementById('confirmDeleteBtn').addEventListener('click', deleteCurrentPlaylist);
  
  // Settings Modal controls
  document.getElementById('settingsBtn').addEventListener('click', showSettingsModal);
  document.getElementById('closeSettingsModal').addEventListener('click', hideSettingsModal);
  document.getElementById('crossfadeTimeSlider').addEventListener('input', updateCrossfadeTime);
  document.getElementById('defaultPlaylistSelect').addEventListener('change', saveDefaultPlaylist);
  document.getElementById('exportPlaylistsBtn').addEventListener('click', exportAllPlaylists);
  document.getElementById('importPlaylistsBtn').addEventListener('click', importPlaylists);
  document.getElementById('clearSessionBtn').addEventListener('click', clearAllData);
  document.getElementById('safeModeCheckbox').addEventListener('change', toggleSafeMode);
  
  // Keyboard Shortcuts Modal controls
  document.getElementById('keyboardShortcutsBtn').addEventListener('click', showKeyboardShortcutsModal);
  document.getElementById('closeKeyboardShortcutsModal').addEventListener('click', hideKeyboardShortcutsModal);
  
  // About Modal controls
  document.getElementById('aboutBtn').addEventListener('click', showAboutModal);
  document.getElementById('closeAboutModal').addEventListener('click', hideAboutModal);
  
  // Clear Data Confirmation Modal controls
  document.getElementById('cancelClearDataBtn').addEventListener('click', hideClearDataConfirmModal);
  document.getElementById('confirmClearDataBtn').addEventListener('click', performClearAllData);
  
  // Equalizer controls
  setupEqualizerControls();
  
  // Drag and drop
  setupDragAndDrop();
  
  // IPC listeners
  setupIPCListeners();
  
  // Initialize UI state
  initializeUIState();
}

function initializeUIState() {
  // Initial UI setup - set all control icons to their correct initial states
  
  // Initialize shuffle button appearance
  const shuffleIcon = shuffleBtn.querySelector('i');
  if (isShuffled) {
    shuffleBtn.classList.add('active');
    shuffleIcon.className = 'fas fa-random';
    shuffleBtn.title = 'Shuffle: On';
    shuffleBtn.style.opacity = '1';
  } else {
    shuffleBtn.classList.remove('active');
    shuffleIcon.className = 'fas fa-sort-numeric-down';
    shuffleBtn.title = 'Shuffle: Off (Sequential)';
    shuffleBtn.style.opacity = '0.6';
  }
  
  // Initialize repeat button appearance
  const repeatIcon = repeatBtn.querySelector('i');
  if (repeatMode === 'off') {
    repeatBtn.classList.remove('active');
    repeatIcon.className = 'fas fa-redo';
    repeatBtn.title = 'Repeat: Off';
    repeatBtn.style.opacity = '0.5';
  } else if (repeatMode === 'all') {
    repeatBtn.classList.add('active');
    repeatIcon.className = 'fas fa-redo';
    repeatBtn.title = 'Repeat: All Songs';
    repeatBtn.style.opacity = '1';
  } else if (repeatMode === 'one') {
    repeatBtn.classList.add('active');
    repeatIcon.className = 'fas fa-sync-alt';
    repeatBtn.title = 'Repeat: Current Song';
    repeatBtn.style.opacity = '1';
  }
  
  // Initialize volume display and icon
  updateVolume();
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip shortcuts when user is typing in input fields or textareas
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.code) {
      case 'F1':
        e.preventDefault();
        showKeyboardShortcutsModal();
        break;
      case 'F2':
        e.preventDefault();
        showAboutModal();
        break;
      case 'F8':
        e.preventDefault();
        safeModeEnabled = !safeModeEnabled;
        document.getElementById('safeModeCheckbox').checked = safeModeEnabled;  
        toggleSafeMode();
        break;
      case 'F10':
        e.preventDefault();
        showEqualizerModal();
        break;
      case 'F11':
        // Fullscreen toggle is handled by the main process.
        // ignored, handled by main process. I just added it here as a comment for reference.
        break;
      case 'F12':
        e.preventDefault();
        showSettingsModal();
        break;
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        if (e.shiftKey) playPrevious();
        else seekRelative(-10);
        break;
      case 'ArrowRight':
        if (e.shiftKey) playNext();
        else seekRelative(10);
        break;
      case 'ArrowUp':
        // if ctrl key is held, Fade In
        e.preventDefault();
        if (e.ctrlKey) {
            startFadeIn();          
        } else {
          changeVolume(5);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (e.ctrlKey) {
            startFadeOut();          
        } else {
          changeVolume(-5);
        }
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'KeyS':
        toggleShuffle();
        break;
      case 'KeyR':
        // if hold ctrl, reload the page
        if (e.ctrlKey) {
          location.reload();
        } else {
          toggleRepeat();
        }
        break;
    }
  });
}

// IPC event listeners
function setupIPCListeners() {
  ipcRenderer.on('tray-play-pause', togglePlayPause);
  ipcRenderer.on('tray-previous', playPrevious);
  ipcRenderer.on('tray-next', playNext);
  ipcRenderer.on('open-file', (event, filePath) => {
    addFileToCurrentPlaylist(filePath);
  });
}

// Player control functions
function togglePlayPause() {
  if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  
  if (isPlaying) {
    activeAudio.pause();
    // Also pause the other player if crossfading
    if (isCrossfading) {
      const inactiveAudio = activePlayer === 1 ? audioPlayer2 : audioPlayer;
      inactiveAudio.pause();
    }
    isPlaying = false;
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  } else {
    activeAudio.play().catch(error => {
      console.error('Playback failed:', error);
      showNotification('Playback failed. Please check the audio file.', 'error');
    });
    // Also resume the other player if crossfading
    if (isCrossfading) {
      const inactiveAudio = activePlayer === 1 ? audioPlayer2 : audioPlayer;
      inactiveAudio.play().catch(error => {
        console.error('Crossfade playback failed:', error);
      });
    }
    isPlaying = true;
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  }
  
  // Update playlist selector state based on play/pause
  updatePlaylistSelectorState();
  
  updateTrayInfo();
}

function playPrevious() {
  if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;
  
  // Cancel any active crossfade
  if (isCrossfading) {
    cancelCrossfade();
  }
  
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  
  if (activeAudio.currentTime > 3) {
    activeAudio.currentTime = 0;
    return;
  }
  
  currentTrackIndex = getPreviousTrackIndex();
  loadCurrentTrack();
}

function playNext() {
  if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;
  
  // If we're in the middle of a crossfade, let it finish naturally
  if (isCrossfading) {
    return;
  }
  
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  
  if (repeatMode === 'one') {
    activeAudio.currentTime = 0;
    activeAudio.play();
    return;
  }
  
  const nextIndex = advanceToNextTrack();
  if (nextIndex === -1) {
    // End of playlist
    isPlaying = false;
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    updatePlaylistSelectorState();
    return;
  }
  
  currentTrackIndex = nextIndex;
  loadCurrentTrack();
}

// Shuffle queue management
function generateShuffledQueue() {
  if (!currentPlaylist || !currentPlaylist.tracks) return;
  
  // Create array of indices
  shuffledQueue = Array.from({length: currentPlaylist.tracks.length}, (_, i) => i);
  
  // Fisher-Yates shuffle algorithm
  for (let i = shuffledQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledQueue[i], shuffledQueue[j]] = [shuffledQueue[j], shuffledQueue[i]];
  }
  
  // Set shuffled index to current track position
  shuffledIndex = shuffledQueue.indexOf(currentTrackIndex);
  if (shuffledIndex === -1) shuffledIndex = 0;
}

function getNextTrackIndex() {
  if (!currentPlaylist || !currentPlaylist.tracks.length) return 0;
  
  if (repeatMode === 'one') {
    return currentTrackIndex;
  }
  
  if (isShuffled) {
    if (shuffledQueue.length === 0) {
      generateShuffledQueue();
    }
    
    const nextShuffledIndex = (shuffledIndex + 1) % shuffledQueue.length;
    
    if (nextShuffledIndex === 0 && repeatMode === 'off') {
      return -1; // End of playlist
    }
    
    return shuffledQueue[nextShuffledIndex];
  } else {
    const nextIndex = (currentTrackIndex + 1) % currentPlaylist.tracks.length;
    if (nextIndex === 0 && repeatMode === 'off') {
      return -1; // End of playlist
    }
    return nextIndex;
  }
}

function advanceToNextTrack() {
  if (!currentPlaylist || !currentPlaylist.tracks.length) return 0;
  
  if (repeatMode === 'one') {
    return currentTrackIndex;
  }
  
  if (isShuffled) {
    if (shuffledQueue.length === 0) {
      generateShuffledQueue();
    }
    
    shuffledIndex = (shuffledIndex + 1) % shuffledQueue.length;
    
    if (shuffledIndex === 0 && repeatMode === 'off') {
      return -1; // End of playlist
    }
    
    // If we've looped back to start, regenerate queue for variety
    if (shuffledIndex === 0 && repeatMode === 'all') {
      generateShuffledQueue();
      shuffledIndex = 0;
    }
    
    return shuffledQueue[shuffledIndex];
  } else {
    const nextIndex = (currentTrackIndex + 1) % currentPlaylist.tracks.length;
    if (nextIndex === 0 && repeatMode === 'off') {
      return -1; // End of playlist
    }
    return nextIndex;
  }
}

function getPreviousTrackIndex() {
  if (!currentPlaylist || !currentPlaylist.tracks.length) return 0;
  
  if (isShuffled) {
    if (shuffledQueue.length === 0) {
      generateShuffledQueue();
    }
    
    shuffledIndex = shuffledIndex === 0 ? shuffledQueue.length - 1 : shuffledIndex - 1;
    return shuffledQueue[shuffledIndex];
  } else {
    return currentTrackIndex === 0 ? currentPlaylist.tracks.length - 1 : currentTrackIndex - 1;
  }
}

function toggleShuffle() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot change shuffle mode while Safe Mode is enabled', 'warning');
    return;
  }
  
  isShuffled = !isShuffled;
  
  // Update button appearance and icon based on shuffle state
  const icon = shuffleBtn.querySelector('i');
  
  if (isShuffled) {
    shuffleBtn.classList.add('active');
    icon.className = 'fas fa-random';
    shuffleBtn.title = 'Shuffle: On';
    shuffleBtn.style.opacity = '1';
    // Generate new shuffled queue when enabling shuffle
    generateShuffledQueue();
  } else {
    shuffleBtn.classList.remove('active');
    icon.className = 'fas fa-sort-numeric-down';
    shuffleBtn.title = 'Shuffle: Off (Sequential)';
    shuffleBtn.style.opacity = '0.6';
  }
  
  savePlayerState();
}

function toggleRepeat() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot change repeat mode while Safe Mode is enabled', 'warning');
    return;
  }
  
  const modes = ['off', 'all', 'one'];
  const currentIndex = modes.indexOf(repeatMode);
  repeatMode = modes[(currentIndex + 1) % modes.length];
  
  // Update button appearance and icon based on repeat mode
  const icon = repeatBtn.querySelector('i');
  
  if (repeatMode === 'off') {
    repeatBtn.classList.remove('active');
    icon.className = 'fas fa-redo';
    repeatBtn.title = 'Repeat: Off';
    repeatBtn.style.opacity = '0.5';
  } else if (repeatMode === 'all') {
    repeatBtn.classList.add('active');
    icon.className = 'fas fa-redo';
    repeatBtn.title = 'Repeat: All Songs';
    repeatBtn.style.opacity = '1';
  } else if (repeatMode === 'one') {
    repeatBtn.classList.add('active');
    icon.className = 'fas fa-sync-alt';
    repeatBtn.title = 'Repeat: Current Song';
    repeatBtn.style.opacity = '1';
  }
  
  savePlayerState();
}

function toggleCrossfade() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    // Revert the checkbox state since we're blocking the change
    crossfadeBtn.checked = crossfadeEnabled;
    showNotification('Cannot change crossfade settings while Safe Mode is enabled', 'warning');
    return;
  }
  
  crossfadeEnabled = crossfadeBtn.checked;
  
  if (crossfadeEnabled) {
    showNotification('Crossfade enabled', 'success');
  } else {
    showNotification('Crossfade disabled', 'info');
    
    // Cancel any active crossfade
    if (isCrossfading) {
      cancelCrossfade();
    }
  }
  
  savePlayerState();
}

function updateVolume(value) {
  // If value is passed from slider callback, use it; otherwise get from slider
  const volumeValue = value !== undefined ? value : getSliderValue('volumeSliderBar');
  volume = volumeValue / 100;
  
  // Auto-manage mute state based on volume changes (only if not in a mute operation)
  if (!isInMuteOperation) {
    if (volume === 0 && !isMuted) {
      // User set volume to 0% - auto-mute
      isMuted = true;
      console.log('Auto-muting: volume set to 0%');
    } else if (volume > 0 && isMuted) {
      // User changed volume while muted - auto-unmute
      isMuted = false;
      console.log('Auto-unmuting: volume changed to', Math.round(volume * 100) + '%');
    }
  }
  
  // Store as previousVolume if not muted and volume > 0 and not in a mute operation
  if (!isMuted && volume > 0 && !isInMuteOperation) {
    previousVolume = volume;
    console.log('updateVolume - storing previousVolume:', previousVolume);
  }
  
  // Update volume for both players, respecting crossfade levels
  if (!isCrossfading) {
    // Normal playback - only active player should have volume
    if (activePlayer === 1) {
      gainNode.gain.value = volume;
      gainNode2.gain.value = 0;
    } else {
      gainNode.gain.value = 0;
      gainNode2.gain.value = volume;
    }
  }
  // During crossfade, don't override the gain values - let crossfade logic handle it
  
  volumeDisplay.textContent = `${Math.round(volume * 100)}%`;
  
  // Update volume icon based on volume level
  const icon = muteBtn.querySelector('i');
  const volumePercent = Math.round(volume * 100);
  
  if (volume === 0) {
    icon.className = 'fas fa-volume-mute';
    muteBtn.title = 'Unmute (0%)';
  } else if (volume < 0.33) {
    icon.className = 'fas fa-volume-off';
    muteBtn.title = `Volume: ${volumePercent}% (Very Low)`;
  } else if (volume < 0.66) {
    icon.className = 'fas fa-volume-down';
    muteBtn.title = `Volume: ${volumePercent}% (Low)`;
  } else {
    icon.className = 'fas fa-volume-up';
    muteBtn.title = `Volume: ${volumePercent}% (High)`;
    // For very high volumes, we could use a different visual cue
    if (volume > 0.9) {
      muteBtn.title = `Volume: ${volumePercent}% (Very High)`;
    }
  }
  
  // Update fade button states when volume changes
  if (!isInMuteOperation) {
    updateFadeButtonStates();
  }
  
  savePlayerState();
}

function toggleMute() {
  console.log('toggleMute called, isMuted:', isMuted, 'volume:', volume, 'previousVolume:', previousVolume);
  isInMuteOperation = true; // Prevent updateVolume from interfering
  
  if (isMuted) {
    // When unmuting, use previousVolume or fallback to 100% if previousVolume is 0
    volume = previousVolume > 0 ? previousVolume : 1.0; // 1.0 = 100%
    setSliderValue('volumeSliderBar', volume * 100);
    isMuted = false;
    console.log('Unmuting - restored volume to:', volume, '(previousVolume was:', previousVolume, ')');
  } else {
    previousVolume = volume;
    volume = 0;
    setSliderValue('volumeSliderBar', 0);
    isMuted = true;
    console.log('Muting - stored volume:', previousVolume);
  }
  
  updateVolume();
  isInMuteOperation = false; // Reset flag
  updateFadeButtonStates(); // Update fade button availability
}

function updateFadeButtonStates() {
  const currentVolume = getSliderValue('volumeSliderBar');
  
  // If a fade is in progress, keep both buttons disabled
  if (fadeInProgress) {
    return; // Don't change button states during fade operation
  }
  
  if (currentVolume === 0) {
    // Volume is at 0 (muted) - disable fade out, enable fade in
    fadeOutBtn.disabled = true;
    fadeInBtn.disabled = false;
  } else {
    // Volume is above 0 (not muted) - enable fade out, disable fade in
    fadeOutBtn.disabled = false;
    fadeInBtn.disabled = true;
  }
}

function changeVolume(delta) {
  const currentVolume = getSliderValue('volumeSliderBar');
  const newVolume = Math.max(0, Math.min(100, currentVolume + delta));
  setSliderValue('volumeSliderBar', newVolume);
  updateVolume(newVolume);
}

// Fade functions
let fadeInterval = null;
let fadeInProgress = false; // Prevent multiple fade operations
let fadeOutDuration = 3; // 3 seconds default
let fadeInDuration = 3; // 3 seconds default

function startFadeOut() {
  // Prevent multiple fade operations
  if (fadeInProgress) {
    return;
  }
  
  if (fadeInterval) {
    clearInterval(fadeInterval);
  }
  
  const startVolume = getSliderValue('volumeSliderBar');
  if (startVolume === 0) return; // Already at 0%
  
  // Set fade in progress flag
  fadeInProgress = true;
  
  // Store the current volume as previousVolume before fading out
  previousVolume = startVolume / 100; // Convert percentage to decimal
  console.log('Fade out started - storing previousVolume:', previousVolume, 'from startVolume:', startVolume);
  
  isInMuteOperation = true; // Prevent interference during fade
  const startTime = Date.now();
  fadeOutBtn.classList.add('active');
  fadeInBtn.disabled = true;
  fadeOutBtn.disabled = true; // Disable the button during fade
  
  fadeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / (fadeOutDuration * 1000);
    
    if (progress >= 1) {
      // Fade complete
      setSliderValue('volumeSliderBar', 0);
      updateVolume(0);
      clearInterval(fadeInterval);
      fadeInterval = null;
      fadeOutBtn.classList.remove('active');
      fadeInBtn.disabled = false;
      fadeOutBtn.disabled = false; // Re-enable the button
      isInMuteOperation = false; // Reset flag when fade completes
      fadeInProgress = false; // Clear fade in progress flag
      updateFadeButtonStates(); // Update button states after fade
    } else {
      // Calculate current volume
      const currentVolume = startVolume * (1 - progress);
      setSliderValue('volumeSliderBar', currentVolume);
      updateVolume(currentVolume);
    }
  }, 50); // Update every 50ms for smooth animation
}

function startFadeIn() {
  // Prevent multiple fade operations
  if (fadeInProgress) {
    return;
  }
  
  if (fadeInterval) {
    clearInterval(fadeInterval);
  }
  
  const startVolume = getSliderValue('volumeSliderBar');
  // Use previousVolume or fallback to 100% if previousVolume is 0
  const targetVolumeDecimal = previousVolume > 0 ? previousVolume : 1.0;
  const targetVolume = targetVolumeDecimal * 100; // Convert decimal to percentage
  
  console.log('Fade in started - previousVolume:', previousVolume, 'targetVolume:', targetVolume, 'startVolume:', startVolume);
  
  if (startVolume >= targetVolume) return; // Already at or above target volume
  
  // Set fade in progress flag
  fadeInProgress = true;
  
  isInMuteOperation = true; // Prevent interference during fade
  const startTime = Date.now();
  fadeInBtn.classList.add('active');
  fadeOutBtn.disabled = true;
  fadeInBtn.disabled = true; // Disable the button during fade
  
  fadeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / (fadeInDuration * 1000);
    
    if (progress >= 1) {
      // Fade complete
      setSliderValue('volumeSliderBar', targetVolume);
      updateVolume(targetVolume);
      clearInterval(fadeInterval);
      fadeInterval = null;
      fadeInBtn.classList.remove('active');
      fadeOutBtn.disabled = false;
      fadeInBtn.disabled = false; // Re-enable the button
      isInMuteOperation = false; // Reset flag when fade completes
      fadeInProgress = false; // Clear fade in progress flag
      updateFadeButtonStates(); // Update button states after fade
    } else {
      // Calculate current volume
      const currentVolume = startVolume + (targetVolume - startVolume) * progress;
      setSliderValue('volumeSliderBar', currentVolume);
      updateVolume(currentVolume);
    }
  }, 50); // Update every 50ms for smooth animation
}

// Progress bar functions
function seekToPosition(e) {
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  if (!activeAudio.duration) return;
  
  // Cancel any crossfade when manually seeking
  if (isCrossfading) {
    cancelCrossfade();
  }
  
  const rect = progressBar.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  const newTime = percent * activeAudio.duration;
  
  activeAudio.currentTime = newTime;
}

function startProgressDrag(e) {
  e.preventDefault();
  
  // Cancel crossfade during drag
  if (isCrossfading) {
    cancelCrossfade();
  }
  
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  
  const onMouseMove = (e) => {
    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    
    if (activeAudio.duration) {
      activeAudio.currentTime = percent * activeAudio.duration;
    }
  };
  
  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
  
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function updateProgress() {
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  if (!activeAudio.duration) return;
  
  const percent = (activeAudio.currentTime / activeAudio.duration) * 100;
  progressFill.style.width = `${percent}%`;
  progressHandle.style.left = `${percent}%`;
  
  currentTimeEl.textContent = formatTime(activeAudio.currentTime);
  totalTimeEl.textContent = formatTime(activeAudio.duration);
  
  // Check if we need to start crossfading
  if (crossfadeEnabled && !isCrossfading && activeAudio.duration > 0) {
    const timeRemaining = activeAudio.duration - activeAudio.currentTime;
    if (timeRemaining <= crossfadeDuration && timeRemaining > 0) {
      startCrossfade();
    }
  }
}

function seekRelative(seconds) {
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  if (!activeAudio.duration) return;
  activeAudio.currentTime = Math.max(0, Math.min(activeAudio.duration, activeAudio.currentTime + seconds));
}

// Track loading and management
function loadCurrentTrack() {
  if (!currentPlaylist || !currentPlaylist.tracks[currentTrackIndex]) return;
  
  const track = currentPlaylist.tracks[currentTrackIndex];
  
  // Check if track file exists before attempting to load
  if (!fs.existsSync(track.path)) {
    console.warn(`Track file not found: ${track.path}`);
    showNotification(`Track not found: ${track.title || path.basename(track.path)}`, 'warning');
    
    // Skip to next track
    playNext();
    return;
  }
  
  console.log(`Loading track: "${track.title || path.basename(track.path, path.extname(track.path))}" (index ${currentTrackIndex})`);
  
  trackTitle.textContent = track.title || path.basename(track.path, path.extname(track.path));
  
  // Show "Playing Next" with next track info instead of current track artist
  const nextTrackIndex = getNextTrackIndex();
  if (nextTrackIndex !== -1 && nextTrackIndex !== currentTrackIndex) {
    const nextTrack = currentPlaylist.tracks[nextTrackIndex];
    const nextTrackTitle = nextTrack.title || path.basename(nextTrack.path, path.extname(nextTrack.path));
    trackArtist.textContent = `Playing Next: ${nextTrackTitle}`;
  } else {
    trackArtist.textContent = 'Playing Next: End of playlist';
  }
  
  trackAlbum.textContent = track.album || '';
  
  // Load track into the currently active player
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  const inactiveAudio = activePlayer === 1 ? audioPlayer2 : audioPlayer;
  const inactiveGain = activePlayer === 1 ? gainNode2 : gainNode;
  
  activeAudio.src = `file://${track.path}`;
  
  // Reset inactive player
  inactiveAudio.pause();
  inactiveGain.gain.setValueAtTime(0, audioContext.currentTime);
  
  updateTrackListDisplay();
  updateTrayInfo();
  savePlayerState();
  
  if (isPlaying) {
    activeAudio.play().catch(error => {
      console.error('Failed to play track:', error);
      showNotification('Failed to play track, skipping...', 'warning');
      playNext(); // Skip to next track on error
    });
  }
}

function onTrackLoaded() {
  totalTimeEl.textContent = formatTime(audioPlayer.duration);
}

function onTrackEnded() {
  // If crossfading is enabled and this was the primary track,
  // the crossfade should have already started
  if (!isCrossfading) {
    playNext();
  }
  // If crossfading, the finishCrossfade function handles the transition
}

function onAudioError(e) {
  console.error('Audio error:', e);
  showNotification('Failed to play audio file', 'error');
  playNext();
}

// Second player event handlers
function onTrack2Loaded() {
  console.log('Track 2 loaded and ready for crossfade');
}

function onTrack2Ended() {
  // Handle when the second track ends during crossfade
  if (isCrossfading) {
    finishCrossfade();
  }
}

// Playlist selector management
function updatePlaylistSelectorState() {
  const playlistItems = document.querySelectorAll('.playlist-item');
  const addPlaylistBtn = document.getElementById('addPlaylistBtn');
  
  playlistItems.forEach(item => {
    if (isPlaying) {
      // Disable playlist selection when playing
      item.classList.add('disabled');
      item.style.pointerEvents = 'none';
      item.style.opacity = '0.5';
      item.title = 'Cannot change playlists while music is playing';
    } else {
      // Enable playlist selection when paused
      item.classList.remove('disabled');
      item.style.pointerEvents = 'auto';
      item.style.opacity = '1';
      item.title = '';
    }
  });
  
  // Disable/enable the Add Playlist button
  if (addPlaylistBtn) {
    if (isPlaying) {
      addPlaylistBtn.disabled = true;
      addPlaylistBtn.style.opacity = '0.5';
      addPlaylistBtn.style.cursor = 'not-allowed';
      addPlaylistBtn.title = 'Cannot create playlists while music is playing';
    } else {
      addPlaylistBtn.disabled = false;
      addPlaylistBtn.style.opacity = '1';
      addPlaylistBtn.style.cursor = 'pointer';
      addPlaylistBtn.title = 'Add Playlist';
    }
  }
}

function onAudio2Error(e) {
  console.error('Audio 2 error:', e);
  // If crossfade track fails, skip it
  if (isCrossfading) {
    cancelCrossfade();
  }
}

// Crossfade system
function startCrossfade() {
  if (!currentPlaylist || currentPlaylist.tracks.length <= 1 || isCrossfading) return;
  
  // Calculate and advance to next track index
  const nextTrackIndex = advanceToNextTrack();
  if (nextTrackIndex === -1) {
    return; // Don't crossfade at end of playlist in no-repeat mode
  }
  
  const nextTrack = currentPlaylist.tracks[nextTrackIndex];
  if (!nextTrack) return;
  
  console.log(`Starting crossfade from track ${currentTrackIndex} to ${nextTrackIndex} (shuffled: ${isShuffled}, shuffleIndex: ${shuffledIndex})`);
  
  isCrossfading = true;
  const inactivePlayer = activePlayer === 1 ? audioPlayer2 : audioPlayer;
  const inactiveGain = activePlayer === 1 ? gainNode2 : gainNode;
  
  // Load next track in inactive player
  inactivePlayer.src = `file://${nextTrack.path}`;
  inactivePlayer.currentTime = 0;
  
  // Start playing the next track
  inactivePlayer.play().then(() => {
    // Begin the crossfade
    performCrossfade(nextTrackIndex);
  }).catch(error => {
    console.error('Failed to start crossfade track:', error);
    cancelCrossfade();
  });
}

function performCrossfade(nextTrackIndex) {
  const activeAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  const inactiveAudio = activePlayer === 1 ? audioPlayer2 : audioPlayer;
  const activeGain = activePlayer === 1 ? gainNode : gainNode2;
  const inactiveGain = activePlayer === 1 ? gainNode2 : gainNode;
  
  console.log('Starting crossfade - Active player:', activePlayer, 'Current volume:', volume);
  
  const startTime = performance.now();
  const fadeSteps = 60; // 60 steps for smooth fade
  const stepDuration = (crossfadeDuration * 1000) / fadeSteps;
  
  let currentStep = 0;
  
  const fadeInterval = setInterval(() => {
    currentStep++;
    const progress = currentStep / fadeSteps;
    
    // Smooth crossfade curve (equal power)
    const outGain = Math.cos(progress * Math.PI / 2) * volume;
    const inGain = Math.sin(progress * Math.PI / 2) * volume;
    
    console.log(`Crossfade step ${currentStep}/${fadeSteps}: progress=${progress.toFixed(2)}, outGain=${outGain.toFixed(3)}, inGain=${inGain.toFixed(3)}`);
    
    // Apply gains using linearRampToValueAtTime for smoother transitions
    const now = audioContext.currentTime;
    const rampTime = stepDuration / 1000; // Convert to seconds
    
    activeGain.gain.linearRampToValueAtTime(outGain, now + rampTime);
    inactiveGain.gain.linearRampToValueAtTime(inGain, now + rampTime);
    
    if (currentStep >= fadeSteps) {
      clearInterval(fadeInterval);
      finishCrossfade(nextTrackIndex);
    }
  }, stepDuration);
  
  crossfadeTimer = fadeInterval;
}

function finishCrossfade(nextTrackIndex) {
  console.log('Finishing crossfade');
  
  // Stop the old track
  const oldAudio = activePlayer === 1 ? audioPlayer : audioPlayer2;
  const oldGain = activePlayer === 1 ? gainNode : gainNode2;
  
  oldAudio.pause();
  oldGain.gain.setValueAtTime(0, audioContext.currentTime);
  
  // Switch active player
  activePlayer = activePlayer === 1 ? 2 : 1;
  const newGain = activePlayer === 1 ? gainNode : gainNode2;
  newGain.gain.setValueAtTime(volume, audioContext.currentTime);
  
  // Update track info and set current track
  if (nextTrackIndex !== undefined) {
    currentTrackIndex = nextTrackIndex;
    const track = currentPlaylist.tracks[currentTrackIndex];
    
    console.log(`Crossfade completed: Now playing "${track.title || path.basename(track.path, path.extname(track.path))}" (index ${currentTrackIndex})`);
    
    trackTitle.textContent = track.title || path.basename(track.path, path.extname(track.path));
    
    // Show "Playing Next" with next track info
    const upcomingTrackIndex = getNextTrackIndex();
    if (upcomingTrackIndex !== -1 && upcomingTrackIndex !== currentTrackIndex) {
      const upcomingTrack = currentPlaylist.tracks[upcomingTrackIndex];
      const upcomingTrackTitle = upcomingTrack.title || path.basename(upcomingTrack.path, path.extname(upcomingTrack.path));
      trackArtist.textContent = `Playing Next: ${upcomingTrackTitle}`;
    } else {
      trackArtist.textContent = 'Playing Next: End of playlist';
    }
    
    trackAlbum.textContent = track.album || '';
    
    updateTrackListDisplay();
    updateTrayInfo();
    savePlayerState();
  }
  
  // Reset crossfade state
  isCrossfading = false;
  preloadedNextTrack = false;
  
  if (crossfadeTimer) {
    clearInterval(crossfadeTimer);
    crossfadeTimer = null;
  }
}

function cancelCrossfade() {
  console.log('Cancelling crossfade');
  
  if (crossfadeTimer) {
    clearInterval(crossfadeTimer);
    crossfadeTimer = null;
  }
  
  // Reset gains
  const activeGain = activePlayer === 1 ? gainNode : gainNode2;
  const inactiveGain = activePlayer === 1 ? gainNode2 : gainNode;
  const inactiveAudio = activePlayer === 1 ? audioPlayer2 : audioPlayer;
  
  activeGain.gain.setValueAtTime(volume, audioContext.currentTime);
  inactiveGain.gain.setValueAtTime(0, audioContext.currentTime);
  
  // Stop inactive player
  inactiveAudio.pause();
  
  isCrossfading = false;
  preloadedNextTrack = false;
}

// Playlist management
async function loadPlaylists() {
  try {
    const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    displayPlaylists(playlists);
  } catch (error) {
    console.error('Failed to load playlists:', error);
  }
}

async function savePlaylists() {
  try {
    // Get existing playlists from storage first to preserve descriptions
    const existingPlaylists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    
    const updatedPlaylists = Array.from(playlistList.children).map(item => {
      const playlistId = item.dataset.id;
      const playlistName = item.querySelector('.playlist-name').textContent;
      
      // Find existing playlist data
      const existingPlaylist = existingPlaylists.find(p => p.id === playlistId) || {};
      
      // If this is the currently selected playlist, use the currentPlaylist object
      // which has the most up-to-date data
      if (currentPlaylist && currentPlaylist.id === playlistId) {
        console.log(`Using currentPlaylist data for ${playlistId}:`, currentPlaylist.tracks?.length || 0, 'tracks');
        return {
          id: playlistId,
          name: playlistName,
          description: currentPlaylist.description || '',
          tracks: currentPlaylist.tracks || []
        };
      } else {
        // For other playlists, preserve existing description and get tracks from DOM
        const tracks = JSON.parse(item.dataset.tracks || '[]');
        console.log(`Using stored data for ${playlistId}:`, tracks.length, 'tracks');
        return {
          id: playlistId,
          name: playlistName,
          description: existingPlaylist.description || '',
          tracks: tracks
        };
      }
    });
    
    console.log('Saving playlists:', updatedPlaylists);
    await ipcRenderer.invoke('store-set', 'playlists', updatedPlaylists);
    console.log('Playlists saved successfully');
  } catch (error) {
    console.error('Failed to save playlists:', error);
  }
}

function displayPlaylists(playlists) {
  playlistList.innerHTML = '';
  
  playlists.forEach(playlist => {
    const playlistElement = createPlaylistElement(playlist);
    playlistList.appendChild(playlistElement);
  });
  
  // Apply safe mode restrictions to new playlist elements
  if (safeModeEnabled) {
    applySafeModeRestrictions();
  }
  
  // Update playlist selector state based on current playing status
  updatePlaylistSelectorState();
}

function createPlaylistElement(playlist) {
  const element = document.createElement('div');
  element.className = 'playlist-item';
  element.dataset.id = playlist.id;
  element.dataset.tracks = JSON.stringify(playlist.tracks || []);
  
  element.innerHTML = `
    <div class="playlist-info">
      <div class="playlist-name">${playlist.name}</div>
      <div class="playlist-count">${playlist.tracks?.length || 0} tracks</div>
    </div>
    <div class="playlist-actions">
      <button class="btn-icon" onclick="editPlaylist('${playlist.id}')" title="Edit">
        <i class="fas fa-edit"></i>
      </button>
    </div>
  `;
  
  element.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.playlist-actions')) {
      selectPlaylist(playlist);
    }
  });
  
  return element;
}

// Helper function to format playlist title with description
function formatPlaylistTitle(name, description) {
  if (description && description.trim()) {
    return `${name} <span style="color: #888; font-weight: normal;">- ${description}</span>`;
  }
  return name;
}

function selectPlaylist(playlist) {
  // Prevent playlist change while music is playing
  if (isPlaying) {
    showNotification('Cannot change playlists while music is playing. Pause first.', 'warning');
    return;
  }
  
  // Store the current playing state
  const wasPlaying = isPlaying;
  
  // Stop current playback before switching playlists
  if (isPlaying) {
    pause();
  }
  
  // Reset progress bar and time display
  currentTimeEl.textContent = '0:00';
  totalTimeEl.textContent = '0:00';
  setSliderValue('progressBarSlider', 0);
  
  // Get the most current playlist data from DOM or use the passed playlist
  const playlistElement = document.querySelector(`[data-id="${playlist.id}"]`);
  let currentTracks = playlist.tracks || [];
  
  // If the playlist element exists in DOM and has tracks data, use that (it's more current)
  if (playlistElement && playlistElement.dataset.tracks) {
    try {
      currentTracks = JSON.parse(playlistElement.dataset.tracks);
      console.log(`Using DOM data for playlist "${playlist.name}": ${currentTracks.length} tracks`);
    } catch (error) {
      console.warn('Failed to parse tracks from DOM, using original data');
      currentTracks = playlist.tracks || [];
    }
  }
  
  // Ensure we have a proper reference to the playlist with tracks array
  currentPlaylist = {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description || '',
    tracks: currentTracks
  };
  currentTrackIndex = 0;
  
  console.log(`Selected playlist "${playlist.name}" with ${currentPlaylist.tracks.length} tracks`);
  
  // Generate shuffled queue if shuffle is enabled
  if (isShuffled) {
    generateShuffledQueue();
  }
  
  // Update UI
  document.querySelectorAll('.playlist-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === playlist.id);
  });
  
  // Set playlist title with description if available
  currentPlaylistTitle.innerHTML = formatPlaylistTitle(playlist.name, currentPlaylist.description);
  
  displayTrackList(currentPlaylist.tracks);
  
  if (currentPlaylist.tracks && currentPlaylist.tracks.length > 0) {
    loadCurrentTrack();
    
    // If music was playing before switching, continue playing the new track
    if (wasPlaying) {
      play();
    }
  }
}

function displayTrackList(tracks) {
  if (tracks.length === 0) {
    trackList.innerHTML = `
      <div class="empty-playlist">
        <i class="fas fa-music"></i>
        <p>No tracks in playlist</p>
      </div>
    `;
    return;
  }
  
  trackList.innerHTML = '';
  tracks.forEach((track, index) => {
    const trackElement = createTrackElement(track, index);
    trackList.appendChild(trackElement);
  });
  
  // Apply safe mode restrictions to new track elements
  if (safeModeEnabled) {
    applySafeModeRestrictions();
  }
}

function createTrackElement(track, index) {
  const element = document.createElement('div');
  element.className = 'track-item';
  element.dataset.index = index;
  
  const title = track.title || path.basename(track.path, path.extname(track.path));
  const artist = track.artist || 'Unknown Artist';
  const duration = track.duration || '0:00';
  
  element.innerHTML = `
    <div class="track-number">${index + 1}</div>
    <div class="track-details">
      <div class="name">${title}</div>
      <div class="artist">${artist}</div>
    </div>
    <div class="track-duration">${duration}</div>
  `;
  
  element.addEventListener('dblclick', () => {
    currentTrackIndex = index;
    
    // Re-shuffle when clicking a track if shuffle is enabled
    if (isShuffled) {
      generateShuffledQueue();
      // Find the clicked track's position in the new shuffled queue
      shuffledIndex = shuffledQueue.indexOf(index);
      if (shuffledIndex === -1) shuffledIndex = 0;
    }
    
    loadCurrentTrack();
    if (!isPlaying) togglePlayPause();
  });
  
  element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTrackContextMenu(e, track, index);
  });
  
  return element;
}

function updateTrackListDisplay() {
  document.querySelectorAll('.track-item').forEach((item, index) => {
    item.classList.toggle('playing', index === currentTrackIndex);
  });
}

// Import music functionality
function handleImportMusic() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot import music while Safe Mode is enabled', 'warning');
    return;
  }
  
  // Check if we're in edit playlist mode
  const editModal = document.getElementById('editPlaylistModal');
  const isInEditMode = editModal && editModal.classList.contains('active');
  
  if (isInEditMode) {
    importMusicToEditingPlaylist();
  } else {
    importMusic();
  }
}

async function importMusic() {
  if (!currentPlaylist) {
    showNotification('Please select or create a playlist first', 'warning');
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('select-music-files');
    
    if (!result.canceled && result.filePaths.length > 0) {
      showNotification('Processing audio files...', 'info');
      const tracks = await Promise.all(result.filePaths.map(processAudioFile));
      const validTracks = tracks.filter(track => track);
      
      if (validTracks.length > 0) {
        addTracksToCurrentPlaylist(validTracks);
      } else {
        showNotification('No valid audio files found', 'warning');
      }
    }
  } catch (error) {
    console.error('Failed to import music:', error);
    showNotification('Failed to import music files', 'error');
  }
}

async function importMusicToEditingPlaylist() {
  try {
    const result = await ipcRenderer.invoke('select-music-files');
    
    if (!result.canceled && result.filePaths.length > 0) {
      const tracks = await Promise.all(result.filePaths.map(processAudioFile));
      const validTracks = tracks.filter(track => track);
      
      // Add tracks to the editing array
      editingTracks.push(...validTracks);
      
      // Refresh the tracks editor
      populateTracksEditor();
      
      showNotification(`Added ${validTracks.length} song${validTracks.length > 1 ? 's' : ''} to playlist`, 'success');
    }
  } catch (error) {
    console.error('Failed to import music:', error);
    showNotification('Failed to import music files', 'error');
  }
}

async function processAudioFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    
    const track = {
      path: filePath,
      title: fileName,
      artist: 'Unknown Artist',
      album: '',
      duration: '0:00',
      size: stats.size
    };
    
    // Get duration automatically
    return await getTrackDuration(track);
  } catch (error) {
    console.error(`Failed to process file ${filePath}:`, error);
    return null;
  }
}

function addTracksToCurrentPlaylist(tracks) {
  if (!currentPlaylist) {
    showNotification('Please select or create a playlist first', 'warning');
    return;
  }
  
  console.log(`Adding ${tracks.length} tracks to playlist "${currentPlaylist.name}"`);
  console.log('Tracks to add:', tracks);
  
  currentPlaylist.tracks = currentPlaylist.tracks || [];
  currentPlaylist.tracks.push(...tracks);
  
  console.log(`Playlist now has ${currentPlaylist.tracks.length} tracks`);
  
  // Update DOM immediately
  updatePlaylistInDOM();
  displayTrackList(currentPlaylist.tracks);
  
  // Save playlists
  savePlaylists();
  
  // Force another DOM update after a short delay to ensure it's applied
  setTimeout(() => {
    updatePlaylistInDOM();
    console.log('Forced DOM update completed');
  }, 100);
  
  showNotification(`Added ${tracks.length} track${tracks.length > 1 ? 's' : ''} to ${currentPlaylist.name}`, 'success');
}

function updatePlaylistInDOM() {
  console.log(`updatePlaylistInDOM called for playlist ${currentPlaylist?.id} with ${currentPlaylist?.tracks?.length || 0} tracks`);
  
  if (!currentPlaylist) {
    console.error('No currentPlaylist when trying to update DOM');
    return;
  }
  
  const playlistElement = document.querySelector(`[data-id="${currentPlaylist.id}"]`);
  if (playlistElement) {
    const tracksJson = JSON.stringify(currentPlaylist.tracks);
    console.log(`Setting dataset.tracks to:`, tracksJson.substring(0, 200) + (tracksJson.length > 200 ? '...' : ''));
    
    playlistElement.dataset.tracks = tracksJson;
    playlistElement.querySelector('.playlist-count').textContent = `${currentPlaylist.tracks.length} tracks`;
    
    // Verify the update
    const verifyData = playlistElement.dataset.tracks;
    const parsedTracks = JSON.parse(verifyData);
    console.log(`DOM update verification: element now has ${parsedTracks.length} tracks in dataset`);
  } else {
    console.error(`Could not find playlist element with ID ${currentPlaylist.id}`);
    console.log('Available playlist elements:', Array.from(document.querySelectorAll('.playlist-item')).map(el => el.dataset.id));
  }
}

// Modal functions
function showAddPlaylistModal() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot add playlists while Safe Mode is enabled', 'warning');
    return;
  }
  
  // Check if music is playing
  if (isPlaying) {
    showNotification('Cannot create playlists while music is playing. Pause first.', 'warning');
    return;
  }
  
  // Ensure input is enabled and ready for use
  playlistNameInput.disabled = false;
  playlistNameInput.readOnly = false;
  playlistNameInput.value = '';
  
  addPlaylistModal.classList.add('active');
  
  // Use setTimeout to ensure modal is fully shown before focusing
  setTimeout(() => {
    playlistNameInput.focus();
    playlistNameInput.select();
  }, 100);
  
  // Add Enter key support for quick submission
  const handleEnterKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createNewPlaylist();
      playlistNameInput.removeEventListener('keydown', handleEnterKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideAddPlaylistModal();
      playlistNameInput.removeEventListener('keydown', handleEnterKey);
    }
  };
  
  playlistNameInput.addEventListener('keydown', handleEnterKey);
}

function hideAddPlaylistModal() {
  addPlaylistModal.classList.remove('active');
  playlistNameInput.value = '';
  // Ensure input remains enabled for future use
  playlistNameInput.disabled = false;
  playlistNameInput.readOnly = false;
}

async function createNewPlaylist() {
  try {
    const name = playlistNameInput.value.trim();
    
    if (!name) {
      showNotification('Please enter a playlist name', 'warning');
      playlistNameInput.focus();
      return;
    }
    
    // Check if playlist name already exists
    const existingPlaylists = Array.from(playlistList.children);
    const nameExists = existingPlaylists.some(item => 
      item.querySelector('.playlist-name').textContent.toLowerCase() === name.toLowerCase()
    );
    
    if (nameExists) {
      showNotification('A playlist with this name already exists', 'warning');
      playlistNameInput.focus();
      playlistNameInput.select();
      return;
    }
    
    const playlist = {
      id: Date.now().toString(),
      name: name,
      tracks: []
    };
    
    const playlistElement = createPlaylistElement(playlist);
    playlistList.appendChild(playlistElement);
    
    await savePlaylists();
    hideAddPlaylistModal();
    
    showNotification(`Created playlist "${name}"`, 'success');
    
    // Auto-select the new playlist
    selectPlaylist(playlist);
    
  } catch (error) {
    console.error('Failed to create playlist:', error);
    showNotification('Failed to create playlist. Please try again.', 'error');
  }
}

function showEqualizerModal() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot access equalizer while Safe Mode is enabled', 'warning');
    return;
  }
  
  equalizerModal.classList.add('active');
}

function hideEqualizerModal() {
  equalizerModal.classList.remove('active');
}

// Playlist Editor Functions
function showEditPlaylistModal() {
  if (!currentPlaylist) {
    showNotification('Please select a playlist first', 'warning');
    return;
  }
  
  editingPlaylist = { ...currentPlaylist };
  editingTracks = [...(currentPlaylist.tracks || [])];
  
  // Populate form fields
  document.getElementById('editPlaylistName').value = editingPlaylist.name || '';
  document.getElementById('editPlaylistDescription').value = editingPlaylist.description || '';
  
  // Populate tracks editor
  populateTracksEditor();
  
  // Show modal
  document.getElementById('editPlaylistModal').classList.add('active');
}

function hideEditPlaylistModal() {
  document.getElementById('editPlaylistModal').classList.remove('active');
  editingPlaylist = null;
  editingTracks = [];
}

function populateTracksEditor() {
  const tracksEditor = document.getElementById('tracksEditor');
  if (!tracksEditor) {
    console.error('tracksEditor element not found');
    return;
  }
  
  tracksEditor.innerHTML = '';
  
  if (editingTracks.length === 0) {
    tracksEditor.innerHTML = '<div class="empty-playlist" style="padding: 20px; text-align: center; color: var(--text-muted);">No tracks added yet. Click "Add Songs" to get started.</div>';
    return;
  }
  
  editingTracks.forEach((track, index) => {
    const trackElement = createEditableTrackElement(track, index);
    tracksEditor.appendChild(trackElement);
  });
  
  // Setup drag and drop for reordering
  setupTrackReordering();
}

function createEditableTrackElement(track, index) {
  const element = document.createElement('div');
  element.className = 'editor-track-item';
  element.dataset.index = index;
  element.draggable = true;
  
  const title = track.title || path.basename(track.path, path.extname(track.path));
  const artist = track.artist || 'Unknown Artist';
  
  element.innerHTML = `
    <div class="track-drag-handle">
      <i class="fas fa-grip-vertical"></i>
    </div>
    <div class="editor-track-details">
      <div class="editor-track-name">${title}</div>
      <div class="editor-track-artist">${artist}</div>
    </div>
    <button class="track-remove-btn" onclick="removeTrackFromEditor(${index})" title="Remove Track">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  return element;
}

function setupTrackReordering() {
  const tracksEditor = document.getElementById('tracksEditor');
  let draggedElement = null;
  
  tracksEditor.addEventListener('dragstart', (e) => {
    draggedElement = e.target;
    e.target.classList.add('dragging');
  });
  
  tracksEditor.addEventListener('dragend', (e) => {
    e.target.classList.remove('dragging');
    draggedElement = null;
  });
  
  tracksEditor.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(tracksEditor, e.clientY);
    if (afterElement == null) {
      tracksEditor.appendChild(draggedElement);
    } else {
      tracksEditor.insertBefore(draggedElement, afterElement);
    }
  });
  
  tracksEditor.addEventListener('drop', (e) => {
    e.preventDefault();
    updateTracksOrder();
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.editor-track-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateTracksOrder() {
  const trackElements = document.querySelectorAll('.editor-track-item');
  const newOrder = [];
  
  trackElements.forEach((element) => {
    const originalIndex = parseInt(element.dataset.index);
    newOrder.push(editingTracks[originalIndex]);
  });
  
  editingTracks = newOrder;
  populateTracksEditor(); // Refresh to update indices
}

function removeTrackFromEditor(index) {
  editingTracks.splice(index, 1);
  populateTracksEditor();
}

async function savePlaylistChanges() {
  const name = document.getElementById('editPlaylistName').value.trim();
  const description = document.getElementById('editPlaylistDescription').value.trim();
  
  if (!name) {
    showNotification('Please enter a playlist name', 'error');
    return;
  }
  
  // Update the playlist
  currentPlaylist.name = name;
  currentPlaylist.description = description;
  currentPlaylist.tracks = [...editingTracks];
  
  // Update UI with description if available
  currentPlaylistTitle.innerHTML = formatPlaylistTitle(name, description);
  displayTrackList(currentPlaylist.tracks);
  
  // Update playlist in sidebar
  const playlistElement = document.querySelector(`[data-id="${currentPlaylist.id}"]`);
  if (playlistElement) {
    playlistElement.querySelector('.playlist-name').textContent = name;
    playlistElement.querySelector('.playlist-count').textContent = `${currentPlaylist.tracks.length} tracks`;
  }
  
  // Regenerate shuffled queue if shuffle is enabled
  if (isShuffled) {
    generateShuffledQueue();
  }
  
  // Save to storage
  await savePlaylists();
  
  hideEditPlaylistModal();
  showNotification('Playlist updated successfully', 'success');
}

function showDeleteConfirmation() {
  document.getElementById('confirmDeleteModal').classList.add('active');
}

function hideDeleteConfirmation() {
  document.getElementById('confirmDeleteModal').classList.remove('active');
}

async function deleteCurrentPlaylist() {
  if (!currentPlaylist) return;
  
  try {
    // Remove from storage
    const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    const updatedPlaylists = playlists.filter(p => p.id !== currentPlaylist.id);
    await ipcRenderer.invoke('store-set', 'playlists', updatedPlaylists);
    
    // Clear current playlist
    currentPlaylist = null;
    currentTrackIndex = 0;
    shuffledQueue = [];
    shuffledIndex = 0;
    
    // Update UI
    currentPlaylistTitle.textContent = 'Track List';
    displayTrackList([]);
    
    // Refresh playlist list
    await loadPlaylists();
    
    // Hide modals
    hideDeleteConfirmation();
    hideEditPlaylistModal();
    
    showNotification('Playlist deleted successfully', 'success');
  } catch (error) {
    console.error('Failed to delete playlist:', error);
    showNotification('Failed to delete playlist', 'error');
  }
}

function clearCurrentPlaylist() {
  if (!currentPlaylist) {
    showNotification('Please select a playlist first', 'warning');
    return;
  }
  
  if (confirm(`Are you sure you want to remove all tracks from "${currentPlaylist.name}"?`)) {
    currentPlaylist.tracks = [];
    displayTrackList([]);
    updatePlaylistInDOM();
    savePlaylists();
    showNotification('Playlist cleared', 'success');
    
    // Stop playback if playing from this playlist
    if (isPlaying) {
      audioPlayer.pause();
      isPlaying = false;
      playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
      updatePlaylistSelectorState();
    }
  }
}

// Equalizer functions
function setupEqualizerControls() {
  const eqSliders = document.querySelectorAll('.eq-slider');
  const eqPresetBtns = document.querySelectorAll('.eq-preset-btn');
  
  eqSliders.forEach(slider => {
    slider.addEventListener('input', updateEqualizerBand);
  });
  
  eqPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Check if safe mode is enabled
      if (safeModeEnabled) {
        showNotification('Cannot change equalizer presets while Safe Mode is enabled', 'warning');
        return;
      }
      
      applyEqualizerPreset(btn.dataset.preset);
      eqPresetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // Only add event listener if eqPreset element exists
  const eqPresetSelect = document.getElementById('eqPreset');
  if (eqPresetSelect) {
    eqPresetSelect.addEventListener('change', (e) => {
      // Check if safe mode is enabled
      if (safeModeEnabled) {
        // Revert the selection
        e.target.selectedIndex = e.target.selectedIndex === 0 ? 1 : 0;
        showNotification('Cannot change equalizer presets while Safe Mode is enabled', 'warning');
        return;
      }
      
      applyEqualizerPreset(e.target.value);
    });
  }
}

function updateEqualizerBand(frequency, gain) {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    return; // Silently ignore in safe mode since sliders should be disabled
  }
  
  if (equalizer[frequency]) {
    equalizer[frequency].gain.value = gain;
  }
  
  // Update the display value
  const slider = document.querySelector(`.eq-slider[data-frequency="${frequency}"]`);
  if (slider) {
    const valueElement = slider.parentElement.querySelector('.eq-value');
    if (valueElement) {
      valueElement.textContent = `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}dB`;
    }
  }
  
  // Update preset selection to "Custom" when manually adjusting
  const presetSelect = document.getElementById('eqPreset');
  if (presetSelect) {
    presetSelect.value = 'custom';
  }
  
  document.querySelectorAll('.eq-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === 'custom');
  });
  
  saveEqualizerSettings();
}

function applyEqualizerPreset(preset) {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    return; // Silently ignore in safe mode
  }
  
  const presets = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop: [-1, -0.5, 0, 2, 4, 4, 2, 0, -1],
    rock: [4, 3, 1, -1, -0.5, 0, 2, 4, 5],
    jazz: [2, 1, 0, 1, 3, 3, 2, 1, 0],
    classical: [3, 2, 0, 0, -1, -1, 0, 2, 3],
    'bass-boost': [6, 4, 2, 0, -1, -2, 0, 2, 3]
  };

  const values = presets[preset] || presets.flat;
  const frequencies = [60, 170, 350, 1000, 3000, 6000, 12000, 14000, 16000];  values.forEach((value, index) => {
    const frequency = frequencies[index];
    if (equalizer[frequency]) {
      equalizer[frequency].gain.value = value;
    }
    
    // Update slider visual position and value
    const sliderId = `eq-slider-${frequency}`;
    setSliderValue(sliderId, value, true); // true for vertical
    
    // Update display text
    const slider = document.querySelector(`.eq-slider[data-frequency="${frequency}"]`);
    if (slider) {
      const valueElement = slider.parentElement.querySelector('.eq-value');
      if (valueElement) {
        valueElement.textContent = `${value >= 0 ? '+' : ''}${value.toFixed(1)}dB`;
      }
    }
  });
  
  const eqPresetSelect = document.getElementById('eqPreset');
  if (eqPresetSelect) {
    eqPresetSelect.value = preset;
  }
  saveEqualizerSettings();
}

function resetEqualizer() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot reset equalizer while Safe Mode is enabled', 'warning');
    return;
  }
  
  applyEqualizerPreset('flat');
  
  document.querySelectorAll('.eq-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === 'flat');
  });
}

async function saveEqualizerSettings() {
  const settings = {};
  Object.keys(equalizer).forEach(freq => {
    settings[freq] = equalizer[freq].gain.value;
  });
  
  await ipcRenderer.invoke('store-set', 'equalizerSettings', settings);
}

async function loadEqualizerSettings() {
  try {
    const settings = await ipcRenderer.invoke('store-get', 'equalizerSettings');
    if (settings) {
      Object.keys(settings).forEach(freq => {
        if (equalizer[freq]) {
          equalizer[freq].gain.value = settings[freq];
        }
      });
    }
  } catch (error) {
    console.error('Failed to load equalizer settings:', error);
  }
}

// Drag and drop functionality
function setupDragAndDrop() {
  trackList.addEventListener('dragover', dragOverHandler);
  trackList.addEventListener('drop', dropHandler);
  trackList.addEventListener('dragenter', dragEnterHandler);
  trackList.addEventListener('dragleave', dragLeaveHandler);
}

function dragOverHandler(e) {
  // Check if we're in edit playlist mode
  const editModal = document.getElementById('editPlaylistModal');
  const isInEditMode = editModal && editModal.classList.contains('active');
  
  if (!isInEditMode) {
    return; // Don't allow drag over if not in edit mode
  }
  
  e.preventDefault();
  trackList.classList.add('drag-over');
}

function dragEnterHandler(e) {
  // Check if we're in edit playlist mode
  const editModal = document.getElementById('editPlaylistModal');
  const isInEditMode = editModal && editModal.classList.contains('active');
  
  if (!isInEditMode) {
    return; // Don't allow drag enter if not in edit mode
  }
  
  e.preventDefault();
  trackList.classList.add('drag-over');
}

function dragLeaveHandler(e) {
  if (!trackList.contains(e.relatedTarget)) {
    trackList.classList.remove('drag-over');
  }
}

async function dropHandler(e) {
  // Check if we're in edit playlist mode
  const editModal = document.getElementById('editPlaylistModal');
  const isInEditMode = editModal && editModal.classList.contains('active');
  
  if (!isInEditMode) {
    showNotification('Drag and drop is only available when editing a playlist', 'info');
    return;
  }
  
  e.preventDefault();
  trackList.classList.remove('drag-over');
  
  if (!editingPlaylist) {
    showNotification('Please select a playlist to edit first', 'warning');
    return;
  }
  
  const files = Array.from(e.dataTransfer.files);
  const audioFiles = files.filter(file => {
    const ext = path.extname(file.name).toLowerCase();
    return ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext);
  });
  
  if (audioFiles.length === 0) {
    showNotification('No supported audio files found', 'warning');
    return;
  }
  
  const tracks = await Promise.all(audioFiles.map(file => processAudioFile(file.path)));
  const validTracks = tracks.filter(track => track);
  
  // Add tracks to the editing array instead of current playlist
  editingTracks.push(...validTracks);
  
  // Refresh the tracks editor
  populateTracksEditor();
  
  showNotification(`Added ${validTracks.length} song${validTracks.length > 1 ? 's' : ''} to playlist`, 'success');
}

// State management
async function savePlayerState() {
  try {
    const state = {
      currentPlaylistId: currentPlaylist?.id,
      currentTrackIndex,
      volume,
      isShuffled,
      repeatMode,
      crossfadeEnabled,
      crossfadeDuration,
      fadeOutDuration,
      fadeInDuration
    };
    
    await ipcRenderer.invoke('store-set', 'playerState', state);
  } catch (error) {
    console.error('Failed to save player state:', error);
  }
}

// Track validation and duration detection
async function validateAllTracks() {
  try {
    const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    let totalMissing = 0;
    let totalUpdated = 0;
    let hasChanges = false;
    
    showNotification('Validating tracks and detecting durations...', 'info');
    
    for (const playlist of playlists) {
      if (!playlist.tracks || playlist.tracks.length === 0) continue;
      
      const validTracks = [];
      const missingTracks = [];
      
      for (let i = 0; i < playlist.tracks.length; i++) {
        const track = playlist.tracks[i];
        try {
          // Check if file exists
          const exists = fs.existsSync(track.path);
          
          if (exists) {
            // Get or update duration
            const updatedTrack = await getTrackDuration(track);
            if (updatedTrack.duration !== track.duration) {
              totalUpdated++;
              hasChanges = true;
            }
            validTracks.push(updatedTrack);
          } else {
            missingTracks.push({
              title: track.title || path.basename(track.path),
              path: track.path
            });
            totalMissing++;
            hasChanges = true;
          }
        } catch (error) {
          console.error(`Error validating track ${track.path}:`, error);
          missingTracks.push({
            title: track.title || path.basename(track.path),
            path: track.path
          });
          totalMissing++;
          hasChanges = true;
        }
      }
      
      // Update playlist with valid tracks
      playlist.tracks = validTracks;
    }
    
    // Save updated playlists if there were changes
    if (hasChanges) {
      await ipcRenderer.invoke('store-set', 'playlists', playlists);
      // Refresh playlist display
      await loadPlaylists();
    }
    
    // Show summary notification
    if (totalMissing > 0) {
      showNotification(`Warning: ${totalMissing} missing track(s) removed. ${totalUpdated} duration(s) updated.`, 'warning');
      console.warn(`Removed ${totalMissing} missing tracks from playlists`);
    } else if (totalUpdated > 0) {
      showNotification(`${totalUpdated} track duration(s) detected and updated.`, 'success');
    } else {
      showNotification('All tracks validated successfully.', 'success');
    }
    
  } catch (error) {
    console.error('Failed to validate tracks:', error);
    showNotification('Failed to validate tracks', 'error');
  }
}

async function getTrackDuration(track) {
  return new Promise((resolve) => {
    // If duration is already detected and valid, return it
    if (track.duration && track.duration !== '0:00' && track.duration !== 'Unknown') {
      resolve(track);
      return;
    }
    
    const audio = new Audio();
    let resolved = false;
    
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.src = '';
    };
    
    const resolveOnce = (updatedTrack) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(updatedTrack);
    };
    
    const onLoaded = () => {
      console.log(`Loaded metadata for: ${track.title}, duration: ${audio.duration}`);
      const updatedTrack = { ...track };
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        updatedTrack.duration = formatTime(audio.duration);
      } else {
        updatedTrack.duration = 'Unknown';
      }
      resolveOnce(updatedTrack);
    };
    
    const onCanPlay = () => {
      console.log(`Can play: ${track.title}, duration: ${audio.duration}`);
      if (!resolved) {
        onLoaded(); // Try to get duration from canplaythrough event
      }
    };
    
    const onError = (error) => {
      console.warn(`Could not load audio metadata for: ${track.path}`, error);
      resolveOnce({ ...track, duration: 'Unknown' });
    };
    
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('canplaythrough', onCanPlay);
    audio.addEventListener('error', onError);
    
    try {
      // Use the track path directly without file:// prefix
      audio.src = track.path;
      audio.preload = 'metadata';
      audio.load();
    } catch (error) {
      console.error(`Error loading audio file: ${track.path}`, error);
      resolveOnce({ ...track, duration: 'Unknown' });
    }
    
    // Timeout after 3 seconds (reduced from 5)
    setTimeout(() => {
      console.warn(`Timeout loading metadata for: ${track.path}`);
      resolveOnce({ ...track, duration: 'Unknown' });
    }, 3000);
  });
}

async function restoreLastSession() {
  try {
    const state = await ipcRenderer.invoke('store-get', 'playerState');
    if (!state) return;
    
    // Restore volume and controls
    if (typeof state.volume === 'number') {
      setSliderValue('volumeSliderBar', state.volume * 100);
      updateVolume();
    }
    
    if (state.isShuffled) {
      isShuffled = true;
      // Use the updated toggle function to set proper icon state
      const shuffleIcon = shuffleBtn.querySelector('i');
      shuffleBtn.classList.add('active');
      shuffleIcon.className = 'fas fa-random';
      shuffleBtn.title = 'Shuffle: On';
      shuffleBtn.style.opacity = '1';
    }
    
    if (state.repeatMode) {
      repeatMode = state.repeatMode;
      const modes = ['off', 'all', 'one'];
      if (modes.includes(repeatMode)) {
        // Use the updated repeat icon logic
        const repeatIcon = repeatBtn.querySelector('i');
        if (repeatMode === 'off') {
          repeatBtn.classList.remove('active');
          repeatIcon.className = 'fas fa-redo';
          repeatBtn.title = 'Repeat: Off';
          repeatBtn.style.opacity = '0.5';
        } else if (repeatMode === 'all') {
          repeatBtn.classList.add('active');
          repeatIcon.className = 'fas fa-redo';
          repeatBtn.title = 'Repeat: All Songs';
          repeatBtn.style.opacity = '1';
        } else if (repeatMode === 'one') {
          repeatBtn.classList.add('active');
          repeatIcon.className = 'fas fa-sync-alt';
          repeatBtn.title = 'Repeat: Current Song';
          repeatBtn.style.opacity = '1';
        }
      }
    }
    
    // Restore crossfade settings
    if (typeof state.crossfadeEnabled === 'boolean') {
      crossfadeEnabled = state.crossfadeEnabled;
      crossfadeBtn.checked = crossfadeEnabled;
    }
    
    if (typeof state.crossfadeDuration === 'number') {
      crossfadeDuration = state.crossfadeDuration;
      setSliderValue('crossfadeTimeSlider', crossfadeDuration);
      document.getElementById('crossfadeTimeValue').textContent = `${crossfadeDuration.toFixed(1)}s`;
    }
    
    // Restore fade durations
    if (typeof state.fadeOutDuration === 'number') {
      fadeOutDuration = state.fadeOutDuration;
      setSliderValue('fadeOutDurationSlider', fadeOutDuration);
      document.getElementById('fadeOutDurationValue').textContent = `${fadeOutDuration.toFixed(1)}s`;
    }
    
    if (typeof state.fadeInDuration === 'number') {
      fadeInDuration = state.fadeInDuration;
      setSliderValue('fadeInDurationSlider', fadeInDuration);
      document.getElementById('fadeInDurationValue').textContent = `${fadeInDuration.toFixed(1)}s`;
    }
    
    // Restore last playlist
    if (state.currentPlaylistId) {
      const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
      const lastPlaylist = playlists.find(p => p.id === state.currentPlaylistId);
      
      if (lastPlaylist) {
        selectPlaylist(lastPlaylist);
        if (typeof state.currentTrackIndex === 'number' && lastPlaylist.tracks[state.currentTrackIndex]) {
          currentTrackIndex = state.currentTrackIndex;
          loadCurrentTrack();
        }
      }
    }
    
    await loadEqualizerSettings();
  } catch (error) {
    console.error('Failed to restore session:', error);
  }
}

// Utility functions
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateTrayInfo() {
  if (currentPlaylist && currentPlaylist.tracks[currentTrackIndex]) {
    const track = currentPlaylist.tracks[currentTrackIndex];
    const title = track.title || path.basename(track.path, path.extname(track.path));
    const artist = track.artist || 'Unknown Artist';
    ipcRenderer.send('update-tray-tooltip', `${title} - ${artist}`);
  } else {
    ipcRenderer.send('update-tray-tooltip', null);
  }
}

// Notification system with stacking
let activeNotifications = [];

function showNotification(message, type = 'info') {
  // Create notification container
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  
  // Create icon element
  const iconElement = document.createElement('span');
  iconElement.className = 'notification-icon';
  
  // Create message element
  const messageElement = document.createElement('span');
  messageElement.className = 'notification-message';
  messageElement.textContent = message;
  
  // Assemble notification
  notification.appendChild(iconElement);
  notification.appendChild(messageElement);
  
  // Calculate position based on existing notifications with proper spacing
  const notificationHeight = 80; // Height of notification + margin for spacing
  const titleBarHeight = 31; // 30px title bar + 1px border
  const topMargin = 15; // Additional margin below title bar
  const startTop = titleBarHeight + topMargin; // Start below title bar with margin
  const topPosition = startTop + (activeNotifications.length * notificationHeight);
  
  // Enhanced notification styling for better readability
  Object.assign(notification.style, {
    position: 'fixed',
    top: `${topPosition}px`,
    right: '20px',
    padding: '16px 20px',
    borderRadius: '8px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '500',
    fontFamily: '"Poppins", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    lineHeight: '1.4',
    letterSpacing: '0.3px',
    boxShadow: '0 6px 24px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.15)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    backdropFilter: 'blur(10px)',
    zIndex: '9999',
    opacity: '0',
    transform: 'translateX(100%)',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    maxWidth: '350px',
    minWidth: '280px',
    minHeight: '60px', // Ensure consistent height
    wordWrap: 'break-word',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px' // Add spacing between notifications
  });
  
  // Enhanced color scheme with better contrast and readability
  const colors = {
    info: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    success: 'linear-gradient(135deg, #11993aff 0%, #38ef7d 100%)',
    warning: 'linear-gradient(135deg, #8a8b21ff 0%, #bea517ff 100%)',
    error: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)'
  };
  
  // Icon symbols for better visual identification
  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌'
  };
  
  notification.style.background = colors[type] || colors.info;
  iconElement.textContent = icons[type] || icons.info;
  
  // Style the icon
  Object.assign(iconElement.style, {
    fontSize: '18px',
    flexShrink: '0',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)'
  });
  
  // Style the message
  Object.assign(messageElement.style, {
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
    flex: '1'
  });
  
  
  document.body.appendChild(notification);
  
  // Add to active notifications array
  activeNotifications.push(notification);
  
  // Enhanced animation with better easing
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(0) scale(1)';
  }, 50);
  
  // Auto-dismiss with longer duration for better readability
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%) scale(0.95)';
    
    setTimeout(() => {
      notification.remove();
      // Remove from active notifications array
      const index = activeNotifications.indexOf(notification);
      if (index > -1) {
        activeNotifications.splice(index, 1);
        // Reposition remaining notifications
        repositionNotifications();
      }
    }, 400);
  }, 4000); // Increased duration for better readability
}

function repositionNotifications() {
  const notificationHeight = 80; // Updated to match new height with spacing
  const titleBarHeight = 31; // 30px title bar + 1px border
  const topMargin = 15; // Additional margin below title bar
  const startTop = titleBarHeight + topMargin;
  
  activeNotifications.forEach((notification, index) => {
    const newTop = startTop + (index * notificationHeight);
    notification.style.top = `${newTop}px`;
  });
}

// Settings Modal Functions
async function showSettingsModal() {
  // Initialize crossfade slider value
  document.getElementById('crossfadeTimeSlider').value = crossfadeDuration;
  document.getElementById('crossfadeTimeValue').textContent = `${crossfadeDuration.toFixed(1)}s`;
  
  // Populate default playlist dropdown
  await populateDefaultPlaylistDropdown();
  
  document.getElementById('settingsModal').classList.add('active');
}

async function populateDefaultPlaylistDropdown() {
  const select = document.getElementById('defaultPlaylistSelect');
  const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
  const defaultPlaylistId = await ipcRenderer.invoke('store-get', 'defaultPlaylistId');
  
  // Clear existing options except the first one
  select.innerHTML = '<option value="">None (Show empty)</option>';
  
  // Add playlists as options
  playlists.forEach(playlist => {
    const option = document.createElement('option');
    option.value = playlist.id;
    option.textContent = playlist.name;
    if (playlist.id === defaultPlaylistId) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function saveDefaultPlaylist() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    // This function shouldn't be called in safe mode since the dropdown is disabled,
    // but add protection just in case
    showNotification('Cannot change default playlist while Safe Mode is enabled', 'warning');
    return;
  }
  
  const select = document.getElementById('defaultPlaylistSelect');
  const defaultPlaylistId = select.value || null;
  
  await ipcRenderer.invoke('store-set', 'defaultPlaylistId', defaultPlaylistId);
  
  if (defaultPlaylistId) {
    const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    const defaultPlaylist = playlists.find(p => p.id === defaultPlaylistId);
    showNotification(`Default playlist set to "${defaultPlaylist?.name || 'Unknown'}"`, 'success');
  } else {
    showNotification('Default playlist cleared', 'info');
  }
}

// Load default playlist on startup
async function loadDefaultPlaylist() {
  try {
    const defaultPlaylistId = await ipcRenderer.invoke('store-get', 'defaultPlaylistId');
    if (defaultPlaylistId) {
      const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
      if (playlists.length > 0) {
        const defaultPlaylist = playlists.find(p => p.id === defaultPlaylistId);
        if (defaultPlaylist) {
          selectPlaylist(defaultPlaylist); // Pass the playlist object, not the ID
          console.log(`Loaded default playlist: ${defaultPlaylist.name}`);
        } else {
          console.log('Default playlist not found, clearing setting');
          await ipcRenderer.invoke('store-set', 'defaultPlaylistId', null);
        }
      }
    }
  } catch (error) {
    console.error('Error loading default playlist:', error);
  }
}

function hideSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}

// Safe Mode functionality
async function toggleSafeMode() {
  const checkbox = document.getElementById('safeModeCheckbox');
  safeModeEnabled = checkbox.checked;
  
  // Save to storage
  await ipcRenderer.invoke('store-set', 'safeModeEnabled', safeModeEnabled);
  
  // Apply safe mode restrictions
  applySafeModeRestrictions();
  
  // Show notification
  showNotification(
    safeModeEnabled ? 'Safe Mode enabled - Read-only mode active' : 'Safe Mode disabled - Full functionality restored',
    safeModeEnabled ? 'warning' : 'success'
  );
}

function applySafeModeRestrictions() {
  // Show/hide safe mode indicator
  const indicator = document.getElementById('safeModeIndicator');
  if (indicator) {
    indicator.style.display = safeModeEnabled ? 'inline-block' : 'none';
  }
  
  // Elements to disable in safe mode (everything except playback controls)
  const elementsToDisable = [
    // Playlist management
    'addPlaylistBtn',
    'importMusicBtn',
    
    // Main page controls that should be disabled
    'shuffleBtn',
    'repeatBtn',
    
    // Settings and modals (keep settings, about, and shortcuts buttons enabled but restrict content)
    'equalizerBtn',
    
    // Playlist editing buttons - these will be handled dynamically
    // Edit buttons are created dynamically, so we'll handle them separately
  ];
  
  const elementsToKeepEnabled = [
    // Core playback controls
    'playPauseBtn',
    'previousBtn', 
    'nextBtn',
    
    // Volume and fade controls
    'muteBtn',
    'fadeInBtn',
    'fadeOutBtn',
    
    // Progress bar (allow seeking)
    'progressBar',
    'progressHandle',
    
    // Volume slider
    'volumeSliderBar',
    'volumeSliderBarHandle',
    
    // Settings button (but content will be restricted)
    'settingsBtn',
    
    // Allow About and Shortcuts buttons
    'aboutBtn',
    'keyboardShortcutsBtn'
  ];
  
  // Disable/enable buttons based on safe mode
  elementsToDisable.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = safeModeEnabled;
      if (safeModeEnabled) {
        element.classList.add('safe-mode-disabled');
      } else {
        element.classList.remove('safe-mode-disabled');
      }
    }
  });
  
  // Disable playlist editing buttons
  document.querySelectorAll('.playlist-actions button').forEach(button => {
    button.disabled = safeModeEnabled;
    if (safeModeEnabled) {
      button.classList.add('safe-mode-disabled');
    } else {
      button.classList.remove('safe-mode-disabled');
    }
  });
  
  // Disable track editing/reordering in track list
  document.querySelectorAll('.track-actions button').forEach(button => {
    button.disabled = safeModeEnabled;
    if (safeModeEnabled) {
      button.classList.add('safe-mode-disabled');
    } else {
      button.classList.remove('safe-mode-disabled');
    }
  });
  
  // Disable drag and drop
  const playlistList = document.getElementById('playlistList');
  const trackList = document.getElementById('trackList');
  
  if (safeModeEnabled) {
    if (playlistList) playlistList.classList.add('safe-mode-no-drop');
    if (trackList) trackList.classList.add('safe-mode-no-drop');
  } else {
    if (playlistList) playlistList.classList.remove('safe-mode-no-drop');
    if (trackList) trackList.classList.remove('safe-mode-no-drop');
  }
  
  // Disable specific settings content (but not About/Shortcuts buttons)
  const settingsInputsToDisable = [
    // Fade duration controls
    '#fadeOutDurationSlider',
    '#fadeInDurationSlider',
    
    // Crossfade duration control  
    '#crossfadeTimeSlider',
    '#crossfadeCheckbox',
    
    // Default playlist setting
    '#defaultPlaylistSelect',
    
    // Data management buttons
    '#exportPlaylistsBtn',
    '#importPlaylistsBtn',
    '#clearSessionBtn'
  ];
  
  settingsInputsToDisable.forEach(selector => {
    const element = document.querySelector(selector);
    if (element) {
      element.disabled = safeModeEnabled;
      if (safeModeEnabled) {
        element.classList.add('safe-mode-disabled');
      } else {
        element.classList.remove('safe-mode-disabled');
      }
    }
  });
  
  // Also disable the slider handles and fills for fade/crossfade controls
  const sliderElements = [
    '#fadeOutDurationSliderHandle',
    '#fadeInDurationSliderHandle', 
    '#crossfadeTimeSliderHandle',
    '#fadeOutDurationSliderFill',
    '#fadeInDurationSliderFill',
    '#crossfadeTimeSliderFill'
  ];
  
  sliderElements.forEach(selector => {
    const element = document.querySelector(selector);
    if (element) {
      if (safeModeEnabled) {
        element.classList.add('safe-mode-disabled');
      } else {
        element.classList.remove('safe-mode-disabled');
      }
    }
  });
  
  // Disable equalizer controls
  document.querySelectorAll('.eq-slider').forEach(slider => {
    slider.disabled = safeModeEnabled;
    if (safeModeEnabled) {
      slider.classList.add('safe-mode-disabled');
    } else {
      slider.classList.remove('safe-mode-disabled');
    }
  });
  
  document.querySelectorAll('.eq-preset-btn').forEach(button => {
    button.disabled = safeModeEnabled;
    if (safeModeEnabled) {
      button.classList.add('safe-mode-disabled');
    } else {
      button.classList.remove('safe-mode-disabled');
    }
  });
  
  const eqPresetSelect = document.getElementById('eqPreset');
  if (eqPresetSelect) {
    eqPresetSelect.disabled = safeModeEnabled;
    if (safeModeEnabled) {
      eqPresetSelect.classList.add('safe-mode-disabled');
    } else {
      eqPresetSelect.classList.remove('safe-mode-disabled');
    }
  }
  
  const resetEqBtn = document.getElementById('resetEqBtn');
  if (resetEqBtn) {
    resetEqBtn.disabled = safeModeEnabled;
    if (safeModeEnabled) {
      resetEqBtn.classList.add('safe-mode-disabled');
    } else {
      resetEqBtn.classList.remove('safe-mode-disabled');
    }
  }
}

// Load safe mode state on startup
async function loadSafeModeState() {
  try {
    const savedSafeModeEnabled = await ipcRenderer.invoke('store-get', 'safeModeEnabled');
    
    if (savedSafeModeEnabled !== undefined) {
      safeModeEnabled = savedSafeModeEnabled;
      const checkbox = document.getElementById('safeModeCheckbox');
      if (checkbox) {
        checkbox.checked = safeModeEnabled;
      }
      applySafeModeRestrictions();
    }
  } catch (error) {
    console.error('Error loading safe mode state:', error);
  }
}

function updateCrossfadeTime(value) {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    return; // Silently ignore in safe mode since sliders are disabled
  }
  
  // If value is passed from slider callback, use it; otherwise get from slider
  const crossfadeValue = value !== undefined ? value : getSliderValue('crossfadeTimeSlider');
  
  crossfadeDuration = crossfadeValue;
  document.getElementById('crossfadeTimeValue').textContent = `${crossfadeValue.toFixed(1)}s`;
  
  savePlayerState();
}

function updateFadeOutDuration(value) {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    return; // Silently ignore in safe mode since sliders are disabled
  }
  
  const fadeOutValue = value !== undefined ? value : getSliderValue('fadeOutDurationSlider');
  
  fadeOutDuration = fadeOutValue;
  document.getElementById('fadeOutDurationValue').textContent = `${fadeOutValue.toFixed(1)}s`;
  
  savePlayerState();
}

function updateFadeInDuration(value) {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    return; // Silently ignore in safe mode since sliders are disabled
  }
  
  const fadeInValue = value !== undefined ? value : getSliderValue('fadeInDurationSlider');
  
  fadeInDuration = fadeInValue;
  document.getElementById('fadeInDurationValue').textContent = `${fadeInValue.toFixed(1)}s`;
  
  savePlayerState();
}

async function exportAllPlaylists() {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot export data while Safe Mode is enabled', 'warning');
    return;
  }
  
  try {
    const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    const playerState = await ipcRenderer.invoke('store-get', 'playerState') || {};
    const equalizerSettings = await ipcRenderer.invoke('store-get', 'equalizerSettings') || {};
    const defaultPlaylistId = await ipcRenderer.invoke('store-get', 'defaultPlaylistId');
    
    if (playlists.length === 0) {
      showNotification('No playlists to export', 'warning');
      return;
    }
    
    // Request save location
    const result = await ipcRenderer.invoke('save-file-dialog', {
      defaultPath: 'SimpleDJ_AllData.json',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePath) return;
    
    // Prepare export data with all settings
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      settings: {
        // Volume and mute settings
        volume: playerState.volume || volume || 0.7,
        
        // Crossfade settings  
        crossfadeEnabled: playerState.crossfadeEnabled !== undefined ? playerState.crossfadeEnabled : crossfadeEnabled,
        crossfadeDuration: playerState.crossfadeDuration || crossfadeDuration || 3,
        
        // Fade in/out durations
        fadeInDuration: playerState.fadeInDuration || fadeInDuration || 3,
        fadeOutDuration: playerState.fadeOutDuration || fadeOutDuration || 3,
        
        // Default playlist
        defaultPlaylistId: defaultPlaylistId || null,
        
        // Equalizer settings
        equalizerSettings: equalizerSettings
      },
      playlists: playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || '',
        tracks: playlist.tracks?.map(track => ({
          path: track.path,
          title: track.title
        })) || []
      }))
    };
    
    // Write file
    const fs = require('fs');
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
    
    showNotification(`Exported ${playlists.length} playlist${playlists.length > 1 ? 's' : ''} successfully`, 'success');
  } catch (error) {
    console.error('Export failed:', error);
    showNotification('Failed to export playlists', 'error');
  }
}

async function importPlaylists() {
  try {
    const result = await ipcRenderer.invoke('select-file-dialog', {
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
    
    const fs = require('fs');
    const importPath = result.filePaths[0];
    const importData = JSON.parse(fs.readFileSync(importPath, 'utf-8'));
    
    if (!importData.playlists || !Array.isArray(importData.playlists)) {
      showNotification('Invalid playlist file format', 'error');
      return;
    }
    
    // Get existing playlists
    const existingPlaylists = await ipcRenderer.invoke('store-get', 'playlists') || [];
    const existingNames = existingPlaylists.map(p => p.name.toLowerCase());
    
    let importedCount = 0;
    let skippedCount = 0;
    
    // Process imported playlists
    const newPlaylists = [];
    
    for (const playlist of importData.playlists) {
      let playlistName = playlist.name;
      let counter = 1;
      
      // Handle duplicate names
      while (existingNames.includes(playlistName.toLowerCase())) {
        playlistName = `${playlist.name} (${counter})`;
        counter++;
      }
      
      // Validate tracks exist and reconstruct missing fields
      const validTracks = [];
      for (const track of playlist.tracks || []) {
        try {
          if (fs.existsSync(track.path)) {
            // Reconstruct track object with default values for missing fields
            const reconstructedTrack = {
              path: track.path,
              title: track.title || path.basename(track.path, path.extname(track.path)),
              artist: 'Unknown Artist',
              album: '',
              duration: '0:00', // Will be detected later
              size: 0
            };
            
            // Try to get file size
            try {
              const stats = fs.statSync(track.path);
              reconstructedTrack.size = stats.size;
            } catch (error) {
              // Keep size as 0 if we can't get it
            }
            
            validTracks.push(reconstructedTrack);
          } else {
            skippedCount++;
          }
        } catch (error) {
          skippedCount++;
        }
      }
      
      if (validTracks.length > 0) {
        newPlaylists.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: playlistName,
          description: playlist.description || '',
          tracks: validTracks
        });
        existingNames.push(playlistName.toLowerCase());
        importedCount++;
      }
    }
    
    if (newPlaylists.length === 0) {
      showNotification('No valid playlists found to import', 'warning');
      return;
    }

    // Detect durations for imported tracks
    showNotification('Detecting track durations...', 'info');
    
    for (const playlist of newPlaylists) {
      for (let i = 0; i < playlist.tracks.length; i++) {
        const track = playlist.tracks[i];
        if (track.duration === '0:00') {
          try {
            const updatedTrack = await getTrackDuration(track);
            playlist.tracks[i] = updatedTrack;
          } catch (error) {
            console.error(`Failed to detect duration for ${track.path}:`, error);
          }
        }
      }
    }

    // Save imported playlists
    const allPlaylists = [...existingPlaylists, ...newPlaylists];
    await ipcRenderer.invoke('store-set', 'playlists', allPlaylists);

    // Import settings if available
    if (importData.settings) {
      // Volume setting
      if (typeof importData.settings.volume === 'number' && importData.settings.volume >= 0 && importData.settings.volume <= 1) {
        volume = importData.settings.volume;
        setSliderValue('volumeSliderBar', volume * 100);
        updateVolume();
        showNotification(`Volume set to ${Math.round(volume * 100)}%`, 'info');
      }
      
      // Crossfade enabled/disabled
      if (typeof importData.settings.crossfadeEnabled === 'boolean') {
        crossfadeEnabled = importData.settings.crossfadeEnabled;
        const crossfadeCheckbox = document.getElementById('crossfadeCheckbox');
        if (crossfadeCheckbox) {
          crossfadeCheckbox.checked = crossfadeEnabled;
        }
        showNotification(`Crossfade ${crossfadeEnabled ? 'enabled' : 'disabled'}`, 'info');
      }
      
      // Crossfade duration
      if (typeof importData.settings.crossfadeDuration === 'number' && importData.settings.crossfadeDuration > 0) {
        crossfadeDuration = importData.settings.crossfadeDuration;
        setSliderValue('crossfadeTimeSlider', crossfadeDuration);
        document.getElementById('crossfadeTimeValue').textContent = `${crossfadeDuration.toFixed(1)}s`;
        showNotification(`Crossfade duration set to ${crossfadeDuration.toFixed(1)}s`, 'info');
      }
      
      // Fade in duration
      if (typeof importData.settings.fadeInDuration === 'number' && importData.settings.fadeInDuration > 0) {
        fadeInDuration = importData.settings.fadeInDuration;
        setSliderValue('fadeInDurationSlider', fadeInDuration);
        document.getElementById('fadeInDurationValue').textContent = `${fadeInDuration.toFixed(1)}s`;
        showNotification(`Fade in duration set to ${fadeInDuration.toFixed(1)}s`, 'info');
      }
      
      // Fade out duration
      if (typeof importData.settings.fadeOutDuration === 'number' && importData.settings.fadeOutDuration > 0) {
        fadeOutDuration = importData.settings.fadeOutDuration;
        setSliderValue('fadeOutDurationSlider', fadeOutDuration);
        document.getElementById('fadeOutDurationValue').textContent = `${fadeOutDuration.toFixed(1)}s`;
        showNotification(`Fade out duration set to ${fadeOutDuration.toFixed(1)}s`, 'info');
      }
      
      // Equalizer settings
      if (importData.settings.equalizerSettings && typeof importData.settings.equalizerSettings === 'object') {
        await ipcRenderer.invoke('store-set', 'equalizerSettings', importData.settings.equalizerSettings);
        await loadEqualizerSettings();
        showNotification('Equalizer settings imported', 'info');
      }
      
      // Default playlist
      if (importData.settings.defaultPlaylistId) {
        // Check if the imported default playlist exists in the imported playlists
        const importedDefaultExists = newPlaylists.find(p => p.name === importData.playlists.find(ip => ip.id === importData.settings.defaultPlaylistId)?.name);
        if (importedDefaultExists) {
          await ipcRenderer.invoke('store-set', 'defaultPlaylistId', importedDefaultExists.id);
          const defaultPlaylistSelect = document.getElementById('defaultPlaylistSelect');
          if (defaultPlaylistSelect) {
            defaultPlaylistSelect.value = importedDefaultExists.id;
          }
          showNotification('Default playlist setting imported', 'info');
        }
      }
      
      // Save all settings to player state
      savePlayerState();
    }

    // Refresh display
    await loadPlaylists();
    
    // Refresh default playlist dropdown after import
    await loadDefaultPlaylistDropdown();    let message = `Imported ${importedCount} playlist${importedCount > 1 ? 's' : ''} successfully`;
    if (skippedCount > 0) {
      message += ` (${skippedCount} missing tracks skipped)`;
    }
    
    showNotification(message, 'success');
    
  } catch (error) {
    console.error('Import failed:', error);
    showNotification('Failed to import playlists. Please check the file format.', 'error');
  }
}

async function clearAllData() {
  // Show confirmation modal instead of prompt
  showClearDataConfirmModal();
}

function showClearDataConfirmModal() {
  document.getElementById('clearDataConfirmModal').classList.add('active');
  
  // Focus on the cancel button initially for safety
  document.getElementById('cancelClearDataBtn').focus();
  
  // Add keyboard support
  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      hideClearDataConfirmModal();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  
  document.addEventListener('keydown', handleKeydown);
}

function hideClearDataConfirmModal() {
  document.getElementById('clearDataConfirmModal').classList.remove('active');
}

async function performClearAllData() {
  try {
    // Show processing notification
    showNotification('Clearing all data...', 'info');
    
    // Clear all stored data
    await ipcRenderer.invoke('store-clear');
    
    // Reset application state
    currentPlaylist = null;
    currentTrackIndex = 0;
    shuffledQueue = [];
    shuffledIndex = 0;
    isPlaying = false;
    volume = 0.7;
    crossfadeDuration = 3;
    repeatMode = 'all';
    isShuffled = true;
    
    // Stop playback
    audioPlayer.pause();
    audioPlayer2.pause();
    
    // Update UI states
    updatePlaylistSelectorState();
    
    // Reset UI
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    setSliderValue('volumeSliderBar', 70);
    updateVolume();
    initializeUIState();
    
    // Clear displays
    currentPlaylistTitle.textContent = 'Track List';
    trackTitle.textContent = 'No Track Playing';
    trackArtist.textContent = 'Select a track to start';
    trackAlbum.textContent = '';
    
    // Clear lists
    playlistList.innerHTML = '';
    trackList.innerHTML = `
      <div class="empty-playlist">
        <i class="fas fa-music"></i>
        <p>No playlist selected</p>
      </div>
    `;
    
    // Reset equalizer
    resetEqualizer();
    
    // Hide all modals
    hideClearDataConfirmModal();
    hideSettingsModal();
    
    // Show final notification
    showNotification('All data cleared. Application will close in 2 seconds...', 'success');
    
    // Close the application after a short delay
    setTimeout(() => {
      ipcRenderer.send('app-quit');
    }, 2000);
    
  } catch (error) {
    console.error('Failed to clear data:', error);
    showNotification('Failed to clear data', 'error');
    hideClearDataConfirmModal();
  }
}

// Global functions for HTML onclick handlers
window.editPlaylist = async function(playlistId) {
  // Check if safe mode is enabled
  if (safeModeEnabled) {
    showNotification('Cannot edit playlists while Safe Mode is enabled', 'warning');
    return;
  }
  
  // Find and select the playlist first
  const playlists = await ipcRenderer.invoke('store-get', 'playlists') || [];
  const playlist = playlists.find(p => p.id === playlistId);
  
  if (playlist) {
    // Set as current playlist temporarily for editing
    const previousPlaylist = currentPlaylist;
    currentPlaylist = playlist;
    
    // Show the edit modal
    showEditPlaylistModal();
    
    // Restore previous playlist after modal is closed
    // (The modal will handle updating the playlist if changes are saved)
  }
};

window.deletePlaylist = async function(playlistId) {
  if (confirm('Are you sure you want to delete this playlist?')) {
    const playlistElement = document.querySelector(`[data-id="${playlistId}"]`);
    if (playlistElement) {
      playlistElement.remove();
      await savePlaylists();
      
      if (currentPlaylist && currentPlaylist.id === playlistId) {
        currentPlaylist = null;
        trackList.innerHTML = `
          <div class="empty-playlist">
            <i class="fas fa-music"></i>
            <p>No playlist selected</p>
          </div>
        `;
      }
      
      showNotification('Playlist deleted', 'success');
    }
  }
};

// Keyboard Shortcuts Modal Functions
function showKeyboardShortcutsModal() {
  document.getElementById('keyboardShortcutsModal').classList.add('active');
}

function hideKeyboardShortcutsModal() {
  document.getElementById('keyboardShortcutsModal').classList.remove('active');
}

// About Modal Functions
function showAboutModal() {
  const modal = document.getElementById('aboutModal');
  
  if (modal) {
    // Remove the modal from its current parent and append to body to ensure it's not hidden
    modal.remove();
    document.body.appendChild(modal);
    
    modal.classList.add('active');
    
    // Apply clean styling
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '99999';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0, 0, 0, 0.8)'; // Dark overlay
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.pointerEvents = 'all';
    
    // Style the modal content properly
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.style.display = 'block';
      modalContent.style.position = 'relative';
      modalContent.style.zIndex = '100000';
      modalContent.style.background = 'var(--background-medium)';
      modalContent.style.color = 'var(--text-primary)';
      modalContent.style.padding = '';
      modalContent.style.borderRadius = '12px';
      modalContent.style.maxWidth = '600px';
      modalContent.style.minWidth = '500px';
      modalContent.style.width = '90%';
      modalContent.style.maxHeight = '80vh';
      modalContent.style.overflow = 'hidden';
      modalContent.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.5)';
    }
  }
}

function hideAboutModal() {
  const modal = document.getElementById('aboutModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
    modal.style.visibility = '';
    modal.style.opacity = '';
    modal.style.zIndex = '';
    
    // Clean up any inline styles
    modal.style.position = '';
    modal.style.top = '';
    modal.style.left = '';
    modal.style.width = '';
    modal.style.height = '';
    modal.style.background = '';
    modal.style.alignItems = '';
    modal.style.justifyContent = '';
    modal.style.pointerEvents = '';
    
    // Clean up modal content styles
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.style.display = '';
      modalContent.style.position = '';
      modalContent.style.zIndex = '';
      modalContent.style.background = '';
      modalContent.style.color = '';
      modalContent.style.padding = '';
      modalContent.style.borderRadius = '';
      modalContent.style.maxWidth = '';
      modalContent.style.minWidth = '';
      modalContent.style.width = '';
      modalContent.style.maxHeight = '';
      modalContent.style.overflow = '';
      modalContent.style.boxShadow = '';
    }
  }
}

window.dragOverHandler = dragOverHandler;
window.dropHandler = dropHandler;

// Global function for playlist editor
window.removeTrackFromEditor = function(index) {
  editingTracks.splice(index, 1);
  populateTracksEditor();
};
