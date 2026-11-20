import { contextBridge, ipcRenderer } from 'electron';

/**
 * 各サービスのページに読み込む preload。
 * Web 通知をクリックしたとき、ウィンドウを前面に出して該当サービスへ切り替える。
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
