# TinyGraphDB

A **tiny**, **no-external-dependencies**, **disk-based** graph database for Node.js with rich set of operations.  

- Persist simple node-&-edge graphs in a JSON file, and query, traverse or mutate them entirely in JavaScript.
- TinyGraphDB is a great fit for building lightweight, GraphRAG systems — where LLMs retrieve knowledge via structured traversals instead of just flat vector search.

---

## Table of Contents

- [Features](#features)  
- [Installation](#installation)  
- [Quick Start](#quick-start)  
- [API](#api)  
  - [Constructor](#constructor)  
  - [Node Operations](#node-operations)  
  - [Relation Operations](#relation-operations)  
  - [Query & Search](#query--search)  
  - [Graph Traversal](#graph-traversal)  
  - [Import / Export](#import--export)  
  - [Utility](#utility)  
- [Examples](#examples)  
- [CLI Usage](#cli-usage)  
- [Contributing](#contributing)  
- [License](#license)  

---

## Features

- ✅ **Persistent storage**  
  Automatically saves all nodes & relations to a JSON file on each change.  
- 🔍 **Searchable**  
  Find nodes or edges by name, metadata, IDs or via complex metadata filters.  
- 🔄 **Traversals**  
  Breadth-first-style traversals from any node or relation, with depth, direction and name filters.  
- 🔧 **CRUD + Batch Ops**  
  Create, read, update or delete single or multiple nodes/relations by search criteria.  
- 📈 **Statistics**  
  Get `nodeCount`, `relationCount` and `avgDegree`.  
- 🔄 **Import/Export**  
  Dump your graph into JSON, or load an existing JSON graph.  

---

## Installation

```bash
npm install tiny-graph-db
````

---

## Quick Start

```js
const TinyGraphDB = require('tiny-graph-db');
const db = new TinyGraphDB();

// Adding some sample data
const node1 = db.addNode('Document1', { type: 'document', content: 'AI research paper' });
const node2 = db.addNode('Concept1', { type: 'concept', domain: 'AI' });
const node3 = db.addNode('Author1', { type: 'person', name: 'John Doe' });

const rel1 = db.addRelation('contains', node1.id, node2.id, { confidence: 0.9 });
const rel2 = db.addRelation('authored_by', node1.id, node3.id, { confidence: 1.0 });

// Search examples
console.log('Search: nodes with type "concept":', db.searchNodes({ metadata: { type: 'concept' } }));
console.log('Search: relations with confidence > 0.8:', db.searchRelations({ metadata: { confidence: { gt: 0.8 } } }));

// Traversal examples
console.log('Traverse: from node1 (depth 2):', db.traverseFromNode(node1.id, { maxDepth: 2, directions: ['outgoing'] }));
console.log('Traverse: from metadata {type: "document"}:', db.traverseFromMetadata({ type: 'document' }, 1));

// Update example
db.updateNode(node1.id, { name: 'Updated Document', metadata: { updated: true } });

console.log('Graph stats:', db.getStats());

```

---

## API

### Constructor

```ts
new TinyGraphDB(filePath?: string)
```

* **filePath**: path to JSON file for persistence (default: `./graph_data.json`).

---

### Node Operations

| Method                                 | Description                                    | Returns               |
| -------------------------------------- | ---------------------------------------------- | --------------------- |
| `addNode(name: string, metadata = {})` | Creates a node with given name & metadata      | `Node` object         |
| `getNode(nodeId: string)`              | Fetches a node by its ID                       | `Node` or `undefined` |
| `getAllNodes()`                        | Returns all nodes                              | `Node[]`              |
| `updateNode(nodeId: string, updates)`  | Update name and/or metadata on a node          | Updated `Node`        |
| `deleteNode(nodeId: string)`           | Deletes a node and all its connected relations | Deleted `Node`        |
| `deleteBySearch('node', conditions)`   | Deletes **all** nodes matching `conditions`    | `Node[]`              |

### Relation Operations

| Method                                                   | Description                                     | Returns                   |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------- |
| `addRelation(name, fromNodeId, toNodeId, metadata = {})` | Creates an edge between two existing nodes      | `Relation`                |
| `getRelation(relationId: string)`                        | Fetches a relation by ID                        | `Relation` or `undefined` |
| `getAllRelations()`                                      | Returns all relations                           | `Relation[]`              |
| `updateRelation(relationId, updates)`                    | Update name and/or metadata on a relation       | Updated `Relation`        |
| `deleteRelation(relationId: string)`                     | Deletes a single relation                       | Deleted `Relation`        |
| `deleteBySearch('relation', conditions)`                 | Deletes **all** relations matching `conditions` | `Relation[]`              |

---

### Graph Traversal

```ts
traverseFromNode(startNodeId, options?)
traverseFromRelation(startRelationId, maxDepth?)
traverseFromMetadata(metadataConditions, maxDepth?)
```

* **options** for `traverseFromNode`:

  * `maxDepth`: number (default: ∞)
  * `directions`: `['outgoing','incoming']`
  * `relationName?`: filter by relation name
* **Returns**: an array of `[ fromNode, relation, toNode ]` tuples.

---

### Import / Export

```ts
exportData(): { nodes: Node[]; relations: Relation[] }
importData(data: { nodes; relations })
```

* `exportData()` returns a JSON-serializable object.
* `importData(...)` wipes current graph and loads provided data, then persists.

---

### Query & Search

```ts
searchNodes(conditions: SearchConditions): Node[]
searchRelations(conditions: SearchConditions): Relation[]
```

* **conditions**:

  * `name`: string | `RegExp` | `{ contains: string }`
  * `id`, `fromNodeId`, `toNodeId`
  * `metadata`: `{ [key]: valueOrFilter }`

    * supports `{ eq, ne, gt, gte, lt, lte, contains, startsWith, endsWith, in }`

#### Examples
```js
const TinyGraphDB = require('tiny-graph-db');
const db = new TinyGraphDB('./example_graph.json');

// ——— Create sample nodes ———
const book1    = db.addNode('Dune',        { genre: 'sci-fi',   pages: 412,  published: 1965 });
const book2    = db.addNode('Foundation',  { genre: 'sci-fi',   pages: 255,  published: 1951 });
const book3    = db.addNode('Hamlet',      { genre: 'drama',    pages: 160,  published: 1603 });
const author1  = db.addNode('Frank Herbert', { nationality: 'US',  awards: 2 });
const author2  = db.addNode('Isaac Asimov',  { nationality: 'US',  awards: 5 });
const author3  = db.addNode('William Shakespeare', { nationality: 'UK', awards: 0 });

// ——— Create sample relations ———
const rel1 = db.addRelation('wrote', book1.id,   author1.id, { role: 'author'   });
const rel2 = db.addRelation('wrote', book2.id,   author2.id, { role: 'author'   });
const rel3 = db.addRelation('wrote', book3.id,   author3.id, { role: 'playwright' });
const rel4 = db.addRelation('influenced', author2.id, author1.id, { year: 1960 });
```

##### 1. Search nodes by **exact name**

```js
// Find the node whose name is exactly "Dune":
const result = db.searchNodes({ name: 'Dune' });
console.log(result);
// → [ { id: '…', name: 'Dune', metadata: { genre: 'sci-fi', … } } ]
```

##### 2. Search nodes by **name contains** (case-insensitive)

```js
// Find all nodes whose name contains "isaac" (will match "Isaac Asimov"):
const result = db.searchNodes({ name: { contains: 'isaac' } });
console.log(result.map(n => n.name));
// → [ 'Isaac Asimov' ]
```

##### 3. Search nodes by **name regex**

```js
// Find any book title that starts with 'F' or 'H':
const result = db.searchNodes({ name: /^F|^H/ });
console.log(result.map(n => n.name));
// → [ 'Foundation', 'Hamlet' ]
```

##### 4. Search nodes by **metadata equality** and **comparison**

```js
// All sci-fi books:
const scifi = db.searchNodes({ metadata: { genre: 'sci-fi' } });

// Books published before 1900:
const classics = db.searchNodes({
  metadata: { published: { lt: 1900 } }
});

console.log(scifi.map(n => n.name));     // → [ 'Dune', 'Foundation' ]
console.log(classics.map(n => n.name));  // → [ 'Foundation', 'Hamlet' ]
```

##### 5. Search nodes by **metadata “in” list**

```js
// Find all authors from US or UK:
const authors = db.searchNodes({
  metadata: { nationality: { in: ['US', 'UK'] } }
});
console.log(authors.map(a => a.name));
// → [ 'Frank Herbert', 'Isaac Asimov', 'William Shakespeare' ]
```

##### 6. Search relations by **relation name** and **metadata**

```js
// All "wrote" relations:
const wroteRels = db.searchRelations({ name: 'wrote' });

// Relations where influence happened after 1950:
const influenceRels = db.searchRelations({
  name: 'influenced',
  metadata: { year: { gt: 1950 } }
});

console.log(wroteRels.length);      // → 3
console.log(influenceRels);         // → [ { id: '…', name: 'influenced', … } ]
```

##### 7. Combining condition types
```js
// Sci-fi books by authors with >2 awards:
const sciFiBooks = db.searchNodes({
  metadata: { genre: 'sci-fi' }
});
const topAuthors = db.searchNodes({
  metadata: { awards: { gt: 2 } }
});

// Then filter relations:
const result = db
  .getAllRelations()
  .filter(r =>
    r.name === 'wrote'
    && sciFiBooks.some(b => b.id === r.fromNodeId)
    && topAuthors.some(a => a.id === r.toNodeId)
  );
console.log(result);
```

---

### Utility

* `getNeighbors(nodeId)`
  List all adjacent nodes & relation directions.
* `getStats()`
  `{ nodeCount, relationCount, avgDegree }`

---

## Contributing

1. Fork the repo
2. Create a feature branch `git checkout -b feat/my-feature`
3. Commit your changes (`git commit -m 'Add awesome feature'`)
4. Push (`git push origin feat/my-feature`)
5. Open a Pull Request

Please file issues for bugs or feature requests via GitHub Issues.

---

## License

This project is licensed under the **MIT License**.
See [LICENSE](./LICENSE) for details.

---

> Built with ♥ by [freakynit](https://github.com/freakynit)
