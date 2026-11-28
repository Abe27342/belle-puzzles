import { expect, it } from 'vitest';
import { DoubledGrid, Point, Vector } from '../lib/graph/cartesian-grid.js';
import { CartesianGridGraph } from '../lib/graph/cartesian-grid.js';

it('provides named point and vector components', () => {
	const point = new Point(2, 3);
	const vector = new Vector(-1, 4);

	expect(point.x).toBe(2);
	expect(point.y).toBe(3);
	expect([...point]).toEqual([2, 3]);
	expect(point.add(vector)).toEqual(new Point(1, 7));
	expect(point.subtract(new Point(1, 1))).toEqual(new Vector(1, 2));

	expect(vector.dx).toBe(-1);
	expect(vector.dy).toBe(4);
	expect([...vector]).toEqual([-1, 4]);
});

it('reports face and vertex dimensions separately', () => {
	const faceGrid = new CartesianGridGraph({
		faceWidth: 4,
		faceHeight: 3,
	});
	expect(faceGrid.faceWidth).toBe(4);
	expect(faceGrid.faceHeight).toBe(3);
	expect(faceGrid.vertexWidth).toBe(5);
	expect(faceGrid.vertexHeight).toBe(4);

	const vertexGrid = new CartesianGridGraph({
		vertexWidth: 5,
		vertexHeight: 4,
	});
	expect(vertexGrid.vertexWidth).toBe(5);
	expect(vertexGrid.vertexHeight).toBe(4);
	expect(vertexGrid.faceWidth).toBe(4);
	expect(vertexGrid.faceHeight).toBe(3);
});

it('uses expanded centers for vertices, edges, and faces', () => {
	const grid = new CartesianGridGraph({
		faceWidth: 2,
		faceHeight: 2,
	});

	const topLeftVertex = grid.getVertex(DoubledGrid.fromVertexIndices([0, 0]));
	const bottomRightVertex = grid.getVertex(
		DoubledGrid.fromVertexIndices([2, 2])
	);
	const topEdge = grid.getEdge(topLeftVertex, topLeftVertex.right);
	const leftEdge = grid.getEdge(topLeftVertex, topLeftVertex.down);
	const face = grid.getFace(DoubledGrid.fromFaceIndices([0, 0]));

	expect(topLeftVertex.center).toEqual(new Point(0, 0));
	expect(bottomRightVertex.center).toEqual(new Point(4, 4));
	expect(topEdge.center).toEqual(new Point(1, 0));
	expect(leftEdge.center).toEqual(new Point(0, 1));
	expect(face.center).toEqual(new Point(1, 1));
	expect(grid.getFromCenter(new Point(0, 0))).toBe(topLeftVertex);
	expect(grid.getFromCenter(new Point(1, 0))).toBe(topEdge);
	expect(grid.getFromCenter(new Point(1, 1))).toBe(face);
});
