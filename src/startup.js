const { app } = require('electron');

// Disable hardware acceleration on Windows to prevent GPU issues
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

// Set additional command line switches for better compatibility
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');



// Load main application
require('./main.js');
