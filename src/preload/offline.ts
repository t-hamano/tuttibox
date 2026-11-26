import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld( 'tuttibox', {
	retry: () => ipcRenderer.send( 'offline:retry' ),
} );
