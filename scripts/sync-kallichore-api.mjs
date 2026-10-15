import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import process from 'process';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.dirname(repoRoot);
const checkOnly = process.argv.includes('--check');

const kallichoreRoot = path.join(projectRoot, 'kallichore');
const positronSupervisorRoot = path.join(
    projectRoot,
    'positron',
    'extensions',
    'positron-supervisor',
);

const sourceSpec = path.join(kallichoreRoot, 'kallichore.json');
const sourceApi = path.join(positronSupervisorRoot, 'src', 'kcclient', 'api.ts');
const targetSpec = path.join(repoRoot, 'kallichore.json');
const targetApi = path.join(repoRoot, 'src', 'supervisor', 'kcclient', 'api.ts');
const sourceGeneratorVersion = path.join(positronSupervisorRoot, 'src', 'kcclient', '.openapi-generator', 'VERSION');
const targetProvenance = path.join(repoRoot, 'src', 'supervisor', 'kcclient', 'upstream.json');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readKallichoreVersion() {
    const cargoToml = fs.readFileSync(
        path.join(kallichoreRoot, 'crates', 'kcserver', 'Cargo.toml'),
        'utf8',
    );
    const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
    if (!match) {
        throw new Error('Could not read the kcserver version from crates/kcserver/Cargo.toml');
    }
    return match[1];
}

function readPinnedVersion(packagePath) {
    const version = readJson(packagePath)?.positron?.binaryDependencies?.kallichore;
    if (!version) {
        throw new Error(`Missing positron.binaryDependencies.kallichore in ${packagePath}`);
    }
    return version;
}

function standaloneApi(source) {
    const rewritten = source.replaceAll("from 'axios';", "from '../httpClient';");

    if (rewritten === source || rewritten.includes("from 'axios'")) {
        throw new Error('Could not rewrite generated Axios imports to the local HTTP compatibility client');
    }
    // OpenAPI Generator currently emits whitespace-only lines and trailing
    // spaces in JSDoc. Normalize those so `git diff --check` remains useful.
    return rewritten.replace(/[ \t]+$/gm, '').replace(/\s+$/, '\n');
}

function syncFile(sourceContent, destination) {
    const current = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : undefined;
    if (current === sourceContent) {
        console.log(`Up to date: ${path.relative(repoRoot, destination)}`);
        return false;
    }
    if (checkOnly) {
        console.error(`Out of date: ${path.relative(repoRoot, destination)}`);
        return true;
    }
    fs.writeFileSync(destination, sourceContent);
    console.log(`Updated: ${path.relative(repoRoot, destination)}`);
    return true;
}

/** The spec, generated client source and shipped server must share a version. */
export function assertKallichoreVersionsCanSync(versions) {
    const { sourceVersion, standaloneVersion, positronVersion } = versions;
    if (!sourceVersion || sourceVersion !== standaloneVersion || sourceVersion !== positronVersion) {
        throw new Error(
            `Kallichore version mismatch: source=${sourceVersion}, ` +
            `vscode-supervisor=${standaloneVersion}, Positron=${positronVersion}`,
        );
    }
}

function pascalCase(value) {
    return value.replace(/(^|[_-])(\w)/g, (_match, _separator, letter) => letter.toUpperCase());
}

function modelName(value) {
    return value === 'error' ? 'ModelError' : pascalCase(value);
}

