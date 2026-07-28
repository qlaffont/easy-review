import type { PullRequestFile } from "#/lib/session/types.ts";

export type FileTreeFileNode = {
    kind: "file";
    /** Basename shown in the tree. */
    name: string;
    file: PullRequestFile;
};

export type FileTreeDirNode = {
    kind: "dir";
    /** Display label — may include compacted segments (`a/b/c`). */
    name: string;
    /** Stable key for expand/collapse (joined path under the tree root). */
    path: string;
    children: Array<FileTreeNode>;
};

export type FileTreeNode = FileTreeFileNode | FileTreeDirNode;

type MutableDir = {
    kind: "dir";
    name: string;
    path: string;
    dirs: Map<string, MutableDir>;
    files: Array<FileTreeFileNode>;
};

function emptyDir(name: string, path: string): MutableDir {
    return { kind: "dir", name, path, dirs: new Map(), files: [] };
}

function freezeDir(dir: MutableDir): FileTreeDirNode {
    const dirs = [...dir.dirs.values()].map(freezeDir).sort((a, b) => a.name.localeCompare(b.name));
    const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
    return { kind: "dir", name: dir.name, path: dir.path, children: [...dirs, ...files] };
}

/** Collapse chains of single-child directories into one label (`src/main/kotlin`). */
export function compactFileTree(nodes: ReadonlyArray<FileTreeNode>): Array<FileTreeNode> {
    return nodes.map((node) => {
        if (node.kind === "file") {
            return node;
        }

        let current: FileTreeDirNode = {
            ...node,
            children: compactFileTree(node.children),
        };

        while (current.children.length === 1 && current.children[0]!.kind === "dir") {
            const only = current.children[0]!;
            current = {
                kind: "dir",
                name: `${current.name}/${only.name}`,
                path: only.path,
                children: only.children,
            };
        }

        return current;
    });
}

/** Build a directory tree from flat PR file paths (GitHub-style, with path compacting). */
export function buildFileTree(files: ReadonlyArray<PullRequestFile>): Array<FileTreeNode> {
    const root = emptyDir("", "");

    for (const file of files) {
        const segments = file.path.split("/").filter(Boolean);
        if (segments.length === 0) {
            continue;
        }

        let cursor = root;
        for (let index = 0; index < segments.length - 1; index += 1) {
            const segment = segments[index]!;
            const nextPath = cursor.path ? `${cursor.path}/${segment}` : segment;
            let next = cursor.dirs.get(segment);
            if (!next) {
                next = emptyDir(segment, nextPath);
                cursor.dirs.set(segment, next);
            }
            cursor = next;
        }

        const name = segments[segments.length - 1]!;
        cursor.files.push({ kind: "file", name, file });
    }

    return compactFileTree(freezeDir(root).children);
}

/** Directory paths that should start expanded (every dir in the tree). */
export function defaultExpandedDirPaths(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
    const paths = new Set<string>();

    function walk(list: ReadonlyArray<FileTreeNode>) {
        for (const node of list) {
            if (node.kind === "dir") {
                paths.add(node.path);
                walk(node.children);
            }
        }
    }

    walk(nodes);
    return paths;
}
