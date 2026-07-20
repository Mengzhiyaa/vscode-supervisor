import fs from 'fs';
import path from 'path';
import process from 'process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const printer = ts.createPrinter({ removeComments: true });
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const positronRoot = path.resolve(
    process.env.POSITRON_ROOT ?? path.join(repositoryRoot, '..', 'positron'),
);
const snapshotPath = path.join(
    repositoryRoot,
    'src',
    'supervisor',
    'contracts',
    'positron-upstream-contract.json',
);
const checkOnly = process.argv.includes('--check');

const upstreamApiPath = path.join(positronRoot, 'src', 'positron-dts', 'positron.d.ts');
const upstreamRuntimePath = path.join(
    positronRoot,
    'src',
    'vs',
    'workbench',
    'services',
    'languageRuntime',
    'common',
    'languageRuntimeService.ts',
);
const upstreamClassifierPath = path.join(
    positronRoot,
    'src',
    'vs',
    'workbench',
    'api',
    'browser',
    'positron',
    'mainThreadLanguageRuntime.ts',
);
const localRuntimePath = path.join(repositoryRoot, 'src', 'internal', 'runtimeTypes.ts');
const localCompatibilityPath = path.join(repositoryRoot, 'src', 'supervisor', 'positron.ts');

for (const requiredPath of [
    upstreamApiPath,
    upstreamRuntimePath,
    upstreamClassifierPath,
    localRuntimePath,
    localCompatibilityPath,
]) {
    if (!fs.existsSync(requiredPath)) {
        throw new Error(
            `Required contract source does not exist: ${requiredPath}\n` +
            'Set POSITRON_ROOT to a Positron checkout containing src/positron-dts and src/vs/workbench.',
        );
    }
}

const upstreamApi = parseSource(upstreamApiPath);
const upstreamModule = findModuleBlock(upstreamApi, 'positron');
const upstreamRuntime = parseSource(upstreamRuntimePath);
const upstreamClassifier = parseSource(upstreamClassifierPath);
const localRuntime = parseSource(localRuntimePath);
const localCompatibility = parseSource(localCompatibilityPath);

const watchedTopLevel = [
    'LanguageRuntimeMessageType',
    'LanguageRuntimeMessage',
    'LanguageRuntimeOutput',
    'LanguageRuntimeResult',
    'LanguageRuntimeUpdateOutput',
    'EnvironmentVariableAction',
];
const watchedNamespaces = {
    window: [
        'createRawLogOutputChannel',
        'showSimpleModalDialogPrompt',
        'showSimpleModalDialogInputPrompt',
        'showSimpleModalDialogMessage',
        'onDidChangeConsoleWidth',
        'getConsoleWidth',
    ],
    runtime: ['getForegroundSession', 'registerClientInstance'],
    methods: ['call'],
    environment: ['getEnvironmentContributions'],
};

const snapshot = {
    description: 'Watched Positron contracts used by the VS Code compatibility and rich-output bridges.',
    sources: [
        'src/positron-dts/positron.d.ts',
        'src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts',
        'src/vs/workbench/api/browser/positron/mainThreadLanguageRuntime.ts',
    ],
    publicApi: {
        declarations: Object.fromEntries(watchedTopLevel.map(name => [
            name,
            canonicalNode(requireNamedDeclaration(upstreamModule.statements, name, upstreamApi)),
        ])),
        namespaces: Object.fromEntries(Object.entries(watchedNamespaces).map(([namespaceName, members]) => {
            const namespace = findModuleBlockInStatements(upstreamModule.statements, namespaceName, upstreamApi);
            return [namespaceName, Object.fromEntries(members.map(memberName => [
                memberName,
                canonicalNode(requireNamedDeclaration(namespace.statements, memberName, upstreamApi)),
            ]))];
        })),
    },
    runtimeInternals: {
        RuntimeOutputKind: canonicalNode(
            requireNamedDeclaration(upstreamRuntime.statements, 'RuntimeOutputKind', upstreamRuntime),
        ),
        PositronOutputLocation: canonicalNode(
            requireNamedDeclaration(upstreamRuntime.statements, 'PositronOutputLocation', upstreamRuntime),
        ),
        inferPositronOutputKind: canonicalNode(
            requireMethod(upstreamClassifier, 'inferPositronOutputKind'),
        ),
    },
};

