const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let preferences = {
    layout: 32,
    theme: 'light',
    fontSize: 16,
    autoSave: false,
    recentFiles: []
};

// Load preferences
function loadPreferences() {
    try {
        const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
        if (fs.existsSync(prefsPath)) {
            preferences = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading preferences:', error);
    }
}

// Save preferences
function savePreferences() {
    try {
        const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
        fs.writeFileSync(prefsPath, JSON.stringify(preferences, null, 2));
    } catch (error) {
        console.error('Error saving preferences:', error);
    }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Create the application menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('new-file');
          }
        },
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [
                { name: 'Text Files', extensions: ['txt', 'html'] }
              ]
            });
            if (filePaths && filePaths.length > 0) {
              const content = fs.readFileSync(filePaths[0], 'utf8');
              mainWindow.webContents.send('file-opened', { content, filePath: filePaths[0] });
              // Add to recent files
              preferences.recentFiles = [
                filePaths[0],
                ...preferences.recentFiles.filter(f => f !== filePaths[0]).slice(0, 9)
              ];
              savePreferences();
            }
          }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('save-file');
          }
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow.webContents.send('save-file-as');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => {
            mainWindow.webContents.send('undo');
          }
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => {
            mainWindow.webContents.send('redo');
          }
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          click: () => {
            mainWindow.webContents.send('cut');
          }
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => {
            mainWindow.webContents.send('copy');
          }
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: () => {
            mainWindow.webContents.send('paste');
          }
        }
      ]
    },
        {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            mainWindow.webContents.send('zoom-in');
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            mainWindow.webContents.send('zoom-out');
          }
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            mainWindow.webContents.send('zoom-reset');
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        }
      ]
    },
    {
      label: 'Format',
      submenu: [
        {
          label: 'Default Font',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow.webContents.send('apply-format', 'default')
        },
        {
          label: 'Illustration',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow.webContents.send('apply-format', 'illustration')
        },
        {
          label: 'Title',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.webContents.send('apply-format', 'title')
        },
        { type: 'separator' },
        {
          label: 'Add Spread Label',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow.webContents.send('add-spread')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Send initial preferences to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('preferences-loaded', preferences);
  });
}

app.whenReady().then(() => {
  loadPreferences();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle save file dialog
ipcMain.handle('save-dialog', async () => {
  const { filePath } = await dialog.showSaveDialog({
    filters: [
      { name: 'Text Files', extensions: ['txt', 'html'] }
    ]
  });
  return filePath;
});

// Handle file saving
ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});