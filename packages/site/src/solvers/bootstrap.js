// Loaded by prepareSolverWorker as a classic Web Worker via a Vite-managed asset URL.
// Its first message supplies the bundled solver module URL. Load Z3's unbundled
// Emscripten script with importScripts, then dynamically import that solver module.
// Z3's browser/thread-loading guidance explains some of the magic strings in this code:
// https://github.com/Z3Prover/z3/blob/master/src/api/js/PUBLISHED_README.md#using
let runtime;
function initializationFailed(error) {
	// Initialization may have spawned threads before rejecting its promise.
	if (runtime && runtime.PThread) {
		runtime.PThread.terminateAllThreads();
		if (runtime.async_cancel) runtime.async_cancel(error);
	}
	self.postMessage({
		type: 'error',
		message:
			error && typeof error.message === 'string' ? error.message : '',
		stage: 'runtime',
	});
}
self.addEventListener('error', (event) => {
	event.preventDefault();
	initializationFailed(event.error || new Error(event.message));
});
self.onmessage = async ({ data }) => {
	try {
		self.global = self;
		const scriptUrl = new URL('z3-built.js', data.z3AssetBase).href;
		importScripts(scriptUrl);
		const initialize = self.initZ3;
		self.initZ3 = (overrides) => {
			runtime = {
				...overrides,
				mainScriptUrlOrBlob: scriptUrl,
				locateFile: (path) => new URL(path, data.z3AssetBase).href,
			};
			return initialize(runtime);
		};
		await import(data.moduleUrl);
		self.postMessage({ type: 'ready' });
	} catch (error) {
		initializationFailed(error);
	}
};
