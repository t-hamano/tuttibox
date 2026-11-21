interface AppSettingsData {
	openAtLogin: boolean;
	supportsOpenAtLogin: boolean;
	pollInterval: number;
	pollIntervals: number[];
}

interface SettingsApi {
	get: () => Promise< AppSettingsData >;
	setOpenAtLogin: ( enabled: boolean ) => Promise< boolean >;
	setPollInterval: ( seconds: number ) => Promise< number >;
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

	const pollSelect = document.getElementById( 'poll-interval' ) as HTMLSelectElement;
	for ( const seconds of data.pollIntervals ) {
		const option = document.createElement( 'option' );
		option.value = String( seconds );
		option.textContent = seconds === 0 ? 'Off' : `Every ${ seconds } seconds`;
		pollSelect.append( option );
	}
	pollSelect.value = String( data.pollInterval );
	pollSelect.addEventListener( 'change', async () => {
		pollSelect.value = String( await api.setPollInterval( Number( pollSelect.value ) ) );
	} );

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
	closeButton.focus();
} )();
