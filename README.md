# TinyGraphDB

A **tiny**, no-external-dependencies, **disk-based** graph database for Node.js with rich query, traversal, batch ops, batch cosine similarity, and semantic filtering.

- Persist node-&-relation graphs in a JSON file
- Query, traverse, mutate, and semantically search graphs in JavaScript
- **Cosine similarity search** of nodes & edges via vector embeddings for AI/semantic-graph use cases
- **Batch** and hierarchical traversals, semantic+traditional queries, and stats
- Full API for CRUD, batch, similarity, statistics, import/export, and traversal

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
  - [Constructor](#constructor)
  - [Node Operations](#node-operations)
  - [Relation Operations](#relation-operations)
  - [Query & Search](#query--search)
  - [Cosine Similarity Search](#cosine-similarity-search)
  - [Graph Traversal](#graph-traversal)
  - [Batch Update / Delete](#batch-update--delete)
  - [GraphRAG & Hierarchical Traversal](#graphrag--hierarchical-traversal)
  - [Import / Export](#import--export)
  - [Utility](#utility)
- [Examples](#examples)
- [Performance Benchmarks](#performance-benchmarks)
- [Contributing](#contributing)
- [License](#license)

## Features

- ✅ **Persistent storage**  
  All nodes & edges auto-saved to a JSON file
- 🔍 **Search**: name, metadata, ID, relation endpoints, and semantic/meta comparison
- 🧮 **Cosine Similarity** queries for embeddings in metadata (nodes or relations)
- 🔄 **Graph Traversal**, walk/batch from node, relation, or metadata; supports direction/depth/name filters
- ⬇️ **Batch update/delete** by search criteria (see below)
- 📈 **Stats:** node count, edge count, average degree
- 🔄 **Import/export:** snapshot/restore full graph
- ⚡ Fast, super lightweight, perfect for graph semantic search, retrieval-augmented generation, etc.

## Installation

```bash
npm install tiny-graph-db
```

## Quick Start

```js
const TinyGraphDB = require('tiny-graph-db');
const db = new TinyGraphDB();

// Add nodes with embeddings
const nodeA = db.addNode('Paper A', { type: 'paper', embedding: [0.2, 0.1, 0.5] });
const nodeC = db.addNode('Concept X', { type: 'concept', embedding: [0.25, 0.1, 0.55] });
const nodeP = db.addNode('Author', { type: 'person', embedding: [0.9, 0.8, 0.7] });

const rel1 = db.addRelation('mentions', nodeA.id, nodeC.id, { confidence: 0.92 });
const rel2 = db.addRelation('authored_by', nodeA.id, nodeP.id, { confidence: 1.0 });

// Node search by metadata
console.log('All concepts:', db.searchNodes({ metadata: { type: 'concept' } }));

// Cosine similarity search
const qv = [0.2, 0.1, 0.52];
const similar = db.searchNodesByCosineSimilarity(qv, { threshold: 0.99 });
console.log('Semantically closest nodes:', similar);

// Traverse outgoing links from nodeA up to depth 2
const walk = db.traverseFromNode(nodeA.id, { maxDepth: 2, directions: ['outgoing'] });
console.log('Traversal:', walk);

// Batch update: update all "concept" nodes
db.updateBySearch('node', { metadata: { type: 'concept' } }, { metadata: { reviewed: true } });

// Batch delete: remove all relations with low confidence
db.deleteBySearch('relation', { metadata: { confidence: { lt: 0.95 } } });

// Save (usually auto, but explicit call)
db.flushToDisk();
```

## API

### Constructor

```js
new TinyGraphDB(filePath?: string)
```
- **filePath**: Path to JSON file (default: `'./graph_data.json'`).

### Node Operations

| Method                                                        | Description                                            | Returns               |
|---------------------------------------------------------------|--------------------------------------------------------|-----------------------|
| `addNode(name, metadata = {}, flush = true)`                  | Create node with name/metadata                         | Node object           |
| `getNode(nodeId)`                                             | Look up node by ID                                     | Node or `undefined`   |
| `getAllNodes()`                                               | Get all nodes                                          | `Node[]`              |
| `updateNode(nodeId, {name?, metadata?})`                      | Update name/metadata                                   | Updated node          |
| `deleteNode(nodeId)`                                          | Remove node and all its relations                      | Deleted node object   |
| `deleteBySearch('node', conditions)`                          | Batch delete by search                                 | Array of removed      |

### Relation Operations

| Method                                                        | Description                                            | Returns                   |
|---------------------------------------------------------------|--------------------------------------------------------|---------------------------|
| `addRelation(name, fromNodeId, toNodeId, metadata = {}, flush = true)` | Create edge between nodes                       | Relation object           |
| `getRelation(relationId)`                                     | Fetch edge by ID                                      | Relation or `undefined`   |
| `getAllRelations()`                                           | Get all edges                                         | Relation[]                |
| `updateRelation(relationId, {name?, metadata?})`              | Update name/metadata                                  | Updated relation          |
| `deleteRelation(relationId)`                                  | Remove relation                                       | Deleted relation object   |
| `deleteBySearch('relation', conditions)`                      | Batch delete by search                                | Array of removed          |

### Query & Search

```js
searchNodes(conditions: SearchConditions): Node[]
searchRelations(conditions: SearchConditions): Relation[]
```

**conditions**:
- `name`: string | RegExp | `{ contains: string }`
- `id`, `fromNodeId`, `toNodeId`
- `metadata`: `{ [key]: ... }` supports:
  - equality, comparison: `{ eq, ne, gt, gte, lt, lte, contains, startsWith, endsWith, in }`
  - cosine similarity: `{ cosineSimilarity: { queryEmbedding, threshold } }`
- `cosineSimilarity` (top-level): `{ queryEmbedding, embeddingKey, threshold }`

### Cosine Similarity Search

```js
searchNodesByCosineSimilarity(queryEmbedding: number[], options?): Array
searchRelationsByCosineSimilarity(queryEmbedding: number[], options?): Array
cosineSimilarity(vecA: number[], vecB: number[]): number
```

- `queryEmbedding`: Numeric vector
- Options:
  - `embeddingKey`: metadata key for vector (default: `'embedding'`)
  - `threshold`: similarity threshold (default: 0.5)
  - `limit`: max results (default: 10)

#### Example

```js
db.searchNodesByCosineSimilarity([0.1, 0.2, 0.3], { threshold: 0.8, limit: 3 });
```

### Graph Traversal

| Method                                             | Description                                  | Returns                         |
|----------------------------------------------------|----------------------------------------------|-----------------------------------|
| `traverseFromNode(startNodeId, options)`           | Walks from a node, following edges (see below) | Array of `[fromNode, relation, toNode]` |
| `traverseFromRelation(startRelationId, maxDepth?)` | Starts traversal from a relation               | Same as above                    |
| `traverseFromMetadata(metadataConditions, maxDepth?)` | Begins traverse from nodes/relations that match metadata | Same as above         |

**Options for `traverseFromNode`:**
- `maxDepth`: limit depth (`Infinity` by default)
- `directions`: `['outgoing','incoming']`
- `relationName`: (optional) filter by relation name

#### Example

```js
db.traverseFromNode(nodeId, { maxDepth: 2, directions: ['outgoing'] });
```
Result: Array of `[fromNode, relation, toNode]` triplets in visit order.

### Batch Update / Delete

#### Update by search

```js
updateBySearch('node' | 'relation', searchConditions, { name?, metadata? }): Array
// Example:
db.updateBySearch('node', { metadata: { genre: 'sci-fi' } }, { name: 'SF Novel' });
```

#### Delete by search

```js
deleteBySearch('node' | 'relation', searchConditions): Array
// Example:
db.deleteBySearch('relation', { metadata: { confidence: { lt: 0.9 } } });
```

### GraphRAG & Hierarchical Traversal

#### Hybrid search and traversal for retrieval-augmented-graph (RAG) and LLM flows
```js
searchAndTraverse(queryEmbedding, options?): Array
```

Supports:
- Cosine similarity search + regular filters, for nodes/relations
- For each initial match, traverses up to N hops, directionally (optionally, end traversal on node only)
- Returns rich hierarchical JSON

**Options:**
- `embeddingKey`, `threshold`, `limit` - see cosine similarity
- `hops`: Number of hops to traverse (default: 3)
- `nodeFilters`, `relationFilters`: Additional filters
- `searchNodes`, `searchRelations`: Whether to include nodes, edges, or both
- `directions`: e.g., `['outgoing', 'incoming']`
- `endOnNode`: bool (whether to always finish traversal on nodes)

**Example:**
```js
const tree = db.searchAndTraverse([0.2, 0.1, 0.5], {
  hops: 2,
  searchNodes: true,
  searchRelations: false,
  nodeFilters: { metadata: { type: 'paper' } },
});
console.log(tree);
// Output: array of hierarchical trees, each rooted on an initial (semantic) hit, with outgoing/incoming relations, connected nodes/edges & so forth
```

### Import / Export

```js
exportData(): { nodes: Node[], relations: Relation[] }
importData(data: { nodes, relations }): void
```

*Export* produces the full graph dataset as JSON-serializable data.
*Import* wipes and loads supplied graph, then persists.

### Utility

- `getNeighbors(nodeId)`: All neighbor nodes, with edge and direction
  - Returns: Array of `{ node, relation, direction }`
- `getStats()`: `{ nodeCount, relationCount, avgDegree }`
- `flushToDisk()`: Explicit save to disk (auto after every mutation unless using `flush = false` param on add)
- `rebuildNodeRelationsIndex()`: Internal; rebuilds edge indices (auto-run after import)

## Examples

### 1. Traditional Search

```js
const book1    = db.addNode('Dune',        { genre: 'sci-fi',   pages: 412, published: 1965 });
const book2    = db.addNode('Foundation',  { genre: 'sci-fi',   pages: 255, published: 1951 });
const author1  = db.addNode('Frank Herbert', { nationality: 'US' });

// Find all US authors:
db.searchNodes({ metadata: { nationality: 'US' } });

// Find all books published pre-1960:
db.searchNodes({ metadata: { published: { lt: 1960 } } });
```

### 2. Cosine Similarity Search

```js
const doc = db.addNode('Graph Vector', { embedding: [0.2, 0.4, 0.6] });
// Find similar to [0.2, 0.41, 0.67]:
db.searchNodesByCosineSimilarity([0.2, 0.41, 0.67], { threshold: 0.95 });
```

### 3. Traversals

```js
// Walk two hops out from a node
const walk = db.traverseFromNode(doc.id, { maxDepth: 2, directions: ['outgoing'] });

// Start traversal from a relation
const traverseRels = db.traverseFromRelation(rel1.id, 3);

// Traverse from all nodes with type "paper":
db.traverseFromMetadata({ type: 'paper' }, 2);
```

### 4. Batch Update & Delete

```js
// Tag all "concept" nodes as reviewed
db.updateBySearch('node', { metadata: { type: 'concept' } }, { metadata: { reviewed: true } });
// Delete all weak relations
db.deleteBySearch('relation', { metadata: { confidence: { lt: 0.8 } } });
```

### 5. Hybrid "search and traverse" (GraphRAG pattern)

```js
// Retrieve node (by semantic match) then its 2-hop subgraph
const rag = db.searchAndTraverse([0.25, 0.1, 0.5], { hops: 2 });
console.log(JSON.stringify(rag, null, 2));
```

### 6. Utilities

```js
console.log('Stats:', db.getStats());
console.log('Neighbors of nodeA:', db.getNeighbors(nodeA.id));
// Export/import
const json = db.exportData();
db.importData(json);
```

## Performance Benchmarks

| Function                        | Time (ms) | Ops/sec    |
|----------------------------------|-----------|------------|
| getNode()                       | 0.0001    | 8,473,743  |
| traverseFromNode()              | 0.0072    | 138,175    |
| searchNodes()                   | 0.1728    |  5,787     |
| searchNodesByCosineSimilarity() | 0.3456    |  2,893     |

Run benchmarks: `node src/benchmark.js 1000 2000 5` or `npm run benchmark -- 1000 2000 5`

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Commit & push, then open a PR

Please file bugs/requests using GitHub Issues.

## License

MIT License (see [LICENSE](./LICENSE))

> Built with ♥ by [freakynit](https://github.com/freakynit)
