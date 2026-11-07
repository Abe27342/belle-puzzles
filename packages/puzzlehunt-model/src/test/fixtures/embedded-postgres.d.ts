// TODO: This forwarding is only necessary due to puzzlehunt-model's 'moduleResolution' settings.
// Upgrading to node16 / nodenext should allow this file to be deleted.
declare module 'embedded-postgres' {
	export { default } from 'embedded-postgres/dist/index.js';
}
