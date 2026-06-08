// @ts-expect-error -- js-yaml types not resolved through Bun's node_modules layout
import * as jsYaml from 'js-yaml';

export default {
  parse(str: string): any {
    return jsYaml.load(str);
  },
  stringify(obj: any): string {
    return jsYaml.dump(obj);
  }
};
