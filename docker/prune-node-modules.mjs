// Removes everything from node_modules that the server can't reach from package.json's
// production dependencies. Yarn 1 also installs packages that only satisfy optional
// peer dependencies (here the whole Prisma CLI); the API never loads them, so they only
// add size and vulnerabilities to the runtime image.
//
// Usage: node prune-node-modules.mjs <app dir> [packages to drop even if referenced...]
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const forceDrop = new Set(process.argv.slice(3));
const modules = path.join(root, 'node_modules');

const readManifest = (dir) => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));

// Node's resolution: look in <dir>/node_modules, then every parent up to the root
const resolve = (fromDir, name) => {
    for (let dir = fromDir; dir.startsWith(root); dir = path.dirname(dir)) {
        const candidate = path.join(dir, 'node_modules', name);
        if (existsSync(path.join(candidate, 'package.json'))) return candidate;
        if (dir === root) break;
    }
    return null;
};

const reachable = new Set();
const visit = (dir) => {
    if (reachable.has(dir)) return;
    reachable.add(dir);
    const manifest = readManifest(dir);
    const deps = {
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        // Installed peers are part of what a package may load
        ...manifest.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
        if (forceDrop.has(name)) continue;
        const found = resolve(dir, name);
        if (found) visit(found);
    }
};

const app = readManifest(root);
for (const name of Object.keys(app.dependencies ?? {})) {
    const found = resolve(root, name);
    if (found) visit(found);
}

// Top-level packages (including @scope/name) nobody reaches
const installed = readdirSync(modules)
    .filter((entry) => !entry.startsWith('.'))
    .flatMap((entry) =>
        entry.startsWith('@')
            ? readdirSync(path.join(modules, entry)).map((child) => path.join(modules, entry, child))
            : [path.join(modules, entry)]
    )
    .filter((dir) => existsSync(path.join(dir, 'package.json')));

let removed = 0;
for (const dir of installed) {
    if (!reachable.has(dir)) {
        rmSync(dir, { recursive: true, force: true });
        removed += 1;
    }
}
console.log(`Pruned ${removed} of ${installed.length} top-level packages`);
