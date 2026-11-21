import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld( 'tuttibox', {
	onMenus: ( callback: ( labels: string[] ) => void ) => {
		ipcRenderer.on( 'titlebar:menus', ( _event, labels ) => callback( labels ) );
	},
	onMenuClosed: ( callback: () => void ) => {
		ipcRenderer.on( 'titlebar:menu-closed', () => callback() );
	},
	openMenu: ( index: number, x: number, y: number ) =>
		ipcRenderer.send( 'titlebar:open-menu', index, x, y ),
} );
