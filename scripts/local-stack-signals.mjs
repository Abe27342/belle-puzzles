// Windows cannot deliver SIGTERM to Node gracefully. Only launcher-owned children
// use this preload; IPC invokes their existing shutdown handlers instead.
let stopping = false;
function stop() {
	if (stopping) return;
	stopping = true;
	if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
	else process.exitCode = 0;
	if (process.connected) process.disconnect();
}
process.on('message', (message) => {
	if (message === 'local-stack-stop') stop();
});
process.once('disconnect', stop);
process.channel?.unref();
