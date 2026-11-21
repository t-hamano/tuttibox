interface EditData {
	name: string;
	badge: boolean;
	js: string;
	pollInterval: number;
	pollIntervals: number[];
	typeLabel: string;
	supportsBadge: boolean;
}

interface CodeEditor {
	getValue: () => string;
}

interface EditApi {
	get: () => Promise< EditData | null >;
	save: ( data: Pick< EditData, 'name' | 'badge' | 'js' | 'pollInterval' > ) => void;
	cancel: () => void;
}

( async () => {
	const api = ( window as unknown as { tuttiboxEdit: EditApi } ).tuttiboxEdit;
	const $ = < T extends HTMLElement >( id: string ) => document.getElementById( id ) as T;
	const form = $< HTMLFormElement >( 'form' );
	const name = $< HTMLInputElement >( 'name' );
	const badge = $< HTMLInputElement >( 'badge' );
	const js = $< HTMLTextAreaElement >( 'js' );
	const pollInterval = $< HTMLSelectElement >( 'poll-interval' );

	const data = await api.get();
	if ( ! data ) {
		api.cancel();
		return;
	}
	$( 'heading' ).textContent = `Edit ${ data.typeLabel }`;
	name.value = data.name;
	badge.checked = data.badge;
	badge.disabled = ! data.supportsBadge;
	$( 'badge-note' ).hidden = data.supportsBadge;
	js.value = data.js;
	const editor = ( window as unknown as { TuttiboxCodeEditor: { create: ( textarea: HTMLTextAreaElement, label: string ) => CodeEditor } } )
		.TuttiboxCodeEditor.create( js, 'Custom JavaScript' );
	for ( const seconds of data.pollIntervals ) {
		const option = document.createElement( 'option' );
		option.value = String( seconds );
		option.textContent = seconds === 0 ? 'Off' : `Every ${ seconds } seconds`;
		pollInterval.append( option );
	}
	pollInterval.value = String( data.pollInterval );
	pollInterval.disabled = ! data.supportsBadge;
	name.focus();

	form.addEventListener( 'submit', ( event ) => {
		event.preventDefault();
		api.save( {
			name: name.value,
			badge: badge.checked,
			js: editor.getValue(),
			pollInterval: Number( pollInterval.value ),
		} );
	} );
	$( 'cancel' ).addEventListener( 'click', () => api.cancel() );
	document.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			api.cancel();
		}
	} );
} )();
