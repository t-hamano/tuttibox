interface TitlebarApi {
	onMenus: ( callback: ( labels: string[] ) => void ) => void;
	onMenuClosed: ( callback: () => void ) => void;
	openMenu: ( index: number, x: number, y: number ) => void;
}

( () => {
	const api = ( window as unknown as { tuttibox: TitlebarApi } ).tuttibox;
	const container = document.getElementById( 'menus' )!;
	let openButton: HTMLButtonElement | null = null;

	function open( button: HTMLButtonElement, index: number ): void {
		openButton?.classList.remove( 'open' );
		openButton = button;
		button.classList.add( 'open' );
		const rect = button.getBoundingClientRect();
		api.openMenu( index, Math.round( rect.left ), Math.round( rect.bottom ) );
	}

	api.onMenus( ( labels ) => {
		container.replaceChildren(
			...labels.map( ( label, index ) => {
				const button = document.createElement( 'button' );
				button.type = 'button';
				button.setAttribute( 'role', 'menuitem' );
				button.textContent = label;
				button.addEventListener( 'click', () => open( button, index ) );
				return button;
			} )
		);
	} );

	api.onMenuClosed( () => {
		openButton?.classList.remove( 'open' );
		openButton = null;
	} );
} )();
