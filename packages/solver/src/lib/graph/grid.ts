export interface ConcreteGraphTypes<
	TConcrete extends ConcreteGraphTypes<TConcrete>
> {
	coord: unknown;
	vertex: Vertex<TConcrete>;
	directedEdge: DirectedEdge<TConcrete>;
	edge: Edge<TConcrete>;
	face: Face<TConcrete>;
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
export interface PlanarGraph<TConcrete extends ConcreteGraphTypes<TConcrete>> {
	vertices(): Iterable<TConcrete['vertex']>;
	directedEdges(): Iterable<TConcrete['directedEdge']>;
	edges(): Iterable<TConcrete['edge']>;
	faces(): Iterable<TConcrete['face']>;
}

export interface HasNeighbors<T> {
	/**
	 * Adjacent entities of the same type.
	 */
	neighbors(): Iterable<T>;
}

export interface Vertex<TConcrete extends ConcreteGraphTypes<TConcrete>>
	extends HasNeighbors<TConcrete['vertex']> {
	type: 'vertex';
	coord: TConcrete['coord'];

	incidentEdges(): Iterable<TConcrete['edge']>;

	/**
	 * Outgoing directed edges from this vertex.
	 */
	outgoingEdges(): Iterable<TConcrete['directedEdge']>;
	/**
	 * Incoming directed edges to this vertex.
	 */
	incomingEdges(): Iterable<TConcrete['directedEdge']>;
}

/**
 * Represents an undirected edge in a planar graph.
 */
export interface Edge<TConcrete extends ConcreteGraphTypes<TConcrete>>
	extends HasNeighbors<TConcrete['edge']> {
	type: 'edge';
	vertices: [TConcrete['vertex'], TConcrete['vertex']];
}

export interface DirectedEdge<TConcrete extends ConcreteGraphTypes<TConcrete>>
	extends HasNeighbors<TConcrete['directedEdge']> {
	type: 'directedEdge';

	from: TConcrete['vertex'];
	to: TConcrete['vertex'];

	/**
	 * Edges that are successors of this directed edge (i.e., edges that continue from the `to` vertex to an adjacent vertex)
	 */
	successors(): Iterable<TConcrete['directedEdge']>;

	/**
	 * Edges that are predecessors of this directed edge (i.e., edges that lead into the `from` vertex from an adjacent vertex)
	 */
	predecessors(): Iterable<TConcrete['directedEdge']>;

	/**
	 * Returns the directed edge with the `from` and `to` vertices swapped (i.e., the edge in the opposite direction).
	 */
	invert(): TConcrete['directedEdge'];
}

export interface Face<TConcrete extends ConcreteGraphTypes<TConcrete>>
	extends HasNeighbors<TConcrete['face']> {
	type: 'face';
	/**
	 * Edges incident to this face (i.e. its boundary)
	 */
	incidentEdges(): Iterable<TConcrete['edge']>;
	/**
	 * Vertices incident to this face (i.e. its boundary)
	 */
	incidentVertices(): Iterable<TConcrete['vertex']>;
}
