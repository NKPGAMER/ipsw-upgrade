import { app, BrowserWindow } from "electron";
import { join } from "path";

export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 360,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    thickFrame: false,
    webPreferences: {
      preload: join(__dirname, "../preload.splash.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const splashPath = app.isPackaged ? "dist/splash.html" : "src/splash.html";
  win.loadFile(splashPath);
  return win;
}

export function createMainWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width: Math.round(width * 0.92),
    height: Math.round(height * 0.9),
    show: false,
    transparent: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
  });
  win.setMenu(null);
  return win;
}

export function loadRenderer(win: BrowserWindow): void {
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://localhost:5173/");
    win.webContents.openDevTools({ mode: "detach" });
    try { require("electron-reloader")(module, { debug: false, watchRenderer: true }); } catch { }
  } else {
    win.loadFile("dist/index.html");
  }
}
