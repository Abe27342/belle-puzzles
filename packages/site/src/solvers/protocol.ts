import type { PuzzleType } from './catalog';
import type { SolverErrorStage } from './errors';

export type SolverRequest =
	| { type: 'start'; puzzleType: PuzzleType; text: string }
	| { type: 'next' }
	| { type: 'dispose' };

export type SolverResponse =
	| { type: 'ready' }
	| { type: 'solution'; output: string }
	| { type: 'terminal'; status: 'unsat' | 'unknown' }
	| { type: 'error'; message: string; stage?: SolverErrorStage }
	| { type: 'disposed' };
