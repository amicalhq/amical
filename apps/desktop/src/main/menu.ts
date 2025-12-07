import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from "electron";

// Forward declaration or import of the function type if it's complex
// For simplicity, we assume createOrShowSettingsWindow is a () => void function

export const setupApplicationMenu = (
  createOrShowSettingsWindow: () => void,
  checkForUpdates?: () => void,
  openAllDevTools?: () => void,
) => {
  const menuTemplate: MenuItemConstructorOptions[] = [
    // { role: 'appMenu' } for macOS
    ...(process.platform === "darwin"
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              ...(checkForUpdates
                ? [
                    {
                      label: "Check for Updates...",
                      click: () => checkForUpdates(),
                    } as MenuItemConstructorOptions,
                    { type: "separator" as const },
                  ]
                : []),
              {
                label: "Settings",
                accelerator: "CmdOrCtrl+,",
                click: () => createOrShowSettingsWindow(),
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    // { role: 'fileMenu' } for Windows/Linux
    ...(process.platform !== "darwin"
      ? ([
          {
            label: "File",
            submenu: [
              {
                label: "Settings",
                accelerator: "CmdOrCtrl+,",
                click: () => createOrShowSettingsWindow(),
              },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    // { role: 'editMenu' }
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        ...(process.platform === "darwin"
          ? [
              { role: "pasteAndMatchStyle" as const },
              { role: "delete" as const },
              { role: "selectAll" as const },
              { type: "separator" as const },
              {
                label: "Speech",
                submenu: [
                  { role: "startSpeaking" as const },
                  { role: "stopSpeaking" as const },
                ],
              },
            ]
          : [
              { role: "delete" as const },
              { type: "separator" as const },
              { role: "selectAll" as const },
            ]),
      ],
    },
    // { role: 'viewMenu' }
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        ...(openAllDevTools
          ? [
              {
                label: "Open All Dev Tools",
                accelerator: "CmdOrCtrl+Shift+I",
                click: () => openAllDevTools(),
              } as MenuItemConstructorOptions,
            ]
          : []),
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    // { role: 'windowMenu' }
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(process.platform === "darwin"
          ? [
              { type: "separator" as const },
              { role: "front" as const },
              { type: "separator" as const },
              { role: "window" as const },
              { type: "separator" as const },
              { role: "close" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
    {
      role: "help" as const,
      submenu: [
        ...(checkForUpdates
          ? [
              {
                label: "Check for Updates...",
                click: () => checkForUpdates(),
              } as MenuItemConstructorOptions,
              { type: "separator" as const },
            ]
          : []),
        {
          label: "Learn More",
          click: async () => {
            const { shell } = await import("electron");
            shell.openExternal("https://electronjs.org");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Add "Version" prefix on macOS About panel
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationVersion: `Version ${app.getVersion()}`,
    });
  }
};
