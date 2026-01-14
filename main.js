const { app, BrowserWindow, shell, Menu, BrowserView, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Global references
let mainWindow;
let view; // The website lives here

const statePath = path.join(app.getPath('userData'), 'window-state.json');

function getWindowState() {
  const defaultState = { width: 658, height: 865 };
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return state;
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return defaultState;
}

function saveWindowState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  try {
    fs.writeFileSync(statePath, JSON.stringify(bounds));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

async function tryAutoImportCookies(session) {
  const cookiePath = path.join(app.getAppPath(), 'cookies.txt');
  if (!fs.existsSync(cookiePath)) return;
  
  try {
    const cookieContent = fs.readFileSync(cookiePath, 'utf-8');
    const lines = cookieContent.split('\n');
    let count = 0;
    for (const line of lines) {
      if (!line || line.startsWith('#') || line.trim() === '') continue;
      const parts = line.split('\t');
      if (parts.length < 7) continue;
      const [domain, includeSubdomains, path, secureStr, expiration, name, value] = parts;
      const isSecure = secureStr === 'TRUE';
      const protocol = isSecure ? 'https://' : 'http://';
      let cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
      const cookie = {
        url: protocol + cleanDomain + path,
        name: name,
        value: value.trim(), 
        domain: domain,
        path: path,
        secure: isSecure,
        expirationDate: parseInt(expiration)
      };
      try { await session.cookies.set(cookie); count++; } catch (e) {}
    }
    if (count > 0) console.log(`Imported ${count} cookies.`);
  } catch (error) { console.error('Import failed:', error); }
}

function createWindow() {
  const state = getWindowState();

  // 1. The Container Window (The "Frame")
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    title: "Tv Time",
    icon: path.join(__dirname, 'icon.ico'), // Set the app icon
    titleBarStyle: 'hidden', // Native controls (min/max/close) overlay this
    titleBarOverlay: {
      color: '#1a1a1a', 
      symbolColor: '#ffffff', 
      height: 30
    },
    webPreferences: {
      nodeIntegration: true, // Needed for the custom header HTML
      contextIsolation: false // Needed to access ipcRenderer directly in titlebar.html
    }
  });

  // 2. Load a local HTML file that acts as the "Title Bar"
  // This file will just be a black strip with "Tv Time" text
  mainWindow.loadFile('titlebar.html');

  // 3. Create the BrowserView (The Website)
  view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      nativeWindowOpen: true,
      sandbox: true
    }
  });

  mainWindow.setBrowserView(view);

  // 4. Position the Website BELOW the 30px title bar
  function resizeView() {
    const bounds = mainWindow.getBounds(); // Get total window size
    // Set view to fill window BUT start 30px down
    // (contentBounds excludes the native window frame if visible, but we are hidden)
    const contentBounds = mainWindow.getContentBounds();
    view.setBounds({
      x: 0, 
      y: 30, // Offset by header height
      width: contentBounds.width,
      height: contentBounds.height - 30 
    });
  }

  // Initial sizing
  resizeView();

  // Resizing logic: Keep the view filling the window (minus top bar)
  mainWindow.on('resize', resizeView);
  mainWindow.on('maximize', resizeView);
  mainWindow.on('unmaximize', resizeView);

  // --- Spoofing & Popups (Applied to the VIEW, not the window) ---
  const userAgent = view.webContents.getUserAgent();
  const cleanUserAgent = userAgent.replace(/Electron\/[0-9\.]+\s/, '');
  view.webContents.setUserAgent(cleanUserAgent);

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('google.com') || url.includes('accounts.google') || url.includes('facebook.com')) {
      return { 
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          width: 600,
          height: 700,
          titleBarStyle: 'default'
        }
      };
    }
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // F5 Refresh logic
  view.webContents.on('before-input-event', (event, input) => {
    if ((input.key === 'F5' || (input.key === 'r' && input.control)) && input.type === 'keyDown') {
      view.webContents.reload();
      event.preventDefault();
    }
  });

  mainWindow.on('close', () => { saveWindowState(); });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Load cookies and URL into the VIEW
  tryAutoImportCookies(view.webContents.session).then(() => {
     view.webContents.loadURL('https://app.tvtime.com');
  });
}

// --- Shared Logic ---
async function clearCacheAndRestart() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.error('Main window is missing or destroyed.');
      return;
    }

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Clear & Restart'],
      defaultId: 1,
      title: 'Confirm Action',
      message: 'Are you sure you want to clear the cache?',
      detail: 'This will delete temporary files and restart the application. You might need to sign in again if session cookies are affected.'
    });

    if (response === 1) { // 1 = Clear & Restart
      // Check if view exists before trying to access its session
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        try {
          const session = view.webContents.session;
          const cacheSize = await session.getCacheSize();
          console.log(`Current Cache Size: ${(cacheSize / 1024 / 1024).toFixed(2)} MB`);

          // 1. Clear HTTP Cache (Images, Scripts, CSS)
          await session.clearCache();
          console.log('HTTP Cache cleared.');

          // 2. Clear Service Workers & Shader Cache (Fixes "stuck" logic without logging out)
          // We intentionally EXCLUDE 'cookies' and 'local storage' to keep you logged in.
          await session.clearStorageData({
            storages: ['shadercache', 'serviceworkers', 'cachestorage']
          });
          console.log('Service Workers & Shader Cache cleared.');
          
        } catch (cacheError) {
          console.error('Failed to clear session cache:', cacheError);
        }
      } else {
        console.warn('BrowserView was missing, proceeding to restart anyway.');
      }
      
      app.relaunch();
      app.exit();
    }
  } catch (error) {
    console.error('Critical error in clearCacheAndRestart:', error);
    dialog.showErrorBox('Error', 'An error occurred while trying to clear the cache: ' + error.message);
  }
}

// --- IPC Handler for Cache Clearing (from Renderer if needed) ---
ipcMain.on('clear-cache-request', () => {
  clearCacheAndRestart();
});

// --- IPC Handler for Menu Popup ---
ipcMain.on('show-context-menu', (event) => {
  const template = [
    {
      label: 'Clear Cache & Restart',
      click: () => {
        clearCacheAndRestart();
      }
    },
    { type: 'separator' },
    { role: 'reload', label: 'Refresh Page' },
    { role: 'quit', label: 'Exit TV Time' }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); 
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
