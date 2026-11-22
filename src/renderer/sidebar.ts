interface SidebarItem {
	id: string;
	name: string;
	color: string;
	icon?: string;
	badge: number;
	active: boolean;
}

interface TuttiboxApi {
	onState: ( callback: ( items: SidebarItem[] ) => void ) => void;
	select: ( id: string ) => void;
	reorder: ( ids: string[] ) => void;
	showAddMenu: () => void;
	openSettings: () => void;
	showContextMenu: ( id: string ) => void;
	setOverlay: ( dataUrl: string | null, total: number ) => void;
}

( () => {
	const api = ( window as unknown as { tuttibox: TuttiboxApi } ).tuttibox;
	const container = document.getElementById( 'services' )!;
	const addButton = document.getElementById( 'add' )!;
	let lastTotal = -1;
	let dragging: HTMLElement | null = null;

	addButton.addEventListener( 'click', () => api.showAddMenu() );
	document.getElementById( 'settings' )!.addEventListener( 'click', () => api.openSettings() );

	function formatBadge( count: number ): string {
		return count > 99 ? '99+' : String( count );
	}

	function createButton( item: SidebarItem ): HTMLButtonElement {
		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'service' + ( item.active ? ' is-active' : '' );
		button.dataset.id = item.id;
		button.title = item.name;
		button.draggable = true;
		button.setAttribute( 'aria-label', item.name );
		button.setAttribute( 'aria-current', item.active ? 'page' : 'false' );
		button.addEventListener( 'click', () => api.select( item.id ) );
		button.addEventListener( 'contextmenu', ( event ) => {
			event.preventDefault();
			api.showContextMenu( item.id );
		} );

		const letter = document.createElement( 'span' );
		letter.className = 'letter';
		letter.style.background = item.color;
		letter.textContent = item.name.charAt( 0 );

		if ( item.icon ) {
			const img = document.createElement( 'img' );
			img.className = 'icon';
			img.alt = '';
			img.draggable = false;
			img.src = item.icon;
			// Fall back to the initial letter if the favicon fails to load
			img.addEventListener( 'error', () => img.replaceWith( letter ) );
			button.append( img );
		} else {
			button.append( letter );
		}

		if ( item.badge > 0 ) {
			const badge = document.createElement( 'span' );
			badge.className = 'badge';
			badge.textContent = formatBadge( item.badge );
			button.append( badge );
		}
		return button;
	}

	// Reorder by drag and drop
	container.addEventListener( 'dragstart', ( event ) => {
		const target = ( event.target as HTMLElement ).closest< HTMLElement >( '.service' );
		if ( ! target ) {
			return;
		}
		dragging = target;
		target.classList.add( 'is-dragging' );
		event.dataTransfer?.setData( 'text/plain', target.dataset.id ?? '' );
		if ( event.dataTransfer ) {
			event.dataTransfer.effectAllowed = 'move';
		}
	} );

	container.addEventListener( 'dragover', ( event ) => {
		if ( ! dragging ) {
			return;
		}
		event.preventDefault();
		const over = ( event.target as HTMLElement ).closest< HTMLElement >( '.service' );
		if ( ! over || over === dragging ) {
			return;
		}
		const rect = over.getBoundingClientRect();
		const after = event.clientY > rect.top + rect.height / 2;
		over.insertAdjacentElement( after ? 'afterend' : 'beforebegin', dragging );
	} );

	container.addEventListener( 'drop', ( event ) => event.preventDefault() );

	container.addEventListener( 'dragend', () => {
		if ( ! dragging ) {
			return;
		}
		dragging.classList.remove( 'is-dragging' );
		dragging = null;
		const ids = [ ...container.querySelectorAll< HTMLElement >( '.service' ) ].map(
			( el ) => el.dataset.id ?? ''
		);
		api.reorder( ids );
	} );

	function render( items: SidebarItem[] ): void {
		// Re-rendering while dragging cancels the drag, so wait until it ends
		if ( dragging ) {
			return;
		}
		container.replaceChildren( ...items.map( createButton ) );

		const total = items.reduce( ( sum, item ) => sum + item.badge, 0 );
		if ( total !== lastTotal ) {
			lastTotal = total;
			api.setOverlay( total > 0 ? drawOverlay( total ) : null, total );
		}
	}

	/**
	 * Draw the Windows taskbar overlay icon (a number on a red circle).
	 *
	 * Windows shows the overlay at 16x16 device-independent pixels, so the
	 * image is drawn at that size times the display scale. Drawing at a fixed
	 * size and letting Windows resize it makes the number blurry.
	 */
	function drawOverlay( total: number ): string {
		const scale = Math.max( 1, window.devicePixelRatio || 1 );
		const size = Math.round( 16 * scale );
		const canvas = document.createElement( 'canvas' );
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext( '2d' )!;
		const center = size / 2;

		ctx.fillStyle = '#d93025';
		ctx.beginPath();
		ctx.arc( center, center, center, 0, Math.PI * 2 );
		ctx.fill();

		// Make the number as large as the circle allows
		const text = formatBadge( total );
		const ratio = { 1: 0.8, 2: 0.66, 3: 0.48 }[ text.length ] ?? 0.48;
		ctx.fillStyle = '#ffffff';
		ctx.font = `bold ${ Math.round( size * ratio ) }px "Segoe UI", Arial, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		const metrics = ctx.measureText( text );
		const maxWidth = size - 4 * scale;
		const offset = ( metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent ) / 2;
		ctx.fillText( text, center, center + offset, maxWidth );
		return canvas.toDataURL( 'image/png' );
	}

	// Redraw when the window moves to a display with a different scale
	function watchScale(): void {
		window
			.matchMedia( `(resolution: ${ window.devicePixelRatio }dppx)` )
			.addEventListener(
				'change',
				() => {
					if ( lastTotal > 0 ) {
						api.setOverlay( drawOverlay( lastTotal ), lastTotal );
					}
					watchScale();
				},
				{ once: true }
			);
	}
	watchScale();

	api.onState( render );
} )();