function assertSameMembers(label, expected, actual) {
    const missing = [...expected].filter(value => !actual.has(value));
    const extra = [...actual].filter(value => !expected.has(value));
    if (missing.length || extra.length) {
        throw new Error(`${label} mismatch: missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
    }
}

/** Check the generated API's operations, routes, model fields, enums and types. */
export function assertKallichoreApiMatchesSpec(spec, api) {
    const source = ts.createSourceFile('kcclient/api.ts', api, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (source.parseDiagnostics.length) {
        throw new Error('Generated Kallichore API contains TypeScript syntax errors');
    }
    const interfaces = new Map();
    const constants = new Map();
    let defaultApi;
    for (const statement of source.statements) {
        if (ts.isInterfaceDeclaration(statement)) {
            interfaces.set(statement.name.text, statement);
        } else if (ts.isClassDeclaration(statement) && statement.name?.text === 'DefaultApi') {
            defaultApi = statement;
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                constants.set(declaration.name.getText(source), declaration.initializer);
            }
        }
    }
    const schemas = spec.components?.schemas ?? {};
    const normalizeType = value => value.replace(/[\s;]/g, '');
    const typeForSchema = (schema, enumName) => {
        if (schema.$ref) {
            const name = schema.$ref.split('/').at(-1);
            const referenced = schemas[name];
            if (!referenced) {
                throw new Error(`Unknown Kallichore schema reference: ${schema.$ref}`);
            }
            return referenced.type === 'array' ? typeForSchema(referenced) : modelName(name);
        }
        if (schema.enum) {
            return enumName;
        }
        switch (schema.type) {
            case 'string': return 'string';
            case 'integer':
            case 'number': return 'number';
            case 'boolean': return 'boolean';
            case 'array': return `Array<${typeForSchema(schema.items)}>`;
            case 'object': return schema.additionalProperties
                ? `{[key:string]:${typeForSchema(schema.additionalProperties)}}`
                : 'object';
            default: throw new Error(`Unsupported Kallichore schema: ${JSON.stringify(schema)}`);
        }
    };
    const checkEnum = (name, values) => {
        let initializer = constants.get(name);
        if (initializer && ts.isAsExpression(initializer)) {
            initializer = initializer.expression;
        }
        if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
            throw new Error(`Missing Kallichore enum: ${name}`);
        }
        const actual = initializer.properties.map(property => {
            if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) {
                throw new Error(`Unsupported generated Kallichore enum: ${name}`);
            }
            return property.initializer.text;
        });
        assertSameMembers(`Enum ${name}`, new Set(values), new Set(actual));
    };
    for (const [name, schema] of Object.entries(schemas)) {
        const generatedName = modelName(name);
        if (schema.enum) {
            checkEnum(generatedName, schema.enum);
        } else if (schema.type === 'object' && schema.properties) {
            const declaration = interfaces.get(generatedName);
            if (!declaration) {
                throw new Error(`Missing Kallichore model: ${generatedName}`);
            }
            const fields = new Map(declaration.members.filter(ts.isPropertySignature)
                .map(member => [member.name.text, member]));
            assertSameMembers(`Model ${generatedName}`, new Set(Object.keys(schema.properties)), new Set(fields.keys()));
            for (const [field, property] of Object.entries(schema.properties)) {
                const member = fields.get(field);
                const required = schema.required?.includes(field) ?? false;
                if (required === !!member.questionToken) {
                    throw new Error(`Kallichore field optionality mismatch: ${generatedName}.${field}`);
                }
                const enumName = `${generatedName}${pascalCase(field)}Enum`;
                if (property.enum) {
                    checkEnum(enumName, property.enum);
                }
                const expected = typeForSchema(property, enumName);
                if (!member.type || normalizeType(member.type.getText(source)) !== normalizeType(expected)) {
                    throw new Error(`Kallichore field type mismatch: ${generatedName}.${field}; expected ${expected}`);
                }
            }
        }
    }

    const operations = new Map();
    for (const [route, methods] of Object.entries(spec.paths ?? {})) {
        for (const [method, operation] of Object.entries(methods)) {
            if (operation?.operationId) {
                const name = pascalCase(operation.operationId);
                operations.set(name[0].toLowerCase() + name.slice(1), { route, method: method.toUpperCase() });
            }
        }
    }
    const methods = new Set(defaultApi?.members.filter(ts.isMethodDeclaration).map(member => member.name.text) ?? []);
    assertSameMembers('Kallichore operations', new Set(operations.keys()), methods);
    const creator = constants.get('DefaultApiAxiosParamCreator');
    const returned = creator && (ts.isArrowFunction(creator) || ts.isFunctionExpression(creator)) && ts.isBlock(creator.body)
        ? creator.body.statements.find(ts.isReturnStatement)?.expression : undefined;
    if (!returned || !ts.isObjectLiteralExpression(returned)) {
        throw new Error('Missing generated Kallichore request creators');
    }
    const requests = new Map(returned.properties.filter(ts.isPropertyAssignment).map(property => [property.name.text, property.initializer]));
    assertSameMembers('Kallichore request creators', new Set(operations.keys()), new Set(requests.keys()));
    for (const [name, operation] of operations) {
        const request = requests.get(name);
        const declarations = new Map();
        const visit = node => {
            if (ts.isVariableDeclaration(node)) {
                declarations.set(node.name.getText(source), node.initializer);
            }
            ts.forEachChild(node, visit);
        };
        visit(request);
        // The generator applies .replace() calls to a literal path template.
        let route = declarations.get('localVarPath');
        while (route && ts.isCallExpression(route) && ts.isPropertyAccessExpression(route.expression)) {
            route = route.expression.expression;
        }
        const options = declarations.get('localVarRequestOptions');
        const method = options && ts.isObjectLiteralExpression(options)
            ? options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'method')?.initializer
            : undefined;
        if (!route || !ts.isNoSubstitutionTemplateLiteral(route) || route.text !== operation.route ||
            !method || !ts.isStringLiteral(method) || method.text !== operation.method) {
            throw new Error(`Kallichore route/method mismatch: ${name}; expected ${operation.method} ${operation.route}`);
        }
    }
}

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function sourceCommit(root, file) {
    return execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', '--', path.relative(root, file)], {
        encoding: 'utf8',
    }).trim();
}

function main() {
    const sourceVersion = readKallichoreVersion();
    const standaloneVersion = readPinnedVersion(path.join(repoRoot, 'package.json'));
    const positronVersion = readPinnedVersion(path.join(positronSupervisorRoot, 'package.json'));
    assertKallichoreVersionsCanSync({
        sourceVersion,
        standaloneVersion,
        positronVersion,
    });

    // Read and validate all inputs before writing any generated artifact.
    const spec = fs.readFileSync(sourceSpec, 'utf8');
    const api = fs.readFileSync(sourceApi, 'utf8');
    assertKallichoreApiMatchesSpec(JSON.parse(spec), api);
    const standalone = standaloneApi(api);
    const provenance = JSON.stringify({
        schemaVersion: 1,
        kallichore: {
            version: sourceVersion,
            specCommit: sourceCommit(kallichoreRoot, sourceSpec),
            specSha256: sha256(spec),
        },
        positron: {
            kallichoreVersion: positronVersion,
            apiCommit: sourceCommit(path.join(projectRoot, 'positron'), sourceApi),
            apiSha256: sha256(api),
        },
        generator: {
            name: 'typescript-axios',
            version: fs.readFileSync(sourceGeneratorVersion, 'utf8').trim(),
        },
        standaloneApiSha256: sha256(standalone),
    }, null, 2) + '\n';

    console.log(
        `Synchronizing Kallichore ${sourceVersion} API ` +
        `(Positron API source is pinned to ${positronVersion})`,
    );
    const changed = [
        syncFile(spec, targetSpec),
        syncFile(standalone, targetApi),
        syncFile(provenance, targetProvenance),
    ].some(Boolean);

    if (checkOnly && changed) {
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
