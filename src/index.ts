import { CliArgType, parseArgs } from './cli.js';
import { queryExt } from './features/query-ext.js';

const [feature, ...args] = parseArgs();

if (feature.type !== CliArgType.Value) {
  throw new Error(`Expected the first argument type not to be an option!`);
}

switch (feature.value) {
  case 'query-ext': {
    queryExt(args);
    break;
  }

  default:
    throw new Error(`"${feature.value}" is not a known feature!`);
}
