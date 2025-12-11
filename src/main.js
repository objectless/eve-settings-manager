'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const AppConfig = require('./configuration.js');
const prompt = require('electron-prompt');
const { getLocale } = require('./js/change-language');
const { overwrite } = require('./js/eve-folder');
// NEW: dark theme for prompt windows
const promptCssPath = path.join(__dirname, 'css', 'prompt.css')

let win;
let selectWin;
let helpWin;

function createWindow() {
  const savedBounds = AppConfig.readSettings('bounds') || {};
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea; // { x, y, width, height }

  const defaultWidth = 1300;
  const defaultHeight = 825;

  const width = Math.min(savedBounds.width || defaultWidth, workArea.width);
  const height = Math.min(savedBounds.height || defaultHeight, workArea.height);

  const x = (typeof savedBounds.x === 'number')
    ? savedBounds.x
    : workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2));

  const y = (typeof savedBounds.y === 'number')
    ? savedBounds.y
    : workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2));

  const options = {
    width,
    height,
    x,
    y,
    minWidth: 980,
    minHeight: 825,
    autoHideMenuBar: true,
    resizable: true,
    show: false,
    backgroundColor: '#0f1217',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  };

  win = new BrowserWindow(options);

  win.loadFile('./src/views/index.html');

  win.once('ready-to-show', () => {
    win.show();

    if (!app.isPackaged) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.on('close', () => {
    // Only save "normal" window bounds
    if (!win.isMinimized() && !win.isMaximized()) {
      AppConfig.saveSettings('bounds', win.getBounds());
    }
    app.quit();
  });
}

async function openFolderDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (canceled) return;
  return filePaths[0];
}

async function openDescriptionDialog(args) {
  const locale = getLocale()

  const description = await prompt({
    title: locale.titles.editDesc,
    label: locale.titles.editLabel,
    value: args.savedDescription ?? '',
    inputAttrs: {
      type: 'text',
      maxlength: 20,
    },
    type: 'input',
    resizable: false,
    alwaysOnTop: true,
    buttonLabels: {
      ok: locale.buttons.confirm,
      cancel: locale.buttons.cancel,
    },
    // THEME:
    customStylesheet: promptCssPath,
  }, win)

  return description
}


function openNotificationWindow(msg) {
  const locale = getLocale()

  // Normalize message to a string
  let text = (msg == null ? '' : String(msg))

  // If some caller accidentally concatenated an undefined, strip it
  if (text.startsWith('undefined')) {
    text = text.replace(/^undefined/, '').trimStart()
  }

  // If it looks like a backup path, prepend a friendly label
  if (/Backup_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/.test(text)) {
    text = `Backup created at:\n${text}`
  }

  dialog.showMessageBoxSync(win, {
    message: text,
    type: 'info',
    buttons: [locale.buttons.confirm],
    title: locale.titles.success,
    icon: path.join(__dirname, 'assets', 'check.png'),
  })
}


async function openSelectWindow(args) {
  const bounds = {
    width: 600,
    height: 500,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    parent: win,
    modal: true,
  };

  selectWin = new BrowserWindow(bounds);
  selectWin.setResizable(false);

  await selectWin.loadFile('./src/views/select.html');
  selectWin.webContents.send('loadSelect', args);
}

function openHelpWindow() {
  if (helpWin && !helpWin.isDestroyed()) {
    helpWin.focus();
    return true;
  }

  helpWin = new BrowserWindow({
    width: 820,
    height: 880,
    minWidth: 700,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: '#0f1217',
    parent: win,
    modal: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  helpWin.once('ready-to-show', () => helpWin.show());
  helpWin.on('closed', () => {
    helpWin = null;
  });

  helpWin.loadFile('./src/views/help.html');
  return true;
}

function reload() {
  if (win && !win.isDestroyed()) {
    win.reload();
  }
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:SelectFolder', openFolderDialog);
  ipcMain.handle('dialog:EditDescription', (event, args) =>
    openDescriptionDialog(args),
  );
    // NEW: ask for group name
ipcMain.handle('dialog:NewGroupName', async () => {
  const name = await prompt({
    title: 'New group',
    label: 'Enter a name for this group:',
    value: '',
    inputAttrs: {
      type: 'text',
      maxlength: 40,
    },
    type: 'input',
    resizable: false,
    alwaysOnTop: true,
    buttonLabels: {
      ok: 'Create',
      cancel: 'Cancel',
    },
    // THEME:
    customStylesheet: promptCssPath,
  }, win)

  return name
})

  ipcMain.on('dialog:Notification', (event, msg) =>
    openNotificationWindow(msg),
  );
  ipcMain.on('dialog:SelectTargets', (event, args) =>
    openSelectWindow(args),
  );

  ipcMain.on('returnSelected', async (event, args) => {
    if (selectWin && !selectWin.isDestroyed()) {
      await selectWin.close();
    }
    reload();
    await overwrite(args);
  });

  ipcMain.on('cancelSelected', () => {
    if (selectWin && !selectWin.isDestroyed()) {
      selectWin.close();
    }
  });

  ipcMain.on('reload', () => reload());

  // Help window
  ipcMain.handle('window:OpenHelp', () => openHelpWindow());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
