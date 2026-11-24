// Messages exchanged via postMessage between the main-page solver client and
// its dedicated Web Worker: requests go to the worker, responses return to the page.
import type { PuzzleType } from '@belle-puzzles/solver';
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
