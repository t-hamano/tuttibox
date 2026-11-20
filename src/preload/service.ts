import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for each service page.
 * When a web notification is clicked, bring the window to the front and switch to that service.
 */
contextBridge.exposeInMainWorld( '__tuttibox', {
	notificationClicked: () => ipcRenderer.send( 'service:notification-click' ),
} );

contextBridge.executeInMainWorld( {
	func: () => {
		const Original = window.Notification;
		if ( ! Original ) {
			return;
		}
		const bridge = ( window as unknown as {
			__tuttibox: { notificationClicked: () => void };
		} ).__tuttibox;

		class TuttiboxNotification extends Original {
			constructor( title: string, options?: NotificationOptions ) {
				super( title, options );
				this.addEventListener( 'click', () => bridge.notificationClicked() );
			}
		}
		window.Notification = TuttiboxNotification;
	},
} );
