import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld( 'tuttiboxAbout', {
	get: () => ipcRenderer.invoke( 'about:get' ),
	checkForUpdates: () => ipcRenderer.send( 'about:check-for-updates' ),
	close: () => ipcRenderer.send( 'about:close' ),
} );
