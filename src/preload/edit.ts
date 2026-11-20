import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld( 'tuttiboxEdit', {
	get: () => ipcRenderer.invoke( 'edit:get' ),
	save: ( data: unknown ) => ipcRenderer.send( 'edit:save', data ),
	cancel: () => ipcRenderer.send( 'edit:cancel' ),
} );
