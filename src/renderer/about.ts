interface AboutData {
	name: string;
	version: string;
}

interface AboutApi {
	get: () => Promise< AboutData >;
	checkForUpdates: () => void;
	close: () => void;
}

( async () => {
	const api = ( window as unknown as { tuttiboxAbout: AboutApi } ).tuttiboxAbout;
	const button = document.getElementById( 'check-for-updates' )!;

	const data = await api.get();
	document.getElementById( 'name' )!.textContent = data.name;
	document.getElementById( 'version' )!.textContent = data.version;

	button.addEventListener( 'click', () => api.checkForUpdates() );
	document.getElementById( 'close' )!.addEventListener( 'click', () => api.close() );
	document.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			api.close();
		}
	} );
	button.focus();
} )();
