#!/usr/bin/env node

import yargs from 'yargs';
import * as fs from 'fs';
import test from 'node:test';


class Relationship {
  constructor(
    public isMany: boolean,
    public otherModelName: string,
    public name: string | null,
    public alias: string | null,
    public fields: string[] | null,
    public references: string[] | null,
    public model: Model,
    public fieldsFull: string[] = [],
    public referencesFull: string[] = [],
    public drizzle: string = ""

  ) {

    if (this.fields?.length && this.references?.length) {
      this.fieldsFull = this.fields.map(field =>
        this.model.name + "." + field
      );
      this.referencesFull = this.references.map(reference =>
        this.otherModelName + "." + reference
      );
      this.drizzle = `\t${this.name}:${this.isMany ? "many" : "one"}(${this.otherModelName
        }, { fields: [${this.fieldsFull.join(",")}], references: [${this.referencesFull.join(",")}]} )`;

    } else {
      this.drizzle = `\t${this.name}:${this.isMany ? "many" : "one"}(${this.otherModelName
        })`;
    }
  }

  static create(line: string, model: Model): Relationship {
    const relationField = line.trim().replace(/[ ,]+/g, ",");
    const relationParts = relationField.split(",");
    const relationInfo = line.match(/@relation\((.*?)\)/)![1].split(",");

    let relationAlias: string | null, relationAttributeTexts: string[];

    if (!relationInfo[0].includes("fields")) {
      relationAlias = relationInfo[0].replace(/"/g, "");
      relationAttributeTexts = relationInfo.slice(1);
    } else {
      relationAlias = null;
      relationAttributeTexts = relationInfo;
    }

    const relationAttributes: { [key: string]: string } = {};
    relationAttributeTexts.forEach((attribute) => {
      const [key, value] = attribute.split(":").map((s) => s.trim());
      relationAttributes[key] = value.replace(/"/g, "");
    });

    const isMany =
      relationParts.length > 1 ? relationParts[1].includes("[]") : false;
    const relatedModelName =
      relationParts.length > 1
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

    return new Relationship(
      isMany,
      relatedModelName!,
      relationParts[0],
      relationAlias,
      relationFields,
      relationReferences,
      model
    );
  }
}

class Model {
  constructor(
    public name: string,
    public drizzle: string = "",
    public relationships: Relationship[] = [],
    public fields: [string, string][] = []

  ) {
    this.drizzle = `export const ${this.name}Relations = relations(${this.name}, ({one, many}) => ({ \n`;
  }

  createRelationship(line: string): void {
    const relationship = Relationship.create(line, this);
    this.relationships.push(relationship);
  }

  createField(line: string): void {
    const field = line.trim().replace(/[ ,]+/g, ",");
    const fieldParts = field.split(",");
    const fieldName = fieldParts[0];
    const fieldType = fieldParts[1];
    this.fields.push([fieldName, fieldType]);
  }

  createRelationshipsFromFields(modelNames: string[]): void {
    for (const field of this.fields) {
      const fieldName = field[0];
      let fieldType = field[1];

      let optional = false
      let many = false

      if (fieldType.includes("[]")) {
        many = true
        fieldType = fieldType.replace("[]", "")
      } else if (fieldType.includes("?")) {
        optional = true
        fieldType = fieldType.replace("?", "")
      }

      if (modelNames.includes(fieldType)) {
        const otherModelName = fieldType
        const name = fieldName
        const alias = null
        const fields = null
        const references = null
        const model = this
        const fieldsFull: string[] = []
        const referencesFull: string[] = []
        const drizzle = ""
        const relationship = new Relationship(many, otherModelName, name, alias, fields, references, model, fieldsFull, referencesFull, drizzle)
        this.relationships.push(relationship)

      }
    }
  }

  export(): string {
    let code = this.drizzle;
    for (const relation of this.relationships) {
      code += `${relation.drizzle},\n`;
    }
    code += "}))\n";
    return code;
  }
}


yargs
  .command(
    '$0 <prisma_path> <drizzle_path>',
    'Process Prisma schema and generate Drizzle code',
    (yargs) => {
      yargs.positional('prisma_path', {
        describe: 'Path to the Prisma schema file',
        type: 'string',
      });
      yargs.positional('drizzle_path', {
        describe: 'Path to the Drizzle code output file',
        type: 'string',
      });
    },
    (argv) => {
      const prismaPath = argv.prisma_path as string;
      const drizzlePath = argv.drizzle_path as string;

      console.log(`Processing schema at: ${prismaPath}`);

      const models: Model[] = [];
      const enums: string[] = [];

      const schemaContent = fs.readFileSync(prismaPath, 'utf-8')
      const schema = schemaContent.split('\n');

      let model: Model | null = null;
      for (const line of schema) {
        if (line.trim().startsWith('//')) {
          continue;
        } else if (line.match(/model (.*?) {/)) {
          const name = line.replace('model', '').replace('{', '').trim();
          model = new Model(name);
        } else if (line.match(/enum (.*?) {/)) {
          const name = line.replace('enum', '').replace('{', '').trim();
          enums.push(name);
        }
         else if (model && /@relation/.test(line)) {
          model.createRelationship(line);
        } else if (model && line.includes('}')) {
          if (model) {
            models.push(model);
          }
          model = null;
        }
        else if (model) {
          model.createField(line);
        }
      }
      for (const model of models) {
        model.createRelationshipsFromFields(models.map(model => model.name));
      }

      const drizzleCode = models.filter(model => model.relationships.length > 0).map((model) => model.export()).join('');
      
      fs.readFile(drizzlePath, 'utf8', (err, data) => {
        const importLine = `import {relations } from "drizzle-orm"`
        const newData = (importLine + '\n' + (data || '\n') + '\n' + drizzleCode).replace(/: unknown\("([^"]+)"\)/g, (match, p1) => `: ${p1}("${p1}")`);

        fs.writeFile(drizzlePath, newData, 'utf8', (err) => {
          if (err) {
            console.error(err);
          }
        });
      });
      let testSchema = schemaContent
      for (const enumName of enums) {
        testSchema = testSchema.replace(new RegExp(enumName, 'g'), "String")
      }

      testSchema = testSchema
      .replace(/enum\s+\w+\s*\{[^}]*\}/g, '')
      .replace(/(String\s+@default\()([^\s'"]+)(\))/g,'$1"$2"$3')
      .replace("postgresql", "sqlite")
      .replace(`env("DATABASE_URL")`,`"file:./test/test.db"`)
  
      fs.writeFile(prismaPath.replace(".prisma","Test.prisma"), testSchema, 'utf8', (err) => {
        if (err) {
          console.error(err);
        }}
        )
    }
  )
  .help().argv;