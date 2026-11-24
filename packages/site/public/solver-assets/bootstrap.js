// Keep Emscripten's script unbundled and in a classic worker, as Z3 requires.
let runtime;
function initializationFailed(error) {
	// Initialization may have spawned threads before rejecting its promise.
	if (runtime && runtime.PThread) {
		runtime.PThread.terminateAllThreads();
		if (runtime.async_cancel) runtime.async_cancel(error);
	}
	self.postMessage({
		type: 'error',
		message: error instanceof Error ? error.message : String(error),
	});
}
self.addEventListener('error', (event) => {
	event.preventDefault();
	initializationFailed(event.error || new Error(event.message));
});
self.onmessage = async ({ data }) => {
	try {
		self.global = self;
		importScripts('/solver-assets/z3-built.js');
		const initialize = self.initZ3;
		self.initZ3 = (overrides) => {
			runtime = {
				...overrides,
				mainScriptUrlOrBlob: '/solver-assets/z3-built.js',
			};
			return initialize(runtime);
		};
		await import(data.moduleUrl);
		self.postMessage({ type: 'ready' });
	} catch (error) {
		initializationFailed(error);
	}
};
