import type { Grid } from '../grid/grid.js';

export interface Renderer<TCoord, T> {
	render(grid: Grid<TCoord, T>): void;
}
