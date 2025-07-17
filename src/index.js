const fs = require('fs');
const path = require('path');

/**
 * @class TinyGraphDB
 * @description
 *   A simple disk-backed graph store with cosine similarity search support.
 *   Internally maintains:
 *     - `nodes: Map<id, {id,name,metadata}>`
 *     - `relations: Map<id, {id,name,fromNodeId,toNodeId,metadata}>`
 *     - `nodeRelations: Map<nodeId, Set<relationId>>` for fast neighbor lookups.
 *
 * @param {string} [filePath='./graph_data.json']
 *   Filesystem path where graph JSON is persisted.
 */
class TinyGraphDB {
    constructor(filePath = './graph_data.json') {
        this.filePath = filePath;
        this.nodes = new Map(); // nodeId -> { id, name, metadata }
        this.relations = new Map(); // relationId -> { id, name, fromNodeId, toNodeId, metadata }
        this.nodeRelations = new Map(); // nodeId -> Set of relationIds
        this.idCounter = 0;

        this.loadFromFile();
    }

    /**
     * loadFromFile()
     * @description
     *   Reads the JSON file at `this.filePath` (if present) and restores
     *   `nodes`, `relations`, then rebuilds the `nodeRelations` index.
     *   Errors are caught and logged.
     * @returns {void}
     */
    loadFromFile() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

                // Restore nodes
                if (data.nodes) {
                    data.nodes.forEach(node => {
                        this.nodes.set(node.id, node);
                    });
                }

                // Restore relations
                if (data.relations) {
                    data.relations.forEach(relation => {
                        this.relations.set(relation.id, relation);
                    });
                }

