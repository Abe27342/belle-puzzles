import { init } from 'z3-solver';
import { killThreads } from 'z3-solver/build/kill-threads.js';

export * from 'z3-solver';
export const z3 = await init();

/** Only the runtime owner may shut down threads, including an in-flight check. */
export function shutdownSolverRuntime(): Promise<void> {
	return killThreads(z3.em);
}
