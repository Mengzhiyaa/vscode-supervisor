import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const contractsDirectory = path.join(repositoryRoot, 'src', 'rpc', 'webview', 'contracts');
const outputDirectory = path.join(repositoryRoot, 'src', 'rpc', 'webview');
const checkOnly = process.argv.includes('--check');

const contractFiles = fs.readdirSync(contractsDirectory)
    .filter(file => file.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

const contracts = contractFiles.map(file => {
    const sourcePath = path.join(contractsDirectory, file);
    const contract = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    validateContract(contract, file);
    return { file, contract };
});

const generated = new Map();
for (const { file, contract } of contracts) {
    generated.set(`${contract.domain}.ts`, renderContract(contract, file));
}
generated.set('protocol.ts', renderProtocolBarrel(contracts.map(({ contract }) => contract.domain)));

const mismatches = [];
for (const [file, content] of generated) {
    const targetPath = path.join(outputDirectory, file);
    const current = fs.existsSync(targetPath)
        ? fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n')
        : undefined;

    if (checkOnly) {
        if (current !== content) {
            mismatches.push(path.relative(repositoryRoot, targetPath));
        }
        continue;
    }

    fs.writeFileSync(targetPath, content);
    console.log(`Generated ${path.relative(repositoryRoot, targetPath)}`);
}

if (mismatches.length > 0) {
    throw new Error([
        'Generated Webview RPC TypeScript is out of sync with its JSON contracts:',
        ...mismatches.map(file => `  - ${file}`),
        'Run `npm run sync:webview-rpc-contracts` to update generated files.',
    ].join('\n'));
}

if (checkOnly) {
    console.log(`Verified ${contracts.length} Webview RPC contracts and ${generated.size} generated files.`);
}

function validateContract(contract, file) {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        throw new Error(`${file}: contract must be an object`);
    }
    if (typeof contract.domain !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(contract.domain)) {
        throw new Error(`${file}: invalid domain '${contract.domain}'`);
    }
    if (!Array.isArray(contract.declarations)) {
        throw new Error(`${file}: declarations must be an array`);
    }
    assertOnlyKeys(contract, ['$schema', 'domain', 'declarations'], file);

    const names = new Set();
    const methods = new Set();
    for (const declaration of contract.declarations) {
        validateDeclaration(declaration, `${file}:${declaration?.name ?? '<unnamed>'}`);
        if (names.has(declaration.name)) {
            throw new Error(`${file}: duplicate declaration '${declaration.name}'`);
        }
        names.add(declaration.name);
        if (declaration.method) {
            if (!declaration.method.startsWith(`${contract.domain}/`)) {
                throw new Error(`${file}: method '${declaration.method}' is outside domain '${contract.domain}'`);
            }
            if (methods.has(declaration.method)) {
                throw new Error(`${file}: duplicate RPC method '${declaration.method}'`);
            }
            methods.add(declaration.method);
        }
    }
}

function validateDeclaration(declaration, location) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
        throw new Error(`${location}: declaration must be an object`);
    }
    if (!['interface', 'enum', 'request', 'notification'].includes(declaration.kind)) {
        throw new Error(`${location}: unsupported kind '${declaration.kind}'`);
    }
    if (typeof declaration.name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(declaration.name)) {
        throw new Error(`${location}: invalid declaration name`);
    }

    if (declaration.kind === 'interface') {
        assertOnlyKeys(declaration, ['kind', 'name', 'fields'], location);
        if (!Array.isArray(declaration.fields)) {
            throw new Error(`${location}: interface fields must be an array`);
        }
        const fieldNames = new Set();
        for (const field of declaration.fields) {
            if (!field || typeof field.name !== 'string' || field.name.length === 0 ||
                typeof field.type !== 'string' || field.type.length === 0) {
                throw new Error(`${location}: invalid interface field`);
            }
            assertOnlyKeys(field, ['name', 'type', 'optional'], `${location}.${field.name}`);
            if (field.optional !== undefined && typeof field.optional !== 'boolean') {
                throw new Error(`${location}.${field.name}: optional must be boolean`);
            }
            if (fieldNames.has(field.name)) {
                throw new Error(`${location}: duplicate field '${field.name}'`);
            }
            fieldNames.add(field.name);
        }
        return;
    }

    if (declaration.kind === 'enum') {
        assertOnlyKeys(declaration, ['kind', 'name', 'members'], location);
        if (!Array.isArray(declaration.members)) {
            throw new Error(`${location}: enum members must be an array`);
        }
        for (const member of declaration.members) {
            if (!member || typeof member.name !== 'string' || member.name.length === 0 ||
                !['string', 'number'].includes(typeof member.value)) {
                throw new Error(`${location}: invalid enum member`);
            }
            assertOnlyKeys(member, ['name', 'value'], `${location}.${member?.name ?? '<unnamed>'}`);
        }
        return;
    }

    if (typeof declaration.method !== 'string' || declaration.method.length === 0 ||
        typeof declaration.paramsType !== 'string' || declaration.paramsType.length === 0) {
        throw new Error(`${location}: RPC method and paramsType are required`);
    }
    if (declaration.kind === 'request' &&
        (typeof declaration.resultType !== 'string' || declaration.resultType.length === 0)) {
        throw new Error(`${location}: request resultType is required`);
    }
    assertOnlyKeys(
        declaration,
        declaration.kind === 'request'
            ? ['kind', 'name', 'method', 'paramsType', 'resultType', 'errorType', 'declarations']
            : ['kind', 'name', 'method', 'paramsType', 'declarations'],
        location,
    );
    if (declaration.declarations !== undefined && !Array.isArray(declaration.declarations)) {
        throw new Error(`${location}: declarations must be an array`);
    }
    for (const local of declaration.declarations ?? []) {
        if (local.kind !== 'interface' && local.kind !== 'enum') {
            throw new Error(`${location}: RPC-local declarations must be interfaces or enums`);
        }
        validateDeclaration(local, `${location}.${local.name ?? '<unnamed>'}`);
    }
}