                // Rebuild node-relations index
                this.rebuildNodeRelationsIndex();
            }
        } catch (error) {
            console.error('Error loading graph data:', error);
        }
    }

    /**
     * flushToDisk()
     * @description
     *   Serializes `nodes` + `relations` to JSON and writes to disk.
     *   Overwrites atomically, with errors logged to console.
     * @returns {void}
     */
    flushToDisk() {
        try {
            const data = {
                nodes: Array.from(this.nodes.values()),
                relations: Array.from(this.relations.values())
            };
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving graph data:', error);
        }
    }

    /**
     * rebuildNodeRelationsIndex()
     * @description
     *   Clears and rebuilds the node → relations map by:
     *     1. Initializing an empty Set for every node
     *     2. Iterating all relations and adding each `relation.id` to
     *        both its `fromNodeId` and `toNodeId` entry
     * @returns {void}
     */
    rebuildNodeRelationsIndex() {
        this.nodeRelations.clear();

        // 1. Ensure every node starts with an empty set
        this.nodes.forEach((_, nodeId) => {
            this.nodeRelations.set(nodeId, new Set());
        });

        // 2. Populate from relations
        this.relations.forEach(relation => {
            this.nodeRelations.get(relation.fromNodeId).add(relation.id);
            this.nodeRelations.get(relation.toNodeId).add(relation.id);
        });
    }

    /**
     * addNode(name, metadata)
     * @description
     *   Creates a new node with a UUID, stores it in `nodes`, and
     *   initializes its relation-set. Persists to disk.
     * @param {string} name – non-empty label for the node
     * @param {Object} [metadata={}] – arbitrary JSON-safe data
     * @returns {{id:string,name:string,metadata:Object}} the new node
     * @throws if name is empty or metadata not an object
     */
    addNode(name, metadata = {}, flush = true) {
        if (typeof name !== 'string' || name.trim() === '') {
            throw new Error('Node name must be a non-empty string');
        }
        if (typeof metadata !== 'object' || metadata === null) {
            throw new Error('Metadata must be an object');
        }

        const node = {
            id: this.generateId(),
            name,
            metadata: this._clone(metadata)
        };
        this.nodes.set(node.id, node);
        this.nodeRelations.set(node.id, new Set());
        if(flush) this.flushToDisk();
        return node;
    }

    /**
     * addRelation(name, fromNodeId, toNodeId, metadata)
     * @description
     *   Creates a new directed edge between two existing nodes, updates
     *   both ends in `nodeRelations`, and persists.
     * @param {string} name – label for the relation
     * @param {string} fromNodeId – source node UUID
     * @param {string} toNodeId – target node UUID
     * @param {Object} [metadata={}] – JSON-safe payload
     * @returns {{id:string,name:string,fromNodeId:string,toNodeId:string,metadata:Object}}
     * @throws if either nodeId doesn't exist
     */
    addRelation(name, fromNodeId, toNodeId, metadata = {}, flush = true) {
        if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) {
            throw new Error('Both nodes must exist before creating a relation');
        }

        const relation = {
            id: this.generateId(),
            name,
            fromNodeId,
            toNodeId,
            metadata: this._clone(metadata)
        };

        this.relations.set(relation.id, relation);
        this.nodeRelations.get(fromNodeId).add(relation.id);
        this.nodeRelations.get(toNodeId).add(relation.id);
        if(flush) this.flushToDisk();
        return relation;
    }

    /**
     * traverseFromNode(startNodeId, options)
     * @description
     *   Depth-first walks edges from a given node, filtering by:
     *     • `maxDepth` to limit recursion
     *     • `directions` (incoming/outgoing)
     *     • optional `relationName`
     *   Internally tracks visited nodes & relations to avoid cycles.
     * @param {string} startNodeId
     * @param {Object} [options]
     * @param {number} [options.maxDepth=Infinity]
     * @param {string[]} [options.directions=['outgoing','incoming']]
     * @param {string|null} [options.relationName=null]
     * @returns {Array<[node, relation, node]>} triplets in visit order
     */
    traverseFromNode(startNodeId, options = {}) {
        const {
            maxDepth = Infinity,
            directions  = ['outgoing', 'incoming'],
            relationName = null                       // optional filter
        } = options;

        const visitedNodes     = new Set();
        const visitedRelations = new Set();
        const result           = [];

        const traverse = (nodeId, depth) => {
            if (depth > maxDepth || visitedNodes.has(nodeId)) return;
            visitedNodes.add(nodeId);

            for (const relId of this.nodeRelations.get(nodeId) || []) {
                if (visitedRelations.has(relId)) continue;
                const rel = this.relations.get(relId);
                if (!rel) continue;

                // apply name filter
                if (relationName && rel.name !== relationName) continue;

                // determine direction
                const isOut = rel.fromNodeId === nodeId;
                const dir = isOut ? 'outgoing' : 'incoming';
                if (!directions.includes(dir)) continue;

                const otherNodeId = isOut ? rel.toNodeId : rel.fromNodeId;
                const otherNode   = this.nodes.get(otherNodeId);
                if (!otherNode) continue;

                visitedRelations.add(relId);
                result.push([ this.nodes.get(nodeId), rel, otherNode ]);

                traverse(otherNodeId, depth + 1);
            }
        };

        traverse(startNodeId, 0);
        return result;
    }

    /**
     * traverseFromRelation(startRelationId, [maxDepth])
     * @description
     *   Starts traversal by a relation, then explores all connected
     *   relations recursively up to `maxDepth`. Uses its own visited‐set.
     * @param {string} startRelationId
     * @param {number|null} [maxDepth=null]
     * @returns {Array<[node, relation, node]>}
     */
    traverseFromRelation(startRelationId, maxDepth = null) {
        const relation = this.relations.get(startRelationId);
        if (!relation) return [];

        const visited = new Set();
        const result = [];

        const traverse = (relationId, depth) => {
            if (maxDepth !== null && depth > maxDepth) return;
            if (visited.has(relationId)) return;

            visited.add(relationId);
            const rel = this.relations.get(relationId);
            if (!rel) return;

            const fromNode = this.nodes.get(rel.fromNodeId);
            const toNode = this.nodes.get(rel.toNodeId);

            if (fromNode && toNode) {
                result.push([fromNode, rel, toNode]);

                // Continue traversal from connected nodes
                [rel.fromNodeId, rel.toNodeId].forEach(nodeId => {
                    const connectedRelations = this.nodeRelations.get(nodeId) || new Set();
                    connectedRelations.forEach(connectedRelId => {
                        if (!visited.has(connectedRelId)) {
                            traverse(connectedRelId, depth + 1);
                        }
                    });
                });
            }
        };

        traverse(startRelationId, 0);
        return result;
    }

    /**
     * traverseFromMetadata(conditions, [maxDepth])
     * @description
     *   Finds all nodes and relations matching `conditions` (via
     *   `searchNodes`/`searchRelations`), then traverses from each,
     *   combining and deduplicating results.
     * @param {Object} metadataConditions – e.g. `{ type: 'document' }`
     * @param {number|null} [maxDepth=null]
     * @returns {Array<[node, relation, node]>}
     */
    traverseFromMetadata(metadataConditions, maxDepth = null) {
        const matchingNodes = this.searchNodes({ metadata: metadataConditions });
        const matchingRelations = this.searchRelations({ metadata: metadataConditions });

        const allResults = new Set();

        // Traverse from matching nodes
        matchingNodes.forEach(node => {
            const results = this.traverseFromNode(node.id, maxDepth);
            results.forEach(result => {
                allResults.add(JSON.stringify(result));
            });
        });

        // Traverse from matching relations
        matchingRelations.forEach(relation => {
            const results = this.traverseFromRelation(relation.id, maxDepth);
            results.forEach(result => {
                allResults.add(JSON.stringify(result));
            });
        });

        // Convert back to array format and deduplicate
        return Array.from(allResults).map(result => JSON.parse(result));
    }

    /**
     * searchNodes(conditions)
     * @description
     *   Returns all nodes for which `matchesConditions(node, conditions)`
     *   is true. Supports filtering on `name`, `id`, and nested `metadata`.
     * @param {Object} [conditions={}]
     * @returns {Array<node>}
     */
    searchNodes(conditions = {}) {
        const results = [];

        this.nodes.forEach(node => {
            if (this.matchesConditions(node, conditions)) {
                results.push(node);
            }
        });

        return results;
    }

    /**
     * searchRelations(conditions)
     * @description
     *   Same as `searchNodes` but for relations.
     * @param {Object} [conditions={}]
     * @returns {Array<relation>}
     */
    searchRelations(conditions = {}) {
        const results = [];

        this.relations.forEach(relation => {
            if (this.matchesConditions(relation, conditions)) {
                results.push(relation);
            }
        });

        return results;
    }

    /**
     * searchNodesByCosineSimilarity(queryEmbedding, options)
     * @description
     *   Finds nodes with embeddings similar to the query embedding using cosine similarity.
     * @param {number[]} queryEmbedding - The query embedding vector
     * @param {Object} [options={}]
     * @param {string} [options.embeddingKey='embedding'] - Key in metadata where embedding is stored
     * @param {number} [options.threshold=0.5] - Minimum cosine similarity threshold
     * @param {number} [options.limit=10] - Maximum number of results to return
     * @returns {Array<{node: Object, similarity: number}>} - Nodes with similarity scores
     */
    searchNodesByCosineSimilarity(queryEmbedding, options = {}) {
        const {
            embeddingKey = 'embedding',
            threshold = 0.5,
            limit = 10
        } = options;

        if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
            throw new Error('Query embedding must be a non-empty array');
        }

        const results = [];

        this.nodes.forEach(node => {
            const embedding = node.metadata[embeddingKey];
            if (Array.isArray(embedding)) {
                const similarity = this.cosineSimilarity(queryEmbedding, embedding);
                if (similarity >= threshold) {
                    results.push({ node, similarity });
                }
            }
        });

        // Sort by similarity (descending) and apply limit
        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    /**
     * searchRelationsByCosineSimilarity(queryEmbedding, options)
     * @description
     *   Finds relations with embeddings similar to the query embedding using cosine similarity.
     * @param {number[]} queryEmbedding - The query embedding vector
     * @param {Object} [options={}]
     * @param {string} [options.embeddingKey='embedding'] - Key in metadata where embedding is stored
     * @param {number} [options.threshold=0.5] - Minimum cosine similarity threshold
     * @param {number} [options.limit=10] - Maximum number of results to return
     * @returns {Array<{relation: Object, similarity: number}>} - Relations with similarity scores
     */
    searchRelationsByCosineSimilarity(queryEmbedding, options = {}) {
        const {
            embeddingKey = 'embedding',
            threshold = 0.5,
            limit = 10
        } = options;

        if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
            throw new Error('Query embedding must be a non-empty array');
        }

        const results = [];

        this.relations.forEach(relation => {
            const embedding = relation.metadata[embeddingKey];
            if (Array.isArray(embedding)) {
                const similarity = this.cosineSimilarity(queryEmbedding, embedding);
                if (similarity >= threshold) {
                    results.push({ relation, similarity });
                }
            }
        });

        // Sort by similarity (descending) and apply limit
        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    /**
     * cosineSimilarity(vecA, vecB)
     * @description
     *   Calculates cosine similarity between two vectors.
     *   Returns a value between -1 and 1, where 1 means identical direction.
     * @param {number[]} vecA - First vector
     * @param {number[]} vecB - Second vector
     * @returns {number} - Cosine similarity score
     */
    cosineSimilarity(vecA, vecB) {
        if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
            throw new Error('Both vectors must be arrays');
        }

        if (vecA.length !== vecB.length) {
            throw new Error('Vectors must have the same length');
        }

        if (vecA.length === 0) {
            return 0;
        }

        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            magnitudeA += vecA[i] * vecA[i];
            magnitudeB += vecB[i] * vecB[i];
        }

        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dotProduct / (magnitudeA * magnitudeB);
    }

    /**
     * searchAndTraverse(queryEmbedding, options)
     * @description
     *   GraphRAG-ready method that finds entities by cosine similarity and other filters,
     *   then traverses from each match for specified hops in a hierarchical structure.
     * @param {number[]} queryEmbedding - The query embedding vector
     * @param {Object} [options={}]
     * @param {string} [options.embeddingKey='embedding'] - Key in metadata where embedding is stored
     * @param {number} [options.threshold=0.5] - Minimum cosine similarity threshold
     * @param {number} [options.limit=10] - Maximum number of initial matches
     * @param {number} [options.hops=3] - Number of hops to traverse from each initial match
     * @param {Object} [options.nodeFilters={}] - Additional filters for nodes
     * @param {Object} [options.relationFilters={}] - Additional filters for relations
     * @param {boolean} [options.searchNodes=true] - Whether to search nodes
     * @param {boolean} [options.searchRelations=true] - Whether to search relations
     * @param {string[]} [options.directions=['outgoing','incoming']] - Traversal directions
     * @param {boolean} [options.endOnNode=false] - Whether to ensure traversal always ends on a node
     * @returns {Array<{type: string, entity: Object, similarity?: number, outgoingRelations?: Array, incomingRelations?: Array, fromNode?: Object, toNode?: Object}>}
     */
    searchAndTraverse(queryEmbedding, options = {}) {
        const {
            embeddingKey = 'embedding',
            threshold = 0.5,
            limit = 10,
            hops = 3,
            nodeFilters = {},
            relationFilters = {},
            searchNodes = true,
            searchRelations = true,
            directions = ['outgoing', 'incoming'],
            endOnNode = false
        } = options;

        if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
            throw new Error('Query embedding must be a non-empty array');
        }

        const results = [];
        const initialMatches = [];

        // Find initial node matches
        if (searchNodes) {
            const nodeMatches = this.searchNodesByCosineSimilarity(queryEmbedding, {
                embeddingKey,
                threshold,
                limit: Math.ceil(limit / (searchRelations ? 2 : 1))
            });

            // Apply additional node filters
            const filteredNodeMatches = nodeMatches.filter(match =>
                this.matchesConditions(match.node, nodeFilters)
            );

            initialMatches.push(...filteredNodeMatches.map(match => ({
                type: 'node',
                entity: match.node,
                similarity: match.similarity
            })));
        }

        // Find initial relation matches
        if (searchRelations) {
            const relationMatches = this.searchRelationsByCosineSimilarity(queryEmbedding, {
                embeddingKey,
                threshold,
                limit: Math.ceil(limit / (searchNodes ? 2 : 1))
            });

            // Apply additional relation filters
            const filteredRelationMatches = relationMatches.filter(match =>
                this.matchesConditions(match.relation, relationFilters)
            );

            initialMatches.push(...filteredRelationMatches.map(match => ({
                type: 'relation',
                entity: match.relation,
                similarity: match.similarity
            })));
        }

        // Sort by similarity and take top results
        initialMatches.sort((a, b) => b.similarity - a.similarity);
        const topMatches = initialMatches.slice(0, limit);

        // Build hierarchical structure from each initial match
        for (const initialMatch of topMatches) {
            const hierarchicalResult = this._buildHierarchicalStructure(
                initialMatch.type,
                initialMatch.entity,
                hops,
                directions,
                endOnNode,
                initialMatch.similarity
            );

            if (hierarchicalResult) {
                results.push(hierarchicalResult);
            }
        }

        return results;
    }

    /**
     * _buildHierarchicalStructure(entityType, entity, maxHops, directions, endOnNode, similarity)
     * @internal
     * @description
     *   Helper method to build hierarchical structure from either a node or relation.
     * @param {'node'|'relation'} entityType
     * @param {Object} entity
     * @param {number} maxHops
     * @param {string[]} directions
     * @param {boolean} endOnNode
     * @param {number} [similarity] - Similarity score for root entity
     * @returns {Object} Hierarchical structure
     */
    _buildHierarchicalStructure(entityType, entity, maxHops, directions, endOnNode, similarity) {
        const visited = new Set();

        const buildNode = (nodeEntity, depth) => {
            if (depth > maxHops || visited.has(`node:${nodeEntity.id}`)) {
                return {
                    type: 'node',
                    entity: nodeEntity,
                    ...(depth === 0 && similarity !== undefined ? { similarity } : {}),
                    outgoingRelations: [],
                    incomingRelations: []
                };
            }

            visited.add(`node:${nodeEntity.id}`);

            const nodeResult = {
                type: 'node',
                entity: nodeEntity,
                ...(depth === 0 && similarity !== undefined ? { similarity } : {}),
                outgoingRelations: [],
                incomingRelations: []
            };

            // Don't traverse further if we're at max hops
            if (depth >= maxHops) {
                return nodeResult;
            }

            // Get connected relations
            const relationIds = this.nodeRelations.get(nodeEntity.id) || new Set();
            for (const relationId of relationIds) {
                const relation = this.relations.get(relationId);
                if (!relation || visited.has(`relation:${relationId}`)) continue;

                // Check direction
                const isOutgoing = relation.fromNodeId === nodeEntity.id;
                const direction = isOutgoing ? 'outgoing' : 'incoming';
                if (!directions.includes(direction)) continue;

                const relationStructure = buildRelation(relation, depth + 1, nodeEntity.id);
                if (relationStructure) {
                    if (isOutgoing) {
                        nodeResult.outgoingRelations.push(relationStructure);
                    } else {
                        nodeResult.incomingRelations.push(relationStructure);
                    }
                }
            }

            return nodeResult;
        };

        const buildRelation = (relationEntity, depth, fromNodeId) => {
            if (depth > maxHops || visited.has(`relation:${relationEntity.id}`)) {
                return {
                    type: 'relation',
                    entity: relationEntity,
                    ...(depth === 0 && similarity !== undefined ? { similarity } : {}),
                    fromNode: null,
                    toNode: null
                };
            }

            visited.add(`relation:${relationEntity.id}`);

            const relationResult = {
                type: 'relation',
                entity: relationEntity,
                ...(depth === 0 && similarity !== undefined ? { similarity } : {}),
                fromNode: null,
                toNode: null
            };

            // If we're at max hops and endOnNode is false, don't traverse to nodes
            if (depth >= maxHops && !endOnNode) {
                return relationResult;
            }

            // Build connected nodes
            const fromNode = this.nodes.get(relationEntity.fromNodeId);
            const toNode = this.nodes.get(relationEntity.toNodeId);

            if (fromNode) {
                relationResult.fromNode = buildNode(fromNode, depth + 1);
            }

            if (toNode) {
                relationResult.toNode = buildNode(toNode, depth + 1);
            }

            return relationResult;
        };

        if (entityType === 'node') {
            return buildNode(entity, 0);
        } else if (entityType === 'relation') {
            return buildRelation(entity, 0);
        }

        return null;
    }

    /**
     * matchesConditions(entity, conditions)
     * @internal
     * @description
     *   Generic predicate that checks each `conditions` key:
     *     - `metadata`: calls `matchesMetadataConditions`
     *     - `name`: exact, RegExp, or "contains" filter
     *     - `id`, `fromNodeId`, `toNodeId`: strict equal
     *     - `cosineSimilarity`: performs cosine similarity search
     * @param {Object} entity
     * @param {Object} conditions
     * @returns {boolean}
     */
    matchesConditions(entity, conditions) {
        for (const [key, value] of Object.entries(conditions)) {
            if (key === 'metadata') {
                if (!this.matchesMetadataConditions(entity.metadata, value)) {
                    return false;
                }
            } else if (key === 'cosineSimilarity') {
                // Handle cosine similarity condition
                const { queryEmbedding, embeddingKey = 'embedding', threshold = 0.5 } = value;
                const embedding = entity.metadata[embeddingKey];
                if (!Array.isArray(embedding)) {
                    return false;
                }
                const similarity = this.cosineSimilarity(queryEmbedding, embedding);
                if (similarity < threshold) {
                    return false;
                }
            } else if (key === 'name') {
                if (typeof value === 'string') {
                    if (entity.name !== value) return false;
                } else if (value instanceof RegExp) {
                    if (!value.test(entity.name)) return false;
                } else if (typeof value === 'object' && value.contains) {
                    if (!entity.name.toLowerCase().includes(value.contains.toLowerCase())) return false;
                }
            } else if (key === 'id') {
                if (entity.id !== value) return false;
            } else if (key === 'fromNodeId' || key === 'toNodeId') {
                if (entity[key] !== value) return false;
            }
        }
        return true;
    }

    /**
     * matchesMetadataConditions(metadata, conditions)
     * @internal
     * @description
     *   For each key in `conditions`, applies operators:
     *     `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, etc.
     *     Also supports `cosineSimilarity` for vector comparisons.
     * @param {Object} metadata
     * @param {Object} conditions
     * @returns {boolean}
     */
    matchesMetadataConditions(metadata, conditions) {
        for (const [key, condition] of Object.entries(conditions)) {
            const value = metadata[key];

            if (typeof condition === 'object' && condition !== null) {
                if (condition.eq !== undefined && value !== condition.eq) return false;
                if (condition.ne !== undefined && value === condition.ne) return false;
                if (condition.gt !== undefined && value <= condition.gt) return false;
                if (condition.gte !== undefined && value < condition.gte) return false;
                if (condition.lt !== undefined && value >= condition.lt) return false;
                if (condition.lte !== undefined && value > condition.lte) return false;
                if (condition.contains !== undefined && !String(value).toLowerCase().includes(String(condition.contains).toLowerCase())) return false;
                if (condition.startsWith !== undefined && !String(value).startsWith(String(condition.startsWith))) return false;
                if (condition.endsWith !== undefined && !String(value).endsWith(String(condition.endsWith))) return false;
                if (condition.in !== undefined && !condition.in.includes(value)) return false;

                // Handle cosine similarity in metadata conditions
                if (condition.cosineSimilarity !== undefined) {
                    const { queryEmbedding, threshold = 0.5 } = condition.cosineSimilarity;
                    if (!Array.isArray(value) || !Array.isArray(queryEmbedding)) {
                        return false;
                    }
                    const similarity = this.cosineSimilarity(queryEmbedding, value);
                    if (similarity < threshold) {
                        return false;
                    }
                }
            } else {
                if (value !== condition) return false;
            }
        }
        return true;
    }

    /**
     * updateNode(nodeId, updates)
     * @description
     *   Applies `updates.name` and/or shallow-merges `updates.metadata`
     *   into an existing node, then persists.
     * @param {string} nodeId
     * @param {{name?:string,metadata?:Object}} updates
     * @returns {node}
     * @throws if node not found
     */
    updateNode(nodeId, updates) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            throw new Error(`Node with id ${nodeId} not found`);
        }

        if (updates.name !== undefined) {
            node.name = updates.name;
        }
        if (updates.metadata !== undefined) {
            node.metadata = {
                ...node.metadata,
                ...this._clone(updates.metadata)
            };
        }

        this.flushToDisk();
        return node;
    }

    /**
     * updateRelation(relationId, updates)
     * @description
     *   Similar to `updateNode` but for an edge.
     * @param {string} relationId
     * @param {{name?:string,metadata?:Object}} updates
     * @returns {relation}
     * @throws if relation not found
     */
    updateRelation(relationId, updates) {
        const relation = this.relations.get(relationId);
        if (!relation) {
            throw new Error(`Relation with id ${relationId} not found`);
        }

        if (updates.name !== undefined) {
            relation.name = updates.name;
        }
        if (updates.metadata !== undefined) {
            relation.metadata = {
                ...relation.metadata,
                ...this._clone(updates.metadata)
            };
        }

        this.flushToDisk();
        return relation;
    }

    /**
     * updateBySearch(entityType, searchConditions, updates)
     * @description
     *   Bulk‐updates all nodes or relations matching `searchConditions`.
     *   Returns an array of updated entities.
     * @param {'node'|'relation'} entityType
     * @param {Object} searchConditions
     * @param {Object} updates
     * @returns {Array<node|relation>}
     */
    updateBySearch(entityType, searchConditions, updates) {
        const results = [];

        if (entityType === 'node') {
            const nodes = this.searchNodes(searchConditions);
            nodes.forEach(node => {
                results.push(this.updateNode(node.id, updates));
            });
        } else if (entityType === 'relation') {
            const relations = this.searchRelations(searchConditions);
            relations.forEach(relation => {
                results.push(this.updateRelation(relation.id, updates));
            });
        }

        return results;
    }

    /**
     * deleteNode(nodeId)
     * @description
     *   Removes a node and all its attached relations:
     *     1. Deletes relations from `relations` map
     *     2. Cleans up other nodes' `nodeRelations` sets
     *     3. Deletes node entry
     *     4. Persists changes
     * @param {string} nodeId
     * @returns {node} the removed node
     * @throws if node not found
     */
    deleteNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            throw new Error(`Node with id ${nodeId} not found`);
        }

        // Delete all relations connected to this node
        const relationIds = this.nodeRelations.get(nodeId) || new Set();
        relationIds.forEach(relationId => {
            this.relations.delete(relationId);
        });

        // Remove from other nodes' relation sets
        this.nodeRelations.forEach((relations, otherNodeId) => {
            if (otherNodeId !== nodeId) {
                relationIds.forEach(relationId => {
                    relations.delete(relationId);
                });
            }
        });

        // Delete the node and its relations
        this.nodes.delete(nodeId);
        this.nodeRelations.delete(nodeId);

        this.flushToDisk();
        return node;
    }

    /**
     * deleteRelation(relationId)
     * @description
     *   Removes an edge, updates its two endpoints' `nodeRelations`,
     *   and persists.
     * @param {string} relationId
     * @returns {relation} the removed relation
     * @throws if relation not found
     */
    deleteRelation(relationId) {
        const relation = this.relations.get(relationId);
        if (!relation) {
            throw new Error(`Relation with id ${relationId} not found`);
        }

        // Remove from node-relations index
        this.nodeRelations.get(relation.fromNodeId)?.delete(relationId);
        this.nodeRelations.get(relation.toNodeId)?.delete(relationId);

        // Delete the relation
        this.relations.delete(relationId);

        this.flushToDisk();
        return relation;
    }

    /**
     * deleteBySearch(entityType, searchConditions)
     * @description
     *   Deletes all nodes or relations matching the search criteria.
     *   Returns an array of removed entities.
     * @param {'node'|'relation'} entityType
     * @param {Object} searchConditions
     * @returns {Array<node|relation>}
     */
    deleteBySearch(entityType, searchConditions) {
        const results = [];

        if (entityType === 'node') {
            const nodes = this.searchNodes(searchConditions);
            nodes.forEach(node => {
                results.push(this.deleteNode(node.id));
            });
        } else if (entityType === 'relation') {
            const relations = this.searchRelations(searchConditions);
            relations.forEach(relation => {
                results.push(this.deleteRelation(relation.id));
            });
        }

        return results;
    }

    /**
     * getAllNodes()
     * @description
     *   Returns an array of every node in the graph.
     * @returns {Array<node>}
     */
    getAllNodes() {
        return Array.from(this.nodes.values());
    }

    /**
     * getAllRelations()
     * @description
     *   Returns an array of every relation in the graph.
     * @returns {Array<relation>}
     */
    getAllRelations() {
        return Array.from(this.relations.values());
    }

    /**
     * getNode(nodeId)
     * @description
     *   Retrieves a single node by ID (or `undefined`).
     * @param {string} nodeId
     * @returns {node|undefined}
     */
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }

    /**
     * getRelation(relationId)
     * @description
     *   Retrieves a single relation by ID (or `undefined`).
     * @param {string} relationId
     * @returns {relation|undefined}
     */
    getRelation(relationId) {
        return this.relations.get(relationId);
    }

    /**
     * getNeighbors(nodeId)
     * @description
     *   Finds all adjacent nodes to `nodeId` by looking up its
     *   `nodeRelations` set, returning each neighbor plus the
     *   connecting relation and direction.
     * @param {string} nodeId
     * @returns {Array<{node,relation,direction}>}
     */
    getNeighbors(nodeId) {
        const neighbors = [];
        const relationIds = this.nodeRelations.get(nodeId) || new Set();

        relationIds.forEach(relationId => {
            const relation = this.relations.get(relationId);
            if (relation) {
                const otherNodeId = relation.fromNodeId === nodeId ? relation.toNodeId : relation.fromNodeId;
                const otherNode = this.nodes.get(otherNodeId);
                if (otherNode) {
                    neighbors.push({
                        node: otherNode,
                        relation: relation,
                        direction: relation.fromNodeId === nodeId ? 'outgoing' : 'incoming'
                    });
                }
            }
        });

        return neighbors;
    }

    /**
     * getStats()
     * @description
     *   Computes basic graph metrics:
     *     - `nodeCount`
     *     - `relationCount`
     *     - `avgDegree` = 2×E/N
     * @returns {{nodeCount:number,relationCount:number,avgDegree:number}}
     */
    getStats() {
        return {
            nodeCount: this.nodes.size,
            relationCount: this.relations.size,
            avgDegree: this.nodes.size > 0 ? (this.relations.size * 2) / this.nodes.size : 0
        };
    }

    /**
     * exportData()
     * @description
     *   Dumps the entire in-memory graph as a JSON-serializable
     *   object `{nodes:…, relations:…}` without writing to disk.
     * @returns {{nodes:Array,relations:Array}}
     */
    exportData() {
        return {
            nodes: Array.from(this.nodes.values()),
            relations: Array.from(this.relations.values())
        };
    }

    /**
     * importData(data)
     * @description
     *   Completely replaces current graph with supplied data,
     *   rebuilds indexes, and persists to `filePath`.
     * @param {{nodes:Array,relations:Array}} data
     * @returns {void}
     */
    importData(data) {
        this.nodes.clear();
        this.relations.clear();
        this.nodeRelations.clear();

        if (data.nodes) {
            data.nodes.forEach(node => {
                this.nodes.set(node.id, node);
            });
        }

        if (data.relations) {
            data.relations.forEach(relation => {
                this.relations.set(relation.id, relation);
            });
        }

        this.rebuildNodeRelationsIndex();
        this.flushToDisk();
    }

    /**
     * generateId()
     * @internal
     * @description
     *   Returns a unique id using current timestamp and a counter
     * @returns string
     */
    generateId() {
        return `${Date.now()}-${this.idCounter++}`;
    }

    /**
     * _clone(obj)
     * @internal
     * @description
     *   Performs a deep clone of JSON-safe data via
     *   `JSON.parse(JSON.stringify(obj))` to avoid shared references.
     * @param {any} obj
     * @returns {any}
     */
    _clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
}

module.exports = TinyGraphDB;
