const fs = require('fs');
const path = require('path');


/**
 * @class TinyGraphDB
 * @description
 *   A simple disk-backed graph store.
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
     * saveToFile()
     * @description
     *   Serializes `nodes` + `relations` to JSON and writes to disk.
     *   Overwrites atomically, with errors logged to console.
     * @returns {void}
     */
    saveToFile() {
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
    addNode(name, metadata = {}) {
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
        this.saveToFile();
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
     * @throws if either nodeId doesn’t exist
     */
    addRelation(name, fromNodeId, toNodeId, metadata = {}) {
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
        this.saveToFile();
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
     * matchesConditions(entity, conditions)
     * @internal
     * @description
     *   Generic predicate that checks each `conditions` key:
     *     - `metadata`: calls `matchesMetadataConditions`
     *     - `name`: exact, RegExp, or “contains” filter
     *     - `id`, `fromNodeId`, `toNodeId`: strict equal
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
        
        this.saveToFile();
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
              ...rel.metadata,
              ...this._clone(updates.metadata)
            };
        }
        
        this.saveToFile();
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
     *     2. Cleans up other nodes’ `nodeRelations` sets
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
        
        this.saveToFile();
        return node;
    }

    /**
     * deleteRelation(relationId)
     * @description
     *   Removes an edge, updates its two endpoints’ `nodeRelations`,
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
        
        this.saveToFile();
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
        this.saveToFile();
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
