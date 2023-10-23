#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const fs = __importStar(require("fs"));
class Relationship {
    constructor(isMany, otherModelName, name, alias, fields, references, model, fieldsFull = [], referencesFull = [], drizzle = "") {
        this.isMany = isMany;
        this.otherModelName = otherModelName;
        this.name = name;
        this.alias = alias;
        this.fields = fields;
        this.references = references;
        this.model = model;
        this.fieldsFull = fieldsFull;
        this.referencesFull = referencesFull;
        this.drizzle = drizzle;
        if (this.fields && this.references) {
            this.fieldsFull = this.fields.map(field => this.model.name + "." + field);
            this.referencesFull = this.references.map(reference => this.otherModelName + "." + reference);
            this.drizzle = `\t${this.name}:${this.isMany ? "many" : "one"}(${this.otherModelName}, { fields: [${this.fieldsFull.join(",")}], references: [${this.referencesFull.join(",")}]} )`;
        }
        else {
            this.drizzle = `\t${this.name}:${this.isMany ? "many" : "one"}(${this.otherModelName})`;
        }
    }
    static create(line, model) {
        const relationField = line.trim().replace(/[ ,]+/g, ",");
        const relationParts = relationField.split(",");
        const relationInfo = line.match(/@relation\((.*?)\)/)[1].split(",");
        let relationAlias, relationAttributeTexts;
        if (!relationInfo[0].includes("fields")) {
            relationAlias = relationInfo[0].replace(/"/g, "");
            relationAttributeTexts = relationInfo.slice(1);
        }
        else {
            relationAlias = null;
            relationAttributeTexts = relationInfo;
        }
        const relationAttributes = {};
        relationAttributeTexts.forEach((attribute) => {
            const [key, value] = attribute.split(":").map((s) => s.trim());
            relationAttributes[key] = value.replace(/"/g, "");
        });
        const isMany = relationParts.length > 1 ? relationParts[1].includes("[]") : false;
        const relatedModelName = relationParts.length > 1
            ? relationParts[1].replace("?", "").replace("[]", "")
            : null;
        const relationFields = relationAttributes["fields"]
            ? relationAttributes["fields"].replace("[", "").replace("]", "").split(",")
            : null;
        const relationReferences = relationAttributes["references"]
            ? relationAttributes["references"]
                .replace("[", "")
                .replace("]", "")
                .split(",")
            : null;
        return new Relationship(isMany, relatedModelName, relationParts[0], relationAlias, relationFields, relationReferences, model);
    }
}
class Model {
    constructor(name, drizzle = "", relationships = []) {
        this.name = name;
        this.drizzle = drizzle;
        this.relationships = relationships;
        this.drizzle = `export const ${this.name}Relations = relations(${this.name}, ({one, many}) => ({ \n`;
    }
    createRelationship(line) {
        const relationship = Relationship.create(line, this);
        this.relationships.push(relationship);
    }
    export() {
        let code = this.drizzle;
        for (const relation of this.relationships) {
            code += `${relation.drizzle},\n`;
        }
        code += "}))\n";
        return code;
    }
}
yargs_1.default
    .command('$0 <prisma_path> <drizzle_path>', 'Process Prisma schema and generate Drizzle code', (yargs) => {
    yargs.positional('prisma_path', {
        describe: 'Path to the Prisma schema file',
        type: 'string',
    });
    yargs.positional('drizzle_path', {
        describe: 'Path to the Drizzle code output file',
        type: 'string',
    });
}, (argv) => {
    const prismaPath = argv.prisma_path;
    const drizzlePath = argv.drizzle_path;
    console.log(`Processing schema at: ${prismaPath}`);
    const models = [];
    const schema = fs.readFileSync(prismaPath, 'utf-8').split('\n');
    let model = null;
    for (const line of schema) {
        if (line.trim().startsWith('//')) {
            continue;
        }
        else if (line.match(/model (.*?) {/)) {
            const name = line.replace('model', '').replace('{', '').trim();
            model = new Model(name);
        }
        else if (model && /@relation/.test(line)) {
            model.createRelationship(line);
        }
        else if (model && line.includes('}')) {
            if (model) {
                models.push(model);
            }
            model = null;
        }
    }
    const drizzleCode = models.map((model) => model.export()).join('');
    fs.appendFileSync(drizzlePath, drizzleCode, 'utf-8');
})
    .help().argv;