function assertOnlyKeys(value, allowedKeys, location) {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new Error(`${location}: unexpected property '${key}'`);
        }
    }
}

function renderContract(contract, sourceFile) {
    const hasNotification = contract.declarations.some(declaration => declaration.kind === 'notification');
    const requests = contract.declarations.filter(declaration => declaration.kind === 'request');
    const imports = [];
    if (hasNotification) {
        imports.push('NotificationType');
    }
    if (requests.some(declaration => !isEmptyRequestParams(declaration.paramsType))) {
        imports.push('RequestType');
    }
    if (requests.some(declaration => isEmptyRequestParams(declaration.paramsType))) {
        imports.push('RequestType0');
    }

    const sections = [
        '/*---------------------------------------------------------------------------------------------',
        ` *  AUTO-GENERATED from contracts/${sourceFile}. Do not edit this file directly.`,
        ' *--------------------------------------------------------------------------------------------*/',
        '',
    ];
    if (imports.length > 0) {
        sections.push(`import { ${imports.join(', ')} } from 'vscode-jsonrpc';`, '');
    }
    sections.push(contract.declarations.map(declaration => renderDeclaration(declaration, '')).join('\n\n'));
    return `${sections.join('\n')}\n`;
}

function renderDeclaration(declaration, indentation) {
    switch (declaration.kind) {
        case 'interface':
            return renderInterface(declaration, indentation);
        case 'enum':
            return renderEnum(declaration, indentation);
        case 'request':
        case 'notification':
            return renderRpcDeclaration(declaration, indentation);
        default:
            throw new Error(`Unsupported declaration kind '${declaration.kind}'`);
    }
}

function renderInterface(declaration, indentation) {
    const lines = [`${indentation}export interface ${declaration.name} {`];
    for (const field of declaration.fields) {
        lines.push(`${indentation}    ${field.name}${field.optional ? '?' : ''}: ${field.type};`);
    }
    lines.push(`${indentation}}`);
    return lines.join('\n');
}

function renderEnum(declaration, indentation) {
    const lines = [`${indentation}export enum ${declaration.name} {`];
    for (const member of declaration.members) {
        lines.push(`${indentation}    ${member.name} = ${renderValue(member.value)},`);
    }
    lines.push(`${indentation}}`);
    return lines.join('\n');
}

function renderValue(value) {
    if (typeof value === 'number') {
        return String(value);
    }
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderRpcDeclaration(declaration, indentation) {
    const nestedIndentation = `${indentation}    `;
    const lines = [`${indentation}export namespace ${declaration.name} {`, ''];
    const locals = declaration.declarations ?? [];
    for (const local of locals) {
        lines.push(renderDeclaration(local, nestedIndentation), '');
    }

    if (declaration.kind === 'notification') {
        lines.push(
            `${nestedIndentation}export const type = new NotificationType<${declaration.paramsType}>('${declaration.method}');`
        );
    } else {
        const errorType = declaration.errorType ?? 'void';
        const constructor = isEmptyRequestParams(declaration.paramsType)
            ? `RequestType0<${declaration.resultType}, ${errorType}>`
            : `RequestType<${declaration.paramsType}, ${declaration.resultType}, ${errorType}>`;
        lines.push(`${nestedIndentation}export const type = new ${constructor}('${declaration.method}');`);
    }
    lines.push(`${indentation}}`);
    return lines.join('\n');
}

function isEmptyRequestParams(paramsType) {
    return paramsType === '{}' || paramsType === 'void';
}

function renderProtocolBarrel(domains) {
    const lines = [
        '/*---------------------------------------------------------------------------------------------',
        ' *  AUTO-GENERATED from contracts/*.json. Do not edit this file directly.',
        ' *--------------------------------------------------------------------------------------------*/',
        '',
        ...domains.map(domain => `export * from './${domain}';`),
        '',
    ];
    return lines.join('\n');
}
