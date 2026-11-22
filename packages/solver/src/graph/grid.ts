/**
 * Map-like interface for a grid structure storing values, keyed on some coordinate.
 */
export interface GridData<TCoord, T> {
	get(coord: TCoord): T;

	set(coord: TCoord, value: T): void;

	entries(): Iterable<[TCoord, T]>;

	values(): Iterable<T>;
}
/**
 * Materialized representation of a planar graph whose vertices, edges, and faces are expressed in some coordinate system.
 *
 * Implementations should provide stable object identities for entities within the graph. This enables keying maps and sets by those entities.
 */
export interface PlanarGraph<TCoord> {
	vertices(): Iterable<Vertex<TCoord>>;
	edges(): Iterable<Edge<TCoord>>;
	// directedEdges: Iterable<DirectedEdge<TCoord>>;
	// faces: Iterable<Face<TCoord>>;
}

export interface HasNeighbors<T extends HasNeighbors<T>> {
	/**
	 * Adjacent entities of the same type.
	 */
	neighbors(): Iterable<T>;
}

export interface Vertex<TCoord> extends HasNeighbors<Vertex<TCoord>> {
	coord: TCoord;

	incidentEdges(): Iterable<Edge<TCoord>>;
	// faces: Iterable<Face<TCoord>>;
}

/**
 * Represents an undirected edge in a planar graph.
 */
export interface Edge<TCoord> extends HasNeighbors<Edge<TCoord>> {
	vertices: [Vertex<TCoord>, Vertex<TCoord>];
	/**
	 * Faces incident to this edge (i.e. the faces that have this edge as part of their boundary).
	 */
	// faces: Iterable<Face<TCoord>>;
}

/**
 * Represents a directed edge in a planar graph.
 */
export interface DirectedEdge<TCoord> {
	from: Vertex<TCoord>;
	to: Vertex<TCoord>;
}

export interface Face<TCoord> extends HasNeighbors<Face<TCoord>> {
	/**
	 * Edges incident to this face (i.e. its boundary)
	 */
	incidentEdges(): Iterable<Edge<TCoord>>;
	/**
	 * Vertices incident to this face (i.e. its boundary)
	 */
	incidentVertices(): Iterable<Vertex<TCoord>>;
}
