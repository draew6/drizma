#!/usr/bin/env node

import yargs from 'yargs';
import * as fs from 'fs';


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
  
        if (this.fields && this.references) {
            this.fieldsFull = this.fields.map(field => 
                this.model.name + "." + field
            );
            this.referencesFull = this.references.map(reference => 
                this.otherModelName + "." + reference
            );
            this.drizzle = `\t${this.name}:${this.isMany ? "many" : "one"}(${
                this.otherModelName
                }, { fields: [${this.fieldsFull.join(",")}], references: [${this.referencesFull.join(",")}]} )`;

      } else {
            this.drizzle = `\t${this.name}:${this.isMany ? "many" : "one"}(${
                this.otherModelName
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
       public relationships: Relationship[] = []
       
    ) {
      this.drizzle = `export const ${this.name}Relations = relations(${this.name}, ({one, many}) => ({ \n`;
    }
  
    createRelationship(line: string): void {
      const relationship = Relationship.create(line, this);
      this.relationships.push(relationship);
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

        const schema = fs.readFileSync(prismaPath, 'utf-8').split('\n');

        let model: Model | null = null;
        for (const line of schema) {
            if (line.trim().startsWith('//')) {
            continue;
            } else if (line.match(/model (.*?) {/)) {
            const name = line.replace('model', '').replace('{', '').trim();
            model = new Model(name);
            } else if (model && /@relation/.test(line)) {
            model.createRelationship(line);
            } else if (model && line.includes('}')) {
            if (model) {
                models.push(model);
            }
            model = null;
            }
      }

      const drizzleCode = models.map((model) => model.export()).join('');

      fs.appendFileSync(drizzlePath, drizzleCode, 'utf-8');
    }
  )
  .help().argv;