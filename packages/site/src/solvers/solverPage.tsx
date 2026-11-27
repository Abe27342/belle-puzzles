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
import { EmptyGridGenerator } from './emptyGridGenerator';
import { puzzleRouteName, puzzleTypeFromRouteParam } from './routes';
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
	multiple: '',
	unknown: 'The solver could not determine whether this solution is unique.',
	cancelled: 'Uniqueness check cancelled; uniqueness is not known.',
};

export function SolverNavigation() {
	const [expanded, setExpanded] = React.useState(true);
	const [mobile, setMobile] = React.useState(
		() => window.matchMedia('(max-width: 640px)').matches
	);
	const [mobileOpen, setMobileOpen] = React.useState(false);
	const [search, setSearch] = React.useState('');
	const menu = React.useRef<HTMLElement>(null);
	const trigger = React.useRef<HTMLButtonElement>(null);
	const searchInput = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		const media = window.matchMedia('(max-width: 640px)');
		const onChange = (event: MediaQueryListEvent) => {
			setMobile(event.matches);
			setMobileOpen(false);
		};
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	}, []);
	React.useEffect(() => {
		if (!mobile || !mobileOpen) return;
		searchInput.current?.focus();
		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!menu.current?.contains(event.target)
			) {
				setMobileOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				setMobileOpen(false);
				trigger.current?.focus();
			}
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [mobile, mobileOpen]);
	const open = mobile ? mobileOpen : expanded;
	const toggleLabel = mobile
		? mobileOpen
			? 'Close puzzle menu'
			: 'Choose puzzle'
		: expanded
		? 'Collapse puzzle menu'
		: 'Expand puzzle menu';
	const matches = Object.entries(puzzleTypes)
		.filter(([, { name }]) =>
			name.toLowerCase().includes(search.trim().toLowerCase())
		)
		.sort(([, left], [, right]) => left.name.localeCompare(right.name));
	return (
		<aside
			ref={menu}
			className={`solver-menu${
				!mobile && !expanded ? ' solver-menu-collapsed' : ''
			}`}
			onBlur={(event) => {
				if (
					mobile &&
					event.relatedTarget instanceof Node &&
					!event.currentTarget.contains(event.relatedTarget)
				) {
					setMobileOpen(false);
				}
			}}
		>
			<div className="solver-menu-heading">
				{!mobile && expanded && <h2>Puzzles</h2>}
				<button
					ref={trigger}
					type="button"
					className="solver-menu-toggle"
					aria-label={toggleLabel}
					title={toggleLabel}
					aria-expanded={open}
					aria-haspopup={mobile ? 'dialog' : undefined}
					aria-controls="solver-menu-content"
					onClick={() =>
						mobile
							? setMobileOpen((value) => !value)
							: setExpanded((value) => !value)
					}
				>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						focusable="false"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						{mobile ? (
							<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
						) : (
							<>
								<rect
									x="3"
									y="4"
									width="18"
									height="16"
									rx="2"
								/>
								<path d="M9 4v16" />
								<path
									d={
										open
											? 'M15 9l-3 3 3 3'
											: 'M12 9l3 3-3 3'
									}
								/>
							</>
						)}
					</svg>
					{mobile && (
						<>
							<span>Puzzles</span>
							<svg
								className="solver-menu-caret"
								viewBox="0 0 24 24"
								aria-hidden="true"
								focusable="false"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path
									d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
								/>
							</svg>
						</>
					)}
				</button>
			</div>
			<div
				id="solver-menu-content"
				hidden={!open}
				role={mobile ? 'dialog' : undefined}
				aria-label={mobile ? 'Choose a puzzle' : undefined}
			>
				<div className="solver-menu-search">
					<label htmlFor="puzzle-search">Search puzzles</label>
					<input
						ref={searchInput}
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
								<NavLink
									to={`/solvers/${puzzleRouteName(type)}`}
									onClick={() => {
										if (mobile) {
											setMobileOpen(false);
											trigger.current?.focus();
										}
									}}
								>
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
	const { puzzleType: puzzleRouteParam } = useParams();
	const puzzleType = puzzleRouteParam
		? puzzleTypeFromRouteParam(puzzleRouteParam)
		: undefined;
	const [text, setText] = React.useState('');
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
					initialText={text}
					onTextChange={setText}
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
							{puzzleRouteParam
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

function ElapsedText() {
	const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
	React.useEffect(() => {
		const startedAt = Date.now();
		const interval = window.setInterval(() => {
			setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
		}, 1000);
		return () => window.clearInterval(interval);
	}, []);
	return (
		<>
			({elapsedSeconds} {elapsedSeconds === 1 ? 'second' : 'seconds'}{' '}
			elapsed)
		</>
	);
}

export function SolverPage({
	puzzleType,
	initialText = '',
	onTextChange,
	divider,
	createClient = createSolverClient,
}: {
	puzzleType: string;
	initialText?: string;
	onTextChange?: (text: string) => void;
	divider?: React.ReactNode;
	createClient?: typeof createSolverClient;
}) {
	const definition = puzzleTypes[puzzleType];
	const [text, setText] = React.useState(initialText);
	const [solutions, setSolutions] = React.useState<string[]>([]);
	const [cachedSecond, setCachedSecond] = React.useState<string | null>(null);
	const [phase, setPhase] = React.useState<Phase>('idle');
	const [uniqueness, setUniqueness] = React.useState<Uniqueness>('unchecked');
	const [exhausted, setExhausted] = React.useState(false);
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
		onTextChange?.(value);
		setSolutions([]);
		setCachedSecond(null);
		setPhase('idle');
		setUniqueness('unchecked');
		setExhausted(false);
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
		setExhausted(false);
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
					setExhausted(response.status === 'unsat' && receivedFirst);
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
					{definition.instructions}
					{definition.gridFormat === 'double-resolution'
						? ' Enter the puzzle in a doubled-resolution grid. Use "#" for empty faces, "-" for empty horizontal edges, "|" for empty vertical edges, and "·" or "." for empty vertices. Whitespace other than line endings is ignored.'
						: ' Use a dot (".") for an empty position and "#" for dark-square givens where supported. Whitespace other than line endings is ignored. Enclose multi-digit clues in [], (), or {} (for example, [10]). Rows must have equal numbers of cells.'}
				</p>
				<form onSubmit={start}>
					<label htmlFor="puzzle-input">Puzzle text</label>
					<textarea
						id="puzzle-input"
						value={text}
						placeholder={`${definition.example}\n\n(example)`}
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
					{definition.gridFormat === 'double-resolution' && (
						<EmptyGridGenerator />
					)}
				</form>
			</section>
			{divider}
			<section
				id="solver-output-pane"
				className="solver-output"
				aria-labelledby="solutions-title"
			>
				<h2 id="solutions-title">Solutions</h2>
				<div>
					{solutions.map((output, index) => (
						<article key={index}>
							<h3>Solution {index + 1}</h3>
							<pre aria-label={`Solution ${index + 1} grid`}>
								{output}
							</pre>
						</article>
					))}
					{uniqueness === 'multiple' && !exhausted && (
						<p className="solver-solution-more">
							This puzzle has multiple solutions.{' '}
							<button
								type="button"
								className="solver-next-link"
								aria-label="Find another solution"
								disabled={phase !== 'ready'}
								onClick={next}
							>
								Find next...
							</button>
						</p>
					)}
				</div>
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
						<p>
							Solving... <ElapsedText key={phase} />
						</p>
					)}
					{phase === 'next' && (
						<p>
							Finding the next solution...{' '}
							<ElapsedText key={phase} />
						</p>
					)}
					{uniquenessLabels[uniqueness] && (
						<p>
							{uniquenessLabels[uniqueness]}
							{phase === 'uniqueness' && (
								<>
									{' '}
									<ElapsedText key={phase} />
								</>
							)}
						</p>
					)}
					{message && <p>{message}</p>}
				</div>
				{error && <p role="alert">{error}</p>}
			</section>
		</>
	);
}
