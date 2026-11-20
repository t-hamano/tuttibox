import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld( 'tuttibox', {
	onState: ( callback: ( items: unknown ) => void ) => {
		ipcRenderer.on( 'sidebar:state', ( _event, items ) => callback( items ) );
	},
	select: ( id: string ) => ipcRenderer.send( 'sidebar:select', id ),
	setOverlay: ( dataUrl: string | null, total: number ) =>
		ipcRenderer.send( 'badge:overlay', dataUrl, total ),
} );
