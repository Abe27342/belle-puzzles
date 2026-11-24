import * as React from 'react';
import './solvers.css';

export function SolverPageSkeleton() {
	return (
		<main className="solver-area solver-page-skeleton" aria-busy="true">
			<aside className="solver-menu" aria-hidden="true">
				<span className="solver-skeleton-heading" />
				<span className="solver-skeleton-search" />
				{Array.from({ length: 6 }, (_, index) => (
					<span className="solver-skeleton-line" key={index} />
				))}
			</aside>
			<section className="solver-input" aria-hidden="true">
				<span className="solver-skeleton-heading" />
				<span className="solver-skeleton-line" />
				<span className="solver-skeleton-line" />
				<span className="solver-skeleton-textarea" />
				<div className="solver-actions">
					<span className="solver-skeleton-button" />
					<span className="solver-skeleton-button" />
				</div>
			</section>
			<div className="solver-divider" aria-hidden="true" />
			<section
				className="solver-output"
				aria-labelledby="solutions-title"
			>
				<h2 id="solutions-title">Solutions</h2>
			</section>
			<p role="status" className="solver-visually-hidden">
				Loading solver page...
			</p>
		</main>
	);
}
