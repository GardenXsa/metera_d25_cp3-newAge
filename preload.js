const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    // Settings
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (data) => ipcRenderer.invoke('save-settings', data),

    // Mods
    modsGetList: () => ipcRenderer.invoke('mods-get-list'),
    modsOpenFolder: () => ipcRenderer.invoke('mods-open-folder'),
    modsReadFile: (args) => ipcRenderer.invoke('mods-read-file', args),

    // Existing functions...
    saveGame: (filename, data) => ipcRenderer.invoke('save-game', filename, data),
    loadGame: (filename) => ipcRenderer.invoke('load-game', filename),
    listSaves: () => ipcRenderer.invoke('list-saves'),
    deleteSave: (filename) => ipcRenderer.invoke('delete-save', filename),
    saveWorldState: (filename, data) => ipcRenderer.invoke('save-world-state', filename, data),
    loadWorldState: (filename) => ipcRenderer.invoke('load-world-state', filename),
    listWorlds: () => ipcRenderer.invoke('list-worlds'),
    deleteWorld: (filename) => ipcRenderer.invoke('delete-world', filename),

    initSaveFile: (filename) => ipcRenderer.invoke('init-save-file', filename),
    appendSaveLine: (filename, line) => ipcRenderer.invoke('append-save-line', filename, line),
    getFileSize: (filename) => ipcRenderer.invoke('get-file-size', filename),
    readSaveChunk: (filename, position, size) => ipcRenderer.invoke('read-save-chunk', filename, position, size),

    speakText: (text, voiceModel) => ipcRenderer.invoke('speak-text', text, voiceModel),
    sendGeminiRequest: (model, contents) => ipcRenderer.invoke('gemini-request', model, contents),
    getSavePath: () => ipcRenderer.invoke('get-save-path')
,
    onNexusHookRequest: (callback) => {
        const handler = (event, hook, world) => callback(hook, world);
        ipcRenderer.on('nexus-hook-request', handler);
        return () => ipcRenderer.removeListener('nexus-hook-request', handler);
    },
    sendNexusHookResponse: (world) => ipcRenderer.invoke('nexus-hook-response', world),
    nexusRegisterHooks: (hooks) => ipcRenderer.invoke('nexus-register-hooks', hooks),

    nexusInit: (forceRestart, activeMods) => ipcRenderer.invoke('nexus-init', forceRestart, activeMods),

    nexusLoadDatabase: (databaseString) => ipcRenderer.invoke('nexus-load-database', databaseString),
    nexusBuildWorld: (playerId, era, initialAgents, globalLocations, startDay) => ipcRenderer.invoke('nexus-build-world', playerId, era, initialAgents, globalLocations, startDay),

    nexusBootstrap: (days, startDay) => ipcRenderer.invoke('nexus-bootstrap', days, startDay),
    nexusSimulate: (world, ticks, playerLocation) => ipcRenderer.invoke('nexus-simulate', world, ticks, playerLocation),
    nexusPreSimulate: (world, ticks) => ipcRenderer.invoke('nexus-presimulate', world, ticks),
    nexusSyncState: (world, items, containers) => ipcRenderer.invoke('nexus-sync-state', world, items, containers),
    nexusGetFullState: (playerLocation) => ipcRenderer.invoke('nexus-get-full-state', playerLocation),
    nexusGetGraphContext: (queryIds) => ipcRenderer.invoke('nexus-get-graph-context', queryIds),

    nexusGetWorldMap: () => ipcRenderer.invoke('nexus-get-world-map'),
    nexusGmIntervention: (commandObj, playerLocation) => ipcRenderer.invoke('nexus-gm-intervention', commandObj, playerLocation)
,
    nexusInventoryCommand: (params) => ipcRenderer.invoke('nexus-inventory-command', params)
,
    nexusLoadWorldFile: (filePath) => ipcRenderer.invoke('nexus-load-world-file', filePath)
,
    nexusWriteSyncFile: (worldData) => ipcRenderer.invoke('nexus-write-sync-file', worldData)
,
    nexusStartTrek: (startId, destId) => ipcRenderer.invoke('nexus-start-trek', startId, destId),
    nexusPauseTrek: () => ipcRenderer.invoke('nexus-pause-trek'),
    nexusResumeTrek: () => ipcRenderer.invoke('nexus-resume-trek'),
    nexusCancelTrek: () => ipcRenderer.invoke('nexus-cancel-trek'),
    nexusInteractTrekObject: (type, id) => ipcRenderer.invoke('nexus-interact-trek-object', type, id),
    nexusTransportCommand: (params) => ipcRenderer.invoke('nexus-transport-command', params),
    nexusManageBusiness: (params) => ipcRenderer.invoke('nexus-manage-business', params)
,
    nexusSendRawCommand: (command, params) => ipcRenderer.invoke('nexus-send-raw-command', command, params),
    onNexusProgress: (callback) => {
        const handler = (event, message) => callback(message);
        ipcRenderer.on('nexus-progress-update', handler);
        return () => ipcRenderer.removeListener('nexus-progress-update', handler);
    },

    // Realtime simulation — engine streams world updates without blocking
    nexusStartRealtime: (intervalMs) => ipcRenderer.invoke('nexus-start-realtime', intervalMs),
    nexusStopRealtime: () => ipcRenderer.invoke('nexus-stop-realtime'),
    onNexusRealtimeUpdate: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('nexus-realtime-update', handler);
        return () => ipcRenderer.removeListener('nexus-realtime-update', handler);
    },

    // HTTP session token for authenticated fetch calls
    getHttpToken: () => ipcRenderer.invoke('get-http-token')
});