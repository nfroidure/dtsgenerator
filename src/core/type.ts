import fs from 'fs';
import YAML from 'js-yaml';
import path from 'path';
import { TransformerFactory, SourceFile } from 'typescript';
import { globFiles, readStream, readUrl } from '../utils';
import SchemaId from './schemaId';
import { JsonSchemaDraft04 } from './jsonSchemaDraft04';
import { JsonSchemaDraft07 } from './jsonSchemaDraft07';
import { getId, selectSchemaType, setId } from './jsonSchema';

// Schema types

export type JsonSchema = JsonSchemaDraft04.Schema | JsonSchemaDraft07.Schema;
export type JsonSchemaObject = JsonSchemaDraft04.Schema | JsonSchemaDraft07.SchemaObject;

export type SchemaType = 'Draft04' | 'Draft07';

export interface Schema {
    type: SchemaType;
    openApiVersion?: 2 | 3;
    id: SchemaId;
    content: JsonSchema;
    rootSchema?: Schema;
}

export function parseSchema(content: JsonSchema, url?: string): Schema {
    const { type, openApiVersion } = selectSchemaType(content);
    if (url != null) {
        setId(type, content, url);
    }
    const id = getId(type, content);
    return {
        type,
        openApiVersion,
        id: id ? new SchemaId(id) : SchemaId.empty,
        content,
    };
}

export async function readSchemaFromStdin(): Promise<Schema> {
    const data = await readStream(process.stdin);
    const content = parseFileContent(data);
    return parseSchema(content);
}
export async function readSchemasFromFile(pattern: string): Promise<Schema[]> {
    const files = await globFiles(pattern);
    return Promise.all(files.map(async (file) => {
        const data = await fs.promises.readFile(file, { encoding: 'utf-8' });
        const content = parseFileContent(data);
        return parseSchema(content);
    }));
}
export async function readSchemaFromUrl(url: string): Promise<Schema> {
    const data = await readUrl(url);
    const content = parseFileContent(data, url);
    return parseSchema(content, url);
}

export function parseFileContent(content: string, filename?: string): JsonSchema {
    const ext = filename ? path.extname(filename).toLowerCase() : '';
    const maybeYaml = ext === '.yaml' || ext === '.yml';
    try {
        if (maybeYaml) {
            return deepCopy(YAML.safeLoad(content));
        } else {
            return JSON.parse(content);
        }
    } catch (e) {
        if (maybeYaml) {
            return JSON.parse(content);
        } else {
            return deepCopy(YAML.safeLoad(content));
        }
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepCopy(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
}

// Plugin Types

export interface PluginContext {
    option: boolean | Record<string, unknown>;
    inputSchemas: Iterator<[string, Schema]>;
}

export type PreProcessHandler = (contents: Schema[]) => Schema[];

export type Plugin = {
    meta: {
        name: string;
        version: string;
        description?: string;
    };
    preProcess?: (context: PluginContext) => Promise<PreProcessHandler | undefined>;
    postProcess?: (context: PluginContext) => Promise<TransformerFactory<SourceFile> | undefined>;
}

export async function loadPlugin(name: string, option: boolean | Record<string, unknown>): Promise<Plugin | undefined> {
    if (!option) {
        return undefined;
    }

    const mod = await import(name);
    if (!('default' in mod)) {
        console.warn(`The plugin (${name}) is invalid module. That is not default export format.`);
        return undefined;
    }
    const plugin: Plugin = mod.default;
    if (plugin.preProcess != null && typeof plugin.preProcess !== 'function') {
        console.warn(`The plugin (${name}) is invalid module. The 'preProcess' is not a function.`);
        return undefined;
    }
    if (plugin.postProcess != null && typeof plugin.postProcess !== 'function') {
        console.warn(`The plugin (${name}) is invalid module. The 'postProcess' is not a function.`);
        return undefined;
    }
    return plugin;
}
