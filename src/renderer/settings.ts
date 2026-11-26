interface AppSettingsData {
	openAtLogin: boolean;
	supportsOpenAtLogin: boolean;
}

interface SettingsApi {
	get: () => Promise< AppSettingsData >;
	setOpenAtLogin: ( enabled: boolean ) => Promise< boolean >;
	close: () => void;
}

( async () => {
	const api = ( window as unknown as { tuttiboxSettings: SettingsApi } ).tuttiboxSettings;
	const toggle = document.getElementById( 'open-at-login' ) as HTMLInputElement;
	const closeButton = document.getElementById( 'close' )!;

	const data = await api.get();
	toggle.checked = data.openAtLogin;
	if ( ! data.supportsOpenAtLogin ) {
		toggle.disabled = true;
		document.getElementById( 'login-note' )!.textContent = 'Not available on this system.';
	}

	toggle.addEventListener( 'change', async () => {
		// Show what the system actually applied
		toggle.checked = await api.setOpenAtLogin( toggle.checked );
	} );
	closeButton.addEventListener( 'click', () => api.close() );
	document.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			api.close();
		}
	} );
} )();
