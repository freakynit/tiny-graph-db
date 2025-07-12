const TinyGraphDB = require('./index.js');
const fs = require('fs');

class PerformanceBenchmark {
    constructor() {
        this.db = null;
        this.nodeIds = [];
        this.relationIds = [];
        this.testDbPath = './benchmark_test.json';
    }

    // Generate random string
    generateRandomString(length = 10) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Generate random number in range
    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Generate random metadata
    generateRandomMetadata() {
        const types = ['document', 'concept', 'person', 'organization', 'location', 'event'];
        const domains = ['AI', 'Science', 'Technology', 'History', 'Literature', 'Medicine'];
        const categories = ['research', 'news', 'reference', 'entertainment', 'education'];

        return {
            type: types[this.randomInt(0, types.length - 1)],
            domain: domains[this.randomInt(0, domains.length - 1)],
            category: categories[this.randomInt(0, categories.length - 1)],
            priority: this.randomInt(1, 10),
            score: Math.random() * 100,
            active: Math.random() > 0.5,
            createdAt: new Date(Date.now() - this.randomInt(0, 365 * 24 * 60 * 60 * 1000)).toISOString(),
            tags: [
                this.generateRandomString(5),
                this.generateRandomString(6),
                this.generateRandomString(4)
            ],
            count: this.randomInt(1, 1000),
            version: `${this.randomInt(1, 5)}.${this.randomInt(0, 9)}.${this.randomInt(0, 9)}`
        };
    }

    // Generate relation metadata
    generateRelationMetadata() {
        return {
            confidence: Math.random(),
            weight: this.randomInt(1, 100),
            strength: Math.random() * 10,
            verified: Math.random() > 0.3,
            source: this.generateRandomString(8),
            timestamp: new Date(Date.now() - this.randomInt(0, 30 * 24 * 60 * 60 * 1000)).toISOString(),
            bidirectional: Math.random() > 0.5
        };
    }

    // Setup database
    setupDatabase(nodeCount = 1000, relationCount = 2000) {
        console.log(`Setting up database with ${nodeCount} nodes and ${relationCount} relations...`);

        // Remove existing test file
        if (fs.existsSync(this.testDbPath)) {
            fs.unlinkSync(this.testDbPath);
        }

        this.db = new TinyGraphDB(this.testDbPath);
        this.nodeIds = [];
        this.relationIds = [];

        const startTime = Date.now();

        // Create nodes
        console.log('Creating nodes...');
        for (let i = 0; i < nodeCount; i++) {
            const nodeName = `Node_${i}_${this.generateRandomString(8)}`;
            const metadata = this.generateRandomMetadata();
            const node = this.db.addNode(nodeName, metadata, true);
            this.nodeIds.push(node.id);

            if (i % 100 === 0) {
                process.stdout.write(`\rNodes created: ${i}/${nodeCount}`);
            }
        }
        console.log(`\nNodes created: ${nodeCount}`);

        // Create relations
        console.log('Creating relations...');
        const relationNames = ['contains', 'authored_by', 'related_to', 'depends_on', 'similar_to', 'part_of'];

        for (let i = 0; i < relationCount; i++) {
            const fromNodeId = this.nodeIds[this.randomInt(0, this.nodeIds.length - 1)];
            const toNodeId = this.nodeIds[this.randomInt(0, this.nodeIds.length - 1)];

            // Avoid self-relations
            if (fromNodeId === toNodeId) continue;

            const relationName = relationNames[this.randomInt(0, relationNames.length - 1)];
            const metadata = this.generateRelationMetadata();

            try {
                const relation = this.db.addRelation(relationName, fromNodeId, toNodeId, metadata, true);
                this.relationIds.push(relation.id);
            } catch (error) {
                // Skip if any error
                continue;
            }

            if (i % 100 === 0) {
                process.stdout.write(`\rRelations created: ${i}/${relationCount}`);
            }
        }
        console.log(`\nRelations created: ${this.relationIds.length}`);

        const setupTime = Date.now() - startTime;
        console.log(`Database setup completed in ${setupTime}ms`);
        console.log(`Final stats:`, this.db.getStats());
    }

