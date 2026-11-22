import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

/** Check shortly after launch, so startup is not slowed down */
const FIRST_CHECK_DELAY = 10 * 1000;

let checking = false;
/** Set while a check started from the menu is running, so its result is shown to the user */
let manualCheck = false;
/** Version that has been downloaded and is waiting to be installed */
let downloadedVersion: string | undefined;
let beforeInstall: () => void = () => {};

/**
 * Checks GitHub Releases for a newer version, downloads it in the background
 * and offers to restart. If the user picks "Later", the update is installed
 * the next time the app quits.
 *
 * @param onBeforeInstall Called right before the app quits to install an update
 */
export function setupAutoUpdate( onBeforeInstall: () => void ): void {
	beforeInstall = onBeforeInstall;
	// Development builds have no update feed
	if ( ! app.isPackaged ) {
		return;
	}
	autoUpdater.logger = console;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on( 'update-available', ( info ) => {
		if ( manualCheck ) {
			manualCheck = false;
			dialog.showMessageBox( {
				type: 'info',
				message: `Tuttibox ${ info.version } is available`,
				detail: 'It is being downloaded in the background. You will be asked to restart when it is ready.',
			} );
		}
	} );
	autoUpdater.on( 'update-not-available', () => {
		if ( manualCheck ) {
			manualCheck = false;
			dialog.showMessageBox( {
				type: 'info',
				message: 'Tuttibox is up to date',
				detail: `Version ${ app.getVersion() } is the latest version.`,
			} );
		}
	} );
	autoUpdater.on( 'update-downloaded', ( info ) => {
		downloadedVersion = info.version;
		promptRestart();
	} );
	autoUpdater.on( 'error', ( error ) => {
		console.error( 'Auto update failed', error );
		if ( manualCheck ) {
			manualCheck = false;
			dialog.showMessageBox( {
				type: 'error',
				message: 'Could not check for updates',
				detail: error.message,
			} );
		}
	} );

	setTimeout( check, FIRST_CHECK_DELAY );
}

/** "Check for Updates" button in the About window */
export function checkForUpdatesFromMenu(): void {
	if ( ! app.isPackaged ) {
		dialog.showMessageBox( {
			type: 'info',
			message: 'Updates are not available in development builds',
		} );
		return;
	}
	if ( downloadedVersion ) {
		promptRestart();
		return;
	}
	manualCheck = true;
	check();
}

function check(): void {
	if ( checking || downloadedVersion ) {
		return;
	}
	checking = true;
	autoUpdater
		.checkForUpdates()
		.catch( () => {
			// Reported through the 'error' event
		} )
		.finally( () => {
			checking = false;
		} );
}

async function promptRestart(): Promise< void > {
	const { response } = await dialog.showMessageBox( {
		type: 'info',
		buttons: [ 'Restart Now', 'Later' ],
		defaultId: 0,
		cancelId: 1,
		message: `Tuttibox ${ downloadedVersion } is ready to install`,
		detail: 'Restart Tuttibox to finish updating. If you choose Later, the update is installed the next time you quit.',
	} );
	if ( response === 0 ) {
		beforeInstall();
		autoUpdater.quitAndInstall();
	}
}
