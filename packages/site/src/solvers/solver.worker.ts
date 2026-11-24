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
				message: `Z3 cleanup failed: ${String(error)}`,
			});
		}
		return;
	}
	try {
		if (disposing || busy) {
			throw new Error('The solver is not available for another request.');
		}
		busy = true;
		if (data.type === 'start') {
			puzzle = parsers[data.puzzleType].fromText(data.text);
			session = new SolverSession(puzzle);
		}
		if (!session) {
			throw new Error(
				'Start a puzzle before requesting another solution.'
			);
		}
		const result = await session.nextSolution();
		if (!disposing) {
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
				message: error instanceof Error ? error.message : String(error),
			});
		}
	} finally {
		busy = false;
	}
};
