( () => {
	const api = ( window as unknown as { tuttibox: { showAddMenu: () => void } } ).tuttibox;
	document.getElementById( 'add' )!.addEventListener( 'click', () => api.showAddMenu() );
} )();
