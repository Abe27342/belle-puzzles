/**
 * Map-like interface for a grid structure storing values, keyed on some coordinate.
 */
export interface GridData<TCoord, T> {
	get(coord: TCoord): T;

	set(coord: TCoord, value: T): void;

	entries(): Iterable<[TCoord, T]>;

	values(): Iterable<T>;
}

export interface ConcreteGraphTypes {
	coord: unknown;
	vertex: unknown;
	edge: unknown;
	face: unknown;
}

/**
 * Materialized representation of a planar graph whose vertices, edges, and faces are expressed in some coordinate system.
 *
 * Implementations should provide stable object identities for entities within the graph. This enables keying maps and sets by those entities.
 *
 * @remarks
 * The type parameter here allows recursive traversal through the graph while maintaining type safety with whatever classes implementers provide for vertices, edges, and faces.
 *
 * It should be an object that "looks up" the concrete types for coordinates, vertices, edges, and faces within the graph.
 */
export interface PlanarGraph<TConcrete extends ConcreteGraphTypes> {
	vertices(): Iterable<TConcrete['vertex']>;
	edges(): Iterable<TConcrete['edge']>;
	// directedEdges: Iterable<DirectedEdge<TConcrete>>;
	faces(): Iterable<TConcrete['face']>;
}

export interface HasNeighbors<T> {
	/**
	 * Adjacent entities of the same type.
	 */
	neighbors(): Iterable<T>;
}

export interface Vertex<TConcrete extends ConcreteGraphTypes>
	extends HasNeighbors<TConcrete['vertex']> {
	coord: TConcrete['coord'];

	incidentEdges(): Iterable<TConcrete['edge']>;
	// faces: Iterable<Face<TConcrete>>;
}

/**
 * Represents an undirected edge in a planar graph.
 */
export interface Edge<TConcrete extends ConcreteGraphTypes>
	extends HasNeighbors<TConcrete['edge']> {
	vertices: [TConcrete['vertex'], TConcrete['vertex']];
	/**
	 * Faces incident to this edge (i.e. the faces that have this edge as part of their boundary).
	 */
	// faces: Iterable<Face<TCoord>>;
}

/**
 * Represents a directed edge in a planar graph.
 */
export interface DirectedEdge<TConcrete extends ConcreteGraphTypes> {
	from: TConcrete['vertex'];
	to: TConcrete['vertex'];
}

export interface Face<TConcrete extends ConcreteGraphTypes>
	extends HasNeighbors<TConcrete['face']> {
	/**
	 * Edges incident to this face (i.e. its boundary)
	 */
	incidentEdges(): Iterable<TConcrete['edge']>;
	/**
	 * Vertices incident to this face (i.e. its boundary)
	 */
	incidentVertices(): Iterable<TConcrete['vertex']>;
}
