import * as jsYaml from 'js-yaml';

export default {
  parse(str: string): any {
    return jsYaml.load(str);
  },
  stringify(obj: any): string {
    return jsYaml.dump(obj);
  }
};
