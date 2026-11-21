import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld( 'tuttiboxSettings', {
	get: () => ipcRenderer.invoke( 'settings:get' ),
	setOpenAtLogin: ( enabled: boolean ) => ipcRenderer.invoke( 'settings:set-open-at-login', enabled ),
	setPollInterval: ( seconds: number ) => ipcRenderer.invoke( 'settings:set-poll-interval', seconds ),
	close: () => ipcRenderer.send( 'settings:close' ),
} );
