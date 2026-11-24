import * as React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { isPuzzleType, puzzleTypes, type PuzzleType } from './catalog';
import { createSolverClient, type SolverClient } from './client';
import './solvers.css';

type Phase = 'idle' | 'first' | 'uniqueness' | 'ready' | 'next' | 'done';
type Uniqueness =
	| 'unchecked'
	| 'checking'
	| 'unique'
	| 'multiple'
	| 'unknown'
	| 'cancelled';

const uniquenessLabels: Record<Uniqueness, string> = {
	unchecked: '',
	checking: 'Checking whether the solution is unique...',
	unique: 'This solution is unique.',
	multiple: 'This puzzle has multiple solutions.',
	unknown: 'The solver could not determine whether this solution is unique.',
	cancelled: 'Uniqueness check cancelled; uniqueness is not known.',
};

export function SolverNavigation() {
	return (
		<nav className="solver-navigation" aria-label="Puzzle solvers">
			{Object.entries(puzzleTypes).map(([type, { name }]) => (
				<NavLink key={type} to={`/solvers/${type}`}>
					{name}
				</NavLink>
			))}
		</nav>
	);
}

export function SolverRoute() {
	const { puzzleType } = useParams();
	return (
		<div className="solver-area">
			<SolverNavigation />
			{puzzleType && isPuzzleType(puzzleType) ? (
				<SolverPage key={puzzleType} puzzleType={puzzleType} />
			) : (
				<main className="solver-page">
					<h1>Logic Puzzle Solvers</h1>
					<p>
						{puzzleType
							? 'Unknown puzzle type. Choose a solver above.'
							: 'Choose a solver above to get started. No login is required.'}
					</p>
				</main>
			)}
		</div>
	);
}

export function SolverPage({ puzzleType }: { puzzleType: PuzzleType }) {
	const definition = puzzleTypes[puzzleType];
	const [text, setText] = React.useState('');
	const [solutions, setSolutions] = React.useState<string[]>([]);
	const [cachedSecond, setCachedSecond] = React.useState<string | null>(null);
	const [phase, setPhase] = React.useState<Phase>('idle');
	const [uniqueness, setUniqueness] = React.useState<Uniqueness>('unchecked');
	const [message, setMessage] = React.useState('');
	const [error, setError] = React.useState('');
	const client = React.useRef<SolverClient>();
	const generation = React.useRef(0);
	const stop = React.useCallback(() => {
		generation.current++;
		client.current?.dispose();
		client.current = undefined;
	}, []);
	React.useEffect(() => {
		const onPageHide = () => {
			stop();
			setCachedSecond(null);
			setPhase('idle');
			setUniqueness((value) =>
				value === 'checking' ? 'cancelled' : value
			);
		};
		window.addEventListener('pagehide', onPageHide);
		return () => {
			window.removeEventListener('pagehide', onPageHide);
			stop();
		};
	}, [stop]);

	const changeInput = (value: string) => {
		stop();
		setText(value);
		setSolutions([]);
		setCachedSecond(null);
		setPhase('idle');
		setUniqueness('unchecked');
		setMessage('');
		setError('');
	};
	const reportError = (message: string) => {
		stop();
		setError(message);
		setPhase('done');
		setUniqueness((value) => (value === 'checking' ? 'unknown' : value));
	};
	const start = (event: React.FormEvent) => {
		event.preventDefault();
		stop();
		const id = generation.current;
		setSolutions([]);
		setCachedSecond(null);
		setUniqueness('unchecked');
		setMessage('');
		setError('');
		setPhase('first');
		let receivedFirst = false;
		let probing = false;
		try {
			client.current = createSolverClient(
				puzzleType,
				text,
				(response) => {
					if (generation.current !== id) return;
					if (response.type === 'solution') {
						if (!receivedFirst) {
							receivedFirst = true;
							probing = true;
							setSolutions([response.output]);
							setPhase('uniqueness');
							setUniqueness('checking');
							client.current.next();
						} else if (probing) {
							probing = false;
							setCachedSecond(response.output);
							setUniqueness('multiple');
							setPhase('ready');
						} else {
							setSolutions((previous) => [
								...previous,
								response.output,
							]);
							setPhase('ready');
						}
					} else if (response.type === 'terminal') {
						stop();
						setPhase('done');
						if (response.status === 'unknown') {
							if (probing) setUniqueness('unknown');
							setMessage(
								'The solver returned unknown. This does not prove that no further solutions exist.'
							);
						} else if (!receivedFirst) {
							setMessage('This puzzle has no solutions.');
						} else if (probing) {
							setUniqueness('unique');
						} else {
							setMessage('No more solutions.');
						}
					} else if (response.type === 'error') {
						reportError(response.message);
					}
				}
			);
		} catch (error) {
			reportError(error instanceof Error ? error.message : String(error));
		}
	};
	const next = () => {
		if (cachedSecond !== null) {
			setSolutions((previous) => [...previous, cachedSecond]);
			setCachedSecond(null);
			return;
		}
		setPhase('next');
		try {
			client.current.next();
		} catch (error) {
			reportError(error instanceof Error ? error.message : String(error));
		}
	};
	const busy =
		phase === 'first' || phase === 'uniqueness' || phase === 'next';
	return (
		<main className="solver-page">
			<h1>{definition.name} Solver</h1>
			<p>
				No login required. Puzzles are solved locally in your browser.
			</p>
			<p id="input-help">
				{definition.instructions} Use a dot (.) for an empty position.
				Rows must have equal lengths; spaces also count as empty
				positions.
			</p>
			<form onSubmit={start}>
				<label htmlFor="puzzle-input">Puzzle text</label>
				<textarea
					id="puzzle-input"
					value={text}
					onChange={(event) => changeInput(event.target.value)}
					aria-describedby="input-help"
					spellCheck={false}
					rows={12}
					required
				/>
				<div className="solver-actions">
					<button
						type="button"
						onClick={() => changeInput(definition.example)}
					>
						Load example
					</button>
					<button type="submit" disabled={busy || !text.trim()}>
						Solve
					</button>
					<button
						type="button"
						disabled={phase !== 'ready'}
						onClick={next}
					>
						Find next solution
					</button>
					<button
						type="button"
						disabled={!client.current}
						onClick={() => {
							stop();
							setCachedSecond(null);
							setPhase('idle');
							setUniqueness((value) =>
								value === 'checking' ? 'cancelled' : value
							);
							setMessage(
								'Solving cancelled. Displayed solutions are preserved; solve again to start a new session.'
							);
						}}
					>
						Cancel
					</button>
				</div>
			</form>
			<div role="status" aria-live="polite">
				{phase === 'first' && (
					<p>Loading solver and finding the first solution...</p>
				)}
				{phase === 'next' && <p>Finding the next solution...</p>}
				{uniquenessLabels[uniqueness] && (
					<p>{uniquenessLabels[uniqueness]}</p>
				)}
				{message && <p>{message}</p>}
			</div>
			{error && <p role="alert">{error}</p>}
			<section aria-label="Solutions">
				{solutions.map((output, index) => (
					<article key={index}>
						<h2>Solution {index + 1}</h2>
						<pre aria-label={`Solution ${index + 1} grid`}>
							{output}
						</pre>
					</article>
				))}
			</section>
		</main>
	);
}
