import {
	CavePuzzle,
	HashiPuzzle,
	MasyuPuzzle,
	ShingokiPuzzle,
	SlitherlinkPuzzle,
	SudokuPuzzle,
	SolverSession,
	renderCartesianGrid,
	shutdownSolverRuntime,
	type CartesianGridPuzzle,
} from '@belle-puzzles/solver';
import type { SolverRequest, SolverResponse } from './protocol';
import { errorMessage, type SolverErrorStage } from './errors';

const parsers = {
	sudoku: SudokuPuzzle,
	masyu: MasyuPuzzle,
	shingoki: ShingokiPuzzle,
	slitherlink: SlitherlinkPuzzle,
	cave: CavePuzzle,
	hashi: HashiPuzzle,
};

let puzzle: CartesianGridPuzzle<unknown>;
let session: SolverSession<unknown>;
let busy = false;
let disposing = false;

function send(response: SolverResponse) {
	self.postMessage(response);
}

self.onmessage = async ({ data }: MessageEvent<SolverRequest>) => {
	if (data.type === 'dispose') {
		disposing = true;
		try {
			await shutdownSolverRuntime();
			send({ type: 'disposed' });
		} catch (error) {
			send({
				type: 'error',
				message: errorMessage(error),
				stage: 'cleanup',
			});
		}
		return;
	}
	let stage: SolverErrorStage = 'solve';
	try {
		if (disposing || busy) {
			throw new Error('The solver is not available for another request.');
		}
		busy = true;
		if (data.type === 'start') {
			stage = 'parse';
			puzzle = parsers[data.puzzleType].fromText(data.text);
			stage = 'build';
			session = new SolverSession(puzzle);
		}
		if (!session) {
			throw new Error(
				'Start a puzzle before requesting another solution.'
			);
		}
		stage = 'solve';
		const result = await session.nextSolution();
		if (!disposing) {
			stage = 'render';
			send(
				result.status === 'sat'
					? {
							type: 'solution',
							output: renderCartesianGrid(
								puzzle.grid,
								result.output,
								puzzle.renderOptions
							),
					  }
					: { type: 'terminal', status: result.status }
			);
		}
	} catch (error) {
		if (!disposing) {
			send({
				type: 'error',
				message: errorMessage(error),
				stage,
			});
		}
	} finally {
		busy = false;
	}
};
