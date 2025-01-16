// The built directory structure
//
// ├─┬ dist
// │ ├─┬ electron
// │ │ ├─┬ main
// │ │ │ └── index.js
// │ │ └─┬ preload
// │ │   └── index.js
// │ ├── index.html
// │ ├── ...other-static-files-from-public
// │
process.env.DIST = join(__dirname, '../..')
process.env.PUBLIC = app.isPackaged ? process.env.DIST : join(process.env.DIST, '../public')

import { app, BrowserWindow, shell, ipcMain, nativeImage, Tray, Menu, screen } from 'electron'
import remote from '@electron/remote/main';
import { release } from 'os'
import { join } from 'path'
import { readdirSync, readFileSync } from 'fs';
import OSC from 'node-osc';

remote.initialize();

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.commandLine.appendSwitch('enable-web-bluetooth', 'enabled');
app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'enabled');

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let win: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null;
// Create a new OSC client
let oscClient = null;
let hrConnectedPath = '/avatar/parameters/hr_connected';
let hrPercentPath = '/avatar/parameters/hr_percent';
let maxHeartRate = 200;
// Here, you can also use other preload
const preload = join(__dirname, '../preload/index.js')

const appUnpackagedUrl = process.env.VITE_DEV_SERVER_URL as string
const appPackagedHtml = join(process.env.DIST, 'index.html')

const widgetViewPath = (widgetName: string, entry: string = 'widget.html') => {
  return join(app.isPackaged ? process.env.DIST : process.env.VITE_DEV_SERVER_URL, `addons/widgets/${widgetName}/${entry}`);
}

const configureOSC = (ip, port, paths, maxHr) => {
  oscClient = new OSC.Client(ip, port);
  hrConnectedPath = paths.hrConnected || hrConnectedPath;
  hrPercentPath = paths.hrPercent || hrPercentPath;
  maxHeartRate = maxHr || maxHeartRate;
};

const sendOSCMessage = (path, value) => {
  if (oscClient) {
      try {
          const oscValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
          oscClient.send(path, oscValue, () => {
              console.log(`OSC message sent: ${path} ${oscValue}`);
          });
      } catch (error) {
          console.error('Error sending OSC message:', error);
      }
  }
};




async function createWindow() {
  win = new BrowserWindow({
    title: 'Main window',
    icon: join(process.env.PUBLIC, 'favicon.ico'),
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
      devTools: !app.isPackaged
    },
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#e4e4e4',
      symbolColor: '#F25E86',
      height: 25
    },
  })

  if (app.isPackaged) {
    win.loadFile(appPackagedHtml)
  } else {
    win.loadURL(appUnpackagedUrl)
    win.webContents.openDevTools()
  }




  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Bluetooth device selection handler
  win.webContents.on('select-bluetooth-device', (ev, deviceList, callback) => {
    ev.preventDefault();
    console.log('Device list:', deviceList);

    if (Array.isArray(deviceList) && deviceList.length > 0) {
        win.webContents.send('ble-scan-devices', deviceList);
        callback(deviceList[0].deviceId); // 仅在 deviceList 有设备时调用
    } else {
        console.warn('Device list is empty or not an array');
        //callback(''); // 传递空字符串或其他合适的值
    }
});


  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  ipcMain.on('perform-connect', (ev, deviceInfo) => {
    win.webContents.send('require-connect-request', deviceInfo);
    // 确保在连接成功后立刻开始发送 OSC 消息
    if (oscClient) {
        sendOSCMessage(hrConnectedPath, true); // 连接状态为 1
    }
});

ipcMain.on('perform-disconnect', () => {
  try {
      if (oscClient) {
          sendOSCMessage(hrConnectedPath, false); // 连接状态为 0
      }
      // 进行其他必要的清理操作
  } catch (error) {
      console.error('Error in perform-disconnect:', error);
  }
});


ipcMain.on('configure-osc', (event, { ip, port, paths, maxHr }) => {
  configureOSC(ip, port, paths, maxHr);
});

  ipcMain.handle('request-widgets', ev => {
    const widgetMetas = {};
    readdirSync(app.isPackaged ? join(process.env.DIST, 'addons/widgets') : 'public/addons/widgets').forEach(dir => {
      widgetMetas[dir] = JSON.parse(readFileSync(
        app.isPackaged ? join(process.env.DIST, `addons/widgets/${dir}/meta.json`) : `public/addons/widgets/${dir}/meta.json`,
        'utf-8'
      ));
    });
    return widgetMetas;
  })

  ipcMain.on('create-widget', (ev, widgetMeta) => {
    // TODO: 判断 widgetMeta 各项值是否 required
    if (widgetWindow && widgetWindow.closable) {
      widgetWindow.close();
      widgetWindow = null;
    }
    if (!widgetMeta) return;
    widgetWindow = new BrowserWindow({
      width: widgetMeta.width,
      height: widgetMeta.height,
      type: 'toolbar',
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      transparent: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: !app.isPackaged,
      },
    });
    remote.enable(widgetWindow.webContents);

    widgetWindow.loadURL(widgetViewPath(widgetMeta.name));

    const { paddingLeft, paddingTop } = {
      paddingLeft: screen.getPrimaryDisplay().workAreaSize.width - widgetWindow.getSize()[0] - 80,
      paddingTop: screen.getPrimaryDisplay().workAreaSize.height - widgetWindow.getSize()[1] - 80
    }
    widgetWindow.setPosition(paddingLeft, paddingTop);

    widgetWindow.once('ready-to-show', () => {
      widgetWindow.show();
    });
  })

  ipcMain.on('request-stream-plugins', ev => { })

  ipcMain.on('create-stream-plugin', (ev, streamPlugin) => { })

  // 将在这里分发心率值给其它组件
  ipcMain.on('heart-rate-broadcast', (ev, hr) => {
    if (widgetWindow) widgetWindow.webContents.send('heart-rate-broadcast', hr);
    if (oscClient) {
      sendOSCMessage(hrConnectedPath, true);
      const hrPercent = (hr / maxHeartRate).toFixed(2);
      sendOSCMessage(hrPercentPath, parseFloat(hrPercent));
  }
  })




  
  win.addListener('close', (e) => {
    e.preventDefault();
    win.hide();
  })
}

const createOrFocusWindow = () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  } else {
    createWindow();
  }
}

app.whenReady().then(() => {
  createWindow();
  const trayIcon = nativeImage.createFromPath(join(process.env.PUBLIC, 'favicon.ico'));
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开面板', type: 'normal', click: createOrFocusWindow },
    { type: 'separator' },
    { label: '退出程序', type: 'normal', click: () => { win.removeAllListeners(); app.quit() } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('心动值监测器!');
  tray.setTitle('HeartBeat Monitor');

  tray.addListener('double-click', e => {
    createOrFocusWindow();
  })
})

// app.on('window-all-closed', () => {
//   // win = null
//   // if (process.platform !== 'darwin') app.quit()
// })

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// new window example arg: new windows url
ipcMain.handle('open-win', (event, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
    },
  })

  if (app.isPackaged) {
    childWindow.loadFile(appPackagedHtml, { hash: arg })
  } else {
    childWindow.loadURL(`${appUnpackagedUrl}/#${arg}`)
    // childWindow.webContents.openDevTools({ mode: "undocked", activate: true })
  }
})

ipcMain.on('open-explorer', (event, arg) => {
  shell.openPath(arg)
});