verifyLocalEnums(upstreamModule, upstreamRuntime, localRuntime);
verifyLocalPublicInterfaceFields(upstreamModule, upstreamApi, localRuntime, [
    'LanguageRuntimeMessage',
    'LanguageRuntimeOutput',
    'LanguageRuntimeResult',
    'LanguageRuntimeUpdateOutput',
]);
verifyLocalCompatibilitySurface(localCompatibility, watchedNamespaces);

const generated = `${JSON.stringify(snapshot, null, 2)}\n`;
const current = fs.existsSync(snapshotPath)
    ? fs.readFileSync(snapshotPath, 'utf8').replace(/\r\n/g, '\n')
    : undefined;

if (checkOnly) {
    if (current !== generated) {
        throw new Error([
            'The watched Positron API/runtime structure changed.',
            `Upstream root: ${positronRoot}`,
            `Snapshot: ${path.relative(repositoryRoot, snapshotPath)}`,
            'Review the upstream change, update compatibility/output routing, then run `npm run sync:positron-contracts`.',
        ].join('\n'));
    }
    console.log('Verified watched Positron API, runtime enums, and rich-output classifier.');
} else {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, generated);
    console.log(`Updated ${path.relative(repositoryRoot, snapshotPath)} from ${positronRoot}`);
}

function parseSource(file) {
    return ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TS,
    );
}

function findModuleBlock(sourceFile, moduleName) {
    return findModuleBlockInStatements(sourceFile.statements, moduleName, sourceFile);
}

function findModuleBlockInStatements(statements, moduleName, sourceFile) {
    const declaration = statements.find(statement =>
        ts.isModuleDeclaration(statement) && declarationName(statement) === moduleName,
    );
    if (!declaration?.body || !ts.isModuleBlock(declaration.body)) {
        throw new Error(`${sourceFile.fileName}: namespace/module '${moduleName}' was not found`);
    }
    return declaration.body;
}

function declarationName(node) {
    const name = node.name;
    if (!name) {
        return undefined;
    }
    return ts.isIdentifier(name) || ts.isStringLiteral(name)
        ? name.text
        : name.getText(node.getSourceFile());
}

function requireNamedDeclaration(statements, name, sourceFile) {
    for (const statement of statements) {
        if (declarationName(statement) === name) {
            return statement;
        }
        if (ts.isVariableStatement(statement)) {
            const declaration = statement.declarationList.declarations.find(candidate =>
                ts.isIdentifier(candidate.name) && candidate.name.text === name,
            );
            if (declaration) {
                return statement;
            }
        }
    }
    throw new Error(`${sourceFile.fileName}: declaration '${name}' was not found`);
}

