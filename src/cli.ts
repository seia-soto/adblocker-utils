export enum CliArgType {
  Option = 0,
  Value = 1,
}

export type CliArg =
  | { type: CliArgType.Option; option: string; value?: string }
  | { type: CliArgType.Value; value: string };

export function parseArgs(argv = process.argv.slice(2)): CliArg[] {
  const inputs: CliArg[] = [];
  for (const v of argv) {
    // In case of option:
    if (v[0] === '-') {
      const option = v[1] === '-' ? v.slice(2) : v.slice(1);
      const delimiterAt = option.indexOf('=');
      if (delimiterAt === -1) {
        inputs.push({
          type: CliArgType.Option,
          option,
        });
      } else {
        inputs.push({
          type: CliArgType.Option,
          option: option.slice(0, delimiterAt),
          value: option.slice(delimiterAt + 1),
        });
      }
    } else {
      // In case of value:
      inputs.push({
        type: CliArgType.Value,
        value: v,
      });
    }
  }
  return inputs;
}
