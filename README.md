# SimpleDJ

A beautiful and powerful music player built with Electron, designed for DJs and music enthusiasts who want a clean, professional interface with advanced audio features.

## Features

### Core Player Features
- **Play/Pause Control** - Spacebar or click to control playback
- **Previous/Next Navigation** - Skip between tracks with buttons or arrow keys
- **Volume Control** - Smooth volume slider with keyboard shortcuts (↑↓)
- **Noise Normalization** - Built-in audio compression for consistent volume levels
- **Multiple Playlists** - Create, edit, and manage multiple playlists
- **Playlist Editor** - Add, remove, and rename songs and playlists
- **Persistent Storage** - All playlists and settings are automatically saved

### Advanced Features
- **Track Progress Bar** - Visual progress with seek control by clicking
- **Repeat Modes** - Single track, entire playlist, or off (R key)
- **Shuffle Mode** - Randomize playback order (S key)
- **Professional Equalizer** - 9-band EQ with presets (Pop, Rock, Jazz, etc.)
- **Last Session Recovery** - Resume where you left off
- **System Tray Integration** - Mini-player controls in system tray/menu bar
- **Drag & Drop Support** - Simply drag music files to add to playlists

### User Interface
- **Modern Dark Theme** - Beautiful gradient accents and smooth animations
- **Custom Title Bar** - Native window controls with custom styling
- **Responsive Design** - Adapts to different window sizes
- **Keyboard Shortcuts** - Full keyboard navigation support
- **Visual Feedback** - Smooth transitions and hover effects

## Installation

### Prerequisites
- Node.js (14.0 or higher)
- npm or yarn

### Setup
1. Clone or download this repository
2. Navigate to the project directory:
   ```bash
   cd SimpleDJ
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm start
```

#### Building for Distribution
```bash
# Build for current platform
npm run build

# Build for Windows
npm run build-win

# Build for macOS
npm run build-mac
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `←` | Seek backward 10s |
| `→` | Seek forward 10s |
| `Shift + ←` | Previous track |
| `Shift + →` | Next track |
| `↑` | Volume up |
| `↓` | Volume down |
| `M` | Mute/Unmute |
| `S` | Toggle shuffle |
| `R` | Cycle repeat mode |

## Supported Audio Formats

- MP3 (.mp3)
- WAV (.wav)
- OGG (.ogg)
- FLAC (.flac)
- M4A (.m4a)
- AAC (.aac)

## System Requirements

### Windows
- Windows 10 or later
- 100 MB free disk space
- Audio output device

### macOS
- macOS 10.14 (Mojave) or later
- 100 MB free disk space
- Audio output device

## Technical Features

### Audio Processing
- **Web Audio API** - High-quality audio processing
- **Dynamic Range Compression** - Automatic volume normalization
- **9-Band Equalizer** - Professional audio shaping tools
- **Real-time Analysis** - Audio visualization capabilities

### Data Storage
- **Electron Store** - Secure, persistent configuration storage
- **JSON-based Playlists** - Human-readable playlist format
- **Session Recovery** - Automatic state saving and restoration

### System Integration
- **File Associations** - Open supported audio files directly
- **System Tray** - Background operation with quick controls
- **Native Notifications** - System-integrated feedback
- **Drag & Drop** - Seamless file import

## Development

### Project Structure
```
SimpleDJ/
├── src/
│   ├── main.js              # Electron main process
│   └── renderer/
│       ├── index.html       # Main UI
│       ├── styles.css       # Application styles
│       └── renderer.js      # UI logic and audio handling
├── assets/                  # Icons and images
├── package.json             # Dependencies and scripts
└── README.md               # This file
```

### Building from Source

1. Install development dependencies:
   ```bash
   npm install --dev
   ```

2. For development with auto-reload:
   ```bash
   npm run dev
   ```

3. To package for distribution:
   ```bash
   npm run dist
   ```

## Configuration

SimpleDJ automatically creates configuration files in your system's standard locations:
- **Windows**: `%APPDATA%/simple-dj/`
- **macOS**: `~/Library/Application Support/simple-dj/`
- **Linux**: `~/.config/simple-dj/`

### Configuration Files
- `config.json` - Main application settings
- `playlists.json` - Playlist data
- `equalizer.json` - EQ presets and settings

## Troubleshooting

### Audio Issues
- **No sound**: Check system volume and audio device selection
- **Distorted audio**: Try disabling the equalizer or reducing gain
- **Playback fails**: Ensure audio format is supported

### Performance Issues
- **Slow startup**: Check for corrupted playlist files
- **High CPU usage**: Disable visualizations if present
- **Memory leaks**: Restart the application periodically

### File Import Issues
- **Files not importing**: Verify file format support
- **Drag & drop not working**: Try using the Import Music button
- **Missing metadata**: Some files may not contain artist/album info

## Contributing

SimpleDJ is open for contributions! Areas where help is welcome:

- Additional audio format support
- New equalizer presets
- UI/UX improvements
- Performance optimizations
- Bug fixes and testing

## License

MIT License - see LICENSE file for details.

## Credits

- Built with [Electron](https://electronjs.org/)
- Icons from [Font Awesome](https://fontawesome.com/)
- Typography using [Inter](https://fonts.google.com/specimen/Inter)

## Version History

### v1.0.0
- Initial release
- Core playback functionality
- Playlist management
- System tray integration
- Professional equalizer
- Cross-platform support

---

**Enjoy your music with SimpleDJ!** 🎵
