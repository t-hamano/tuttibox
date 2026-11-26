( () => {
	const api = ( window as unknown as { tuttibox: { retry: () => void } } ).tuttibox;
	document.getElementById( 'retry' )!.addEventListener( 'click', () => api.retry() );
	// Reload as soon as the connection comes back instead of waiting for the next retry
	window.addEventListener( 'online', () => api.retry() );
} )();
