import * as React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { isPuzzleType, puzzleTypes } from '@belle-puzzles/solver';
import {
	createSolverClient,
	prepareSolverWorker,
	type PreparedSolverWorker,
	type SolverClient,
} from './client';
import { formatSolverError } from './errors';
import { SolverDivider } from './solverDivider';
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
	const [expanded, setExpanded] = React.useState(true);
	const [search, setSearch] = React.useState('');
	const matches = Object.entries(puzzleTypes)
		.filter(([, { name }]) =>
			name.toLowerCase().includes(search.trim().toLowerCase())
		)
		.sort(([, left], [, right]) => left.name.localeCompare(right.name));
	return (
		<aside
			className={`solver-menu${expanded ? '' : ' solver-menu-collapsed'}`}
		>
			<div className="solver-menu-heading">
				{expanded && <h2>Puzzles</h2>}
				<button
					type="button"
					aria-label={
						expanded ? 'Collapse puzzle menu' : 'Expand puzzle menu'
					}
					aria-expanded={expanded}
					aria-controls="solver-menu-content"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? '<' : '>'}
				</button>
			</div>
			<div id="solver-menu-content" hidden={!expanded}>
				<div className="solver-menu-search">
					<label htmlFor="puzzle-search">Search puzzles</label>
					<input
						id="puzzle-search"
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Puzzle name"
					/>
				</div>
				<nav aria-label="Puzzle solvers">
					<ul>
						{matches.map(([type, { name }]) => (
							<li key={type}>
								<NavLink to={`/solvers/${type}`}>
									{name}
								</NavLink>
							</li>
						))}
					</ul>
				</nav>
				{matches.length === 0 && (
					<p>
						No matching puzzles. Try another name or clear the
						search.
					</p>
				)}
			</div>
		</aside>
	);
}

export function SolverRoute() {
	const { puzzleType } = useParams();
	const prepared = React.useRef<PreparedSolverWorker>();
	const stopPreparing = React.useCallback(() => {
		prepared.current?.dispose();
		prepared.current = undefined;
	}, []);
	React.useEffect(() => {
		if (puzzleType && isPuzzleType(puzzleType)) {
			if (!prepared.current) {
				try {
					prepared.current = prepareSolverWorker();
				} catch (error) {
					console.error(error);
				}
			}
		} else {
			stopPreparing();
		}
	}, [puzzleType, stopPreparing]);
	React.useEffect(() => {
		window.addEventListener('pagehide', stopPreparing);
		return () => {
			window.removeEventListener('pagehide', stopPreparing);
			stopPreparing();
		};
	}, [stopPreparing]);
	const createClient = React.useCallback<typeof createSolverClient>(
		(type, text, onResponse) => {
			const idle = prepared.current;
			prepared.current = undefined;
			return idle
				? idle.start(type, text, onResponse)
				: createSolverClient(type, text, onResponse);
		},
		[]
	);
	const [inputShare, setInputShare] = React.useState(50);
	const style: React.CSSProperties & {
		'--solver-input-share': string;
		'--solver-output-share': string;
	} = {
		'--solver-input-share': `${inputShare}fr`,
		'--solver-output-share': `${100 - inputShare}fr`,
	};
	const divider = (
		<SolverDivider value={inputShare} onChange={setInputShare} />
	);
	return (
		<main className="solver-area" style={style}>
			<SolverNavigation />
			{puzzleType && isPuzzleType(puzzleType) ? (
				<SolverPage
					key={puzzleType}
					puzzleType={puzzleType}
					divider={divider}
					createClient={createClient}
				/>
			) : (
				<>
					<section id="solver-input-pane" className="solver-input">
						<h1>Logic Puzzle Solvers</h1>
						<p>
							No login required. Puzzles are solved locally in
							your browser.
						</p>
						<p>
							{puzzleType
								? 'Unknown puzzle type. Choose a puzzle from the menu.'
								: 'Choose a puzzle from the menu to get started.'}
						</p>
					</section>
					{divider}
				</>
			)}
			{(!puzzleType || !isPuzzleType(puzzleType)) && (
				<section
					id="solver-output-pane"
					className="solver-output"
					aria-labelledby="solutions-title"
				>
					<h2 id="solutions-title">Solutions</h2>
					<p>
						Select a puzzle to enter its clues and see solutions
						here.
					</p>
				</section>
			)}
		</main>
	);
}

export function SolverPage({
	puzzleType,
	divider,
	createClient = createSolverClient,
}: {
	puzzleType: string;
	divider?: React.ReactNode;
	createClient?: typeof createSolverClient;
}) {
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
			client.current = createClient(puzzleType, text, (response) => {
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
						setMessage(
							'This puzzle has no solutions. Check that the clues are correct and do not contradict each other.'
						);
					} else if (probing) {
						setUniqueness('unique');
					} else {
						setMessage('No more solutions.');
					}
				} else if (response.type === 'error') {
					reportError(response.message);
				}
			});
		} catch (error) {
			reportError(formatSolverError(error, 'runtime', puzzleType));
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
			console.log(error);
			reportError(formatSolverError(error, 'solve', puzzleType));
		}
	};
	const busy =
		phase === 'first' || phase === 'uniqueness' || phase === 'next';
	return (
		<>
			<section
				id="solver-input-pane"
				className="solver-input"
				aria-labelledby="puzzle-title"
			>
				<h1 id="puzzle-title">{definition.name}</h1>
				<p id="input-help">
					{definition.instructions} Use a dot (".") or single space ("
					") for an empty position. Rows must have equal lengths.
				</p>
				<form onSubmit={start}>
					<label htmlFor="puzzle-input">Puzzle text</label>
					<textarea
						id="puzzle-input"
						value={text}
						placeholder={`Example:\n\n${definition.example}`}
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
			</section>
			{divider}
			<section
				id="solver-output-pane"
				className="solver-output"
				aria-labelledby="solutions-title"
			>
				<h2 id="solutions-title">Solutions</h2>
				<div role="status" aria-live="polite">
					{phase === 'idle' &&
						solutions.length === 0 &&
						!message &&
						!error && (
							<p>
								Enter a puzzle and choose Solve to see its
								solutions.
							</p>
						)}
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
				<div>
					{solutions.map((output, index) => (
						<article key={index}>
							<h3>Solution {index + 1}</h3>
							<pre aria-label={`Solution ${index + 1} grid`}>
								{output}
							</pre>
						</article>
					))}
				</div>
			</section>
		</>
	);
}