function requireMethod(sourceFile, methodName) {
    let found;
    const visit = node => {
        if (found) {
            return;
        }
        if (ts.isMethodDeclaration(node) && declarationName(node) === methodName) {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!found) {
        throw new Error(`${sourceFile.fileName}: method '${methodName}' was not found`);
    }
    return found;
}

function canonicalNode(node) {
    return printer
        .printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
        .replace(/\s+/g, ' ')
        .trim();
}

function enumMembers(sourceFile, name) {
    const declaration = requireNamedDeclaration(sourceFile.statements, name, sourceFile);
    if (!ts.isEnumDeclaration(declaration)) {
        throw new Error(`${sourceFile.fileName}: '${name}' is not an enum`);
    }
    return Object.fromEntries(declaration.members.map(member => [
        member.name.getText(sourceFile),
        member.initializer?.getText(sourceFile) ?? '<implicit>',
    ]));
}

function moduleEnumMembers(moduleBlock, sourceFile, name) {
    const declaration = requireNamedDeclaration(moduleBlock.statements, name, sourceFile);
    if (!ts.isEnumDeclaration(declaration)) {
        throw new Error(`${sourceFile.fileName}: '${name}' is not an enum`);
    }
    return Object.fromEntries(declaration.members.map(member => [
        member.name.getText(sourceFile),
        member.initializer?.getText(sourceFile) ?? '<implicit>',
    ]));
}

function verifyLocalEnums(publicModule, upstreamRuntimeSource, localRuntimeSource) {
    const comparisons = [
        [
            'LanguageRuntimeMessageType',
            moduleEnumMembers(publicModule, upstreamApi, 'LanguageRuntimeMessageType'),
            enumMembers(localRuntimeSource, 'LanguageRuntimeMessageType'),
        ],
        [
            'RuntimeOutputKind',
            enumMembers(upstreamRuntimeSource, 'RuntimeOutputKind'),
            enumMembers(localRuntimeSource, 'RuntimeOutputKind'),
        ],
        [
            'PositronOutputLocation',
            enumMembers(upstreamRuntimeSource, 'PositronOutputLocation'),
            enumMembers(localRuntimeSource, 'PositronOutputLocation'),
        ],
    ];
    for (const [name, upstream, local] of comparisons) {
        if (JSON.stringify(sortObject(upstream)) !== JSON.stringify(sortObject(local))) {
            throw new Error(
                `Local enum '${name}' differs from Positron. ` +
                `upstream=${JSON.stringify(upstream)}, local=${JSON.stringify(local)}`,
            );
        }
    }
}

function verifyLocalPublicInterfaceFields(publicModule, publicSource, localSource, interfaceNames) {
    for (const name of interfaceNames) {
        const upstreamDeclaration = requireNamedDeclaration(publicModule.statements, name, publicSource);
        const localDeclaration = requireNamedDeclaration(localSource.statements, name, localSource);
        if (!ts.isInterfaceDeclaration(upstreamDeclaration) || !ts.isInterfaceDeclaration(localDeclaration)) {
            throw new Error(`Expected '${name}' to be an interface in both Positron and local runtime contracts`);
        }

        const upstreamFields = interfaceFieldContracts(upstreamDeclaration, publicSource);
        const localFields = interfaceFieldContracts(localDeclaration, localSource);
        for (const [fieldName, upstreamField] of Object.entries(upstreamFields)) {
            const localField = localFields[fieldName];
            if (!localField) {
                throw new Error(`Local interface '${name}' is missing Positron field '${fieldName}'`);
            }
            if (localField.type !== upstreamField.type || localField.optional !== upstreamField.optional) {
                throw new Error(
                    `Local field '${name}.${fieldName}' differs from Positron: ` +
                    `upstream=${JSON.stringify(upstreamField)}, local=${JSON.stringify(localField)}`,
                );
            }
        }
    }
}

function interfaceFieldContracts(declaration, sourceFile) {
    const fields = {};
    for (const member of declaration.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) {
            continue;
        }
        fields[member.name.getText(sourceFile)] = {
            optional: member.questionToken !== undefined,
            type: member.type.getText(sourceFile).replace(/\s+/g, ' ').trim(),
        };
    }
    return fields;
}

function verifyLocalCompatibilitySurface(sourceFile, namespaces) {
    for (const [namespaceName, members] of Object.entries(namespaces)) {
        const statement = requireNamedDeclaration(sourceFile.statements, namespaceName, sourceFile);
        if (!ts.isVariableStatement(statement)) {
            throw new Error(`${sourceFile.fileName}: compatibility '${namespaceName}' is not an exported object`);
        }
        const declaration = statement.declarationList.declarations.find(candidate =>
            ts.isIdentifier(candidate.name) && candidate.name.text === namespaceName,
        );
        if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
            throw new Error(`${sourceFile.fileName}: compatibility '${namespaceName}' has no object literal`);
        }
        const localMembers = new Set(declaration.initializer.properties.map(property => declarationName(property)));
        for (const member of members) {
            if (!localMembers.has(member)) {
                throw new Error(
                    `${sourceFile.fileName}: Positron compatibility member '${namespaceName}.${member}' is missing`,
                );
            }
        }
    }
}

function sortObject(value) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
