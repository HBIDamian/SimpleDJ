const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Initialize electron-store for persistent data
const store = new Store();

let mainWindow;
let tray;

function createWindow() {
  // Create the browser window
mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: false,
        webSecurity: false // Allow loading local files
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    frame: false, // Removes default title bar and buttons
    show: false // Don't show until ready-to-show
});

  // Load the app
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus the window
    if (process.platform === 'darwin') {
      app.dock.show();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle close button with confirmation
  mainWindow.on('close', async (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 1,
        title: 'Close SimpleDJ',
        message: 'Are you sure you want to close SimpleDJ?',
        detail: 'This will stop music playback and close the application.'
      });
      
      if (choice.response === 0) { // User clicked "Yes"
        app.isQuiting = true;
        app.quit();
      }
    }
  });
}

function createTray() {
  try {
    let trayIconPath;
    
    // Try different icon paths
    const possiblePaths = [
      path.join(__dirname, '../assets/tray-icon.png'),
      path.join(__dirname, '../assets/tray-icon.svg'),
      path.join(__dirname, '../assets/icon.png'),
      path.join(__dirname, '../assets/icon.svg')
    ];
    
    // Find first existing icon
    for (const iconPath of possiblePaths) {
      if (require('fs').existsSync(iconPath)) {
        trayIconPath = iconPath;
        break;
      }
    }
    
    // If no icon found, create a minimal one programmatically
    if (!trayIconPath) {
      console.warn('No tray icon found, creating minimal icon');
      // For now, skip tray creation if no icon is available
      return;
    }
    
    tray = new Tray(trayIconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show SimpleDJ',
        click: () => {
          mainWindow.show();
          if (process.platform === 'darwin') {
            app.dock.show();
          }
        }
      },
      {
        label: 'Play/Pause',
        click: () => {
          mainWindow.webContents.send('tray-play-pause');
        }
      },
      {
        label: 'Previous',
        click: () => {
          mainWindow.webContents.send('tray-previous');
        }
      },
      {
        label: 'Next',
        click: () => {
          mainWindow.webContents.send('tray-next');
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuiting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('SimpleDJ - Music Player');
    
    // Show/hide window on tray click
    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    });
    
  } catch (error) {
    console.warn('Failed to create system tray:', error.message);
    // Continue without tray - not critical for functionality
  }
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  
  // Skip tray creation for initial testing
  // createTray();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

// IPC handlers for file operations
ipcMain.handle('select-music-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] }
    ]
  });
  
  return result;
});

ipcMain.handle('select-music-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  return result;
});

// Store operations
ipcMain.handle('store-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('store-delete', (event, key) => {
  store.delete(key);
});

ipcMain.handle('store-clear', (event) => {
  store.clear();
});

ipcMain.handle('save-file-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('select-file-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Update tray tooltip with current song
ipcMain.on('update-tray-tooltip', (event, songInfo) => {
  if (tray) {
    const tooltip = songInfo ? `SimpleDJ - ${songInfo}` : 'SimpleDJ - Music Player';
    tray.setToolTip(tooltip);
  }
});

// Handle external file protocol
app.setAsDefaultProtocolClient('simpledj');

// Window control handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('app-quit', () => {
  app.quit();
});

// Handle file associations (when files are opened with the app)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-file', filePath);
  }
});

// Development mode
if (process.argv.includes('--dev')) {
  app.whenReady().then(() => {
    mainWindow.webContents.openDevTools();
  });
}