    // Benchmark getNode operations
    benchmarkGetNode(iterations = 1000) {
        console.log(`\n=== Benchmarking getNode() with ${iterations} iterations ===`);

        const times = [];
        let successCount = 0;

        for (let i = 0; i < iterations; i++) {
            const randomNodeId = this.nodeIds[this.randomInt(0, this.nodeIds.length - 1)];

            const startTime = process.hrtime.bigint();
            const result = this.db.getNode(randomNodeId);
            const endTime = process.hrtime.bigint();

            const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            times.push(duration);

            if (result) successCount++;
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const medianTime = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

        console.log(`Results for getNode():`);
        console.log(`  Success rate: ${successCount}/${iterations} (${((successCount/iterations)*100).toFixed(2)}%)`);
        console.log(`  Average time: ${avgTime.toFixed(4)}ms`);
        console.log(`  Median time: ${medianTime.toFixed(4)}ms`);
        console.log(`  Min time: ${minTime.toFixed(4)}ms`);
        console.log(`  Max time: ${maxTime.toFixed(4)}ms`);
        console.log(`  Operations per second: ${(1000 / avgTime).toFixed(0)} ops/sec`);

        return { avgTime, minTime, maxTime, medianTime, successRate: successCount / iterations };
    }

    // Benchmark traverseFromNode operations
    benchmarkTraverseFromNode(iterations = 100) {
        console.log(`\n=== Benchmarking traverseFromNode() with ${iterations} iterations ===`);

        const times = [];
        let totalResults = 0;

        for (let i = 0; i < iterations; i++) {
            const randomNodeId = this.nodeIds[this.randomInt(0, this.nodeIds.length - 1)];

            const startTime = process.hrtime.bigint();
            const result = this.db.traverseFromNode(randomNodeId, { maxDepth: 1 });
            const endTime = process.hrtime.bigint();

            const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            times.push(duration);
            totalResults += result.length;
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const medianTime = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
        const avgResults = totalResults / iterations;

        console.log(`Results for traverseFromNode():`);
        console.log(`  Average results per traversal: ${avgResults.toFixed(2)}`);
        console.log(`  Average time: ${avgTime.toFixed(4)}ms`);
        console.log(`  Median time: ${medianTime.toFixed(4)}ms`);
        console.log(`  Min time: ${minTime.toFixed(4)}ms`);
        console.log(`  Max time: ${maxTime.toFixed(4)}ms`);
        console.log(`  Operations per second: ${(1000 / avgTime).toFixed(0)} ops/sec`);

        return { avgTime, minTime, maxTime, medianTime, avgResults };
    }

    // Benchmark searchNodes operations
    benchmarkSearchNodes(iterations = 100) {
        console.log(`\n=== Benchmarking searchNodes() with ${iterations} iterations ===`);

        const searchConditions = [
            { metadata: { type: 'document' } },
            { metadata: { domain: 'AI' } },
            { metadata: { priority: { gt: 5 } } },
            { metadata: { score: { lt: 50 } } },
            { metadata: { active: true } },
            { metadata: { category: 'research' } },
            { metadata: { count: { gte: 100, lt: 500 } } },
            { metadata: { confidence: { gt: 0.7 } } }, // This might not match since it's relation metadata
            { name: { contains: 'Node' } },
            { metadata: { type: 'concept', domain: 'Science' } }
        ];

        const times = [];
        let totalResults = 0;

        for (let i = 0; i < iterations; i++) {
            const condition = searchConditions[this.randomInt(0, searchConditions.length - 1)];

            const startTime = process.hrtime.bigint();
            const result = this.db.searchNodes(condition);
            const endTime = process.hrtime.bigint();

            const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            times.push(duration);
            totalResults += result.length;
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const medianTime = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
        const avgResults = totalResults / iterations;

        console.log(`Results for searchNodes():`);
        console.log(`  Average results per search: ${avgResults.toFixed(2)}`);
        console.log(`  Average time: ${avgTime.toFixed(4)}ms`);
        console.log(`  Median time: ${medianTime.toFixed(4)}ms`);
        console.log(`  Min time: ${minTime.toFixed(4)}ms`);
        console.log(`  Max time: ${maxTime.toFixed(4)}ms`);
        console.log(`  Operations per second: ${(1000 / avgTime).toFixed(0)} ops/sec`);

        return { avgTime, minTime, maxTime, medianTime, avgResults };
    }

    // Run all benchmarks
    runAllBenchmarks(nodeCount = 1000, relationCount = 2000) {
        console.log('🚀 Starting TinyGraphDB Performance Benchmarks\n');

        const overallStartTime = Date.now();

        this.setupDatabase(nodeCount, relationCount);

        const getNodeResults = this.benchmarkGetNode(1000);
        const traverseResults = this.benchmarkTraverseFromNode(100);
        const searchResults = this.benchmarkSearchNodes(100);

        const overallTime = Date.now() - overallStartTime;

        console.log(`\n=== SUMMARY ===`);
        console.log(`Database size: ${nodeCount} nodes, ${this.relationIds.length} relations`);
        console.log(`Total benchmark time: ${overallTime}ms`);
        console.log(`\nOperation Performance:`);
        console.log(`  getNode():         ${getNodeResults.avgTime.toFixed(4)}ms avg (${(1000/getNodeResults.avgTime).toFixed(0)} ops/sec)`);
        console.log(`  traverseFromNode(): ${traverseResults.avgTime.toFixed(4)}ms avg (${(1000/traverseResults.avgTime).toFixed(0)} ops/sec)`);
        console.log(`  searchNodes():     ${searchResults.avgTime.toFixed(4)}ms avg (${(1000/searchResults.avgTime).toFixed(0)} ops/sec)`);

        // Cleanup
        this.cleanup();

        return {
            nodeCount,
            relationCount: this.relationIds.length,
            getNode: getNodeResults,
            traverseFromNode: traverseResults,
            searchNodes: searchResults,
            totalTime: overallTime
        };
    }

    // Cleanup test files
    cleanup() {
        try {
            if (fs.existsSync(this.testDbPath)) {
                fs.unlinkSync(this.testDbPath);
                console.log(`\nCleaned up test file: ${this.testDbPath}`);
            }
        } catch (error) {
            console.log(`Warning: Could not cleanup test file: ${error.message}`);
        }
    }

    // Run multiple benchmark rounds for statistical significance
    runMultipleRounds(rounds = 3, nodeCount = 1000, relationCount = 2000) {
        console.log(`🔄 Running ${rounds} benchmark rounds for statistical significance\n`);

        const allResults = [];

        for (let round = 1; round <= rounds; round++) {
            console.log(`\n📊 === ROUND ${round}/${rounds} ===`);
            const result = this.runAllBenchmarks(nodeCount, relationCount);
            allResults.push(result);
        }

        // Calculate averages across rounds
        console.log(`\n\n📈 === MULTI-ROUND SUMMARY ===`);
        const avgGetNode = allResults.reduce((sum, r) => sum + r.getNode.avgTime, 0) / rounds;
        const avgTraverse = allResults.reduce((sum, r) => sum + r.traverseFromNode.avgTime, 0) / rounds;
        const avgSearch = allResults.reduce((sum, r) => sum + r.searchNodes.avgTime, 0) / rounds;

        console.log(`Average across ${rounds} rounds:`);
        console.log(`  getNode():         ${avgGetNode.toFixed(4)}ms (${(1000/avgGetNode).toFixed(0)} ops/sec)`);
        console.log(`  traverseFromNode(): ${avgTraverse.toFixed(4)}ms (${(1000/avgTraverse).toFixed(0)} ops/sec)`);
        console.log(`  searchNodes():     ${avgSearch.toFixed(4)}ms (${(1000/avgSearch).toFixed(0)} ops/sec)`);

        return allResults;
    }
}

// Main execution
if (require.main === module) {
    const benchmark = new PerformanceBenchmark();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const nodeCount = args[0] ? parseInt(args[0]) : 1000;
    const relationCount = args[1] ? parseInt(args[1]) : 2000;
    const rounds = args[2] ? parseInt(args[2]) : 1;

    if (rounds > 1) {
        benchmark.runMultipleRounds(rounds, nodeCount, relationCount);
    } else {
        benchmark.runAllBenchmarks(nodeCount, relationCount);
    }
}

module.exports = PerformanceBenchmark;
