import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliArg, CliArgType } from '../cli.js';
import { CosmeticFilter, NetworkFilter } from '@ghostery/adblocker';

type Library = typeof import('@ghostery/adblocker');

type Options = {
  artifact: string;
  url: string;
  sourceUrl?: string;
  skipRegionals: boolean;
  env?: string;
};

async function configure(args: CliArg[]) {
  const options: Partial<Options> = {
    skipRegionals: false,
  };
  for (const arg of args) {
    if (arg.type === CliArgType.Option) {
      if (typeof arg.value !== 'undefined') {
        if (arg.option === 'a' || arg.option === 'artifact') {
          options.artifact = arg.value;
        } else if (arg.option === 's' || arg.option === 'source-url') {
          options.sourceUrl = arg.value;
        } else if (arg.option === 'e' || arg.option === 'env') {
          options.env = arg.value;
        }
      } else {
        if (arg.option === 'skip-regionals') {
          options.skipRegionals = true;
        }
      }
    }
    if (arg.type === CliArgType.Value) {
      options.url = arg.value;
    }
  }
  if (typeof options.artifact === 'undefined') {
    console.warn(`[warn] retrieving the latest version as source url was not specified...`);
    const response = await fetch(
      `https://api.github.com/repos/ghostery/ghostery-extension/releases`,
    );
    const [{ tag_name: tagName, assets }]: [
      {
        tag_name: string;
        assets: { browser_download_url: string }[];
      },
    ] = await response.json();
    console.log(`[warn] looking for the chromium build of "${tagName}"...`);
    const chromiumArtifact = assets.find((asset) =>
      asset.browser_download_url.includes('ghostery-chromium'),
    );
    if (typeof chromiumArtifact === 'undefined') {
      throw new Error(`Failed to locate chromium artifact from the release of "${tagName}"`);
    }
    options.artifact = chromiumArtifact.browser_download_url;
  }
  if (typeof options.url === 'undefined') {
    throw new Error(`The given URL was not found!`);
  }
  return options as Options;
}

// Returns cache key
function cache(url: string) {
  const hash = createHash('md5').update(url).digest('hex');
  return `./.cache/${hash}`;
}

// Fetch with caching
async function bytes(url: string) {
  if (url.startsWith('file://')) {
    return readFile(url.slice('file://'.length), { encoding: 'binary' });
  }
  const fileUrl = cache(url);
  if (existsSync(fileUrl)) {
    return readFile(fileUrl, { encoding: 'binary' });
  }
  const response = await fetch(url);
  const bytes = await response.bytes();
  await writeFile(fileUrl, bytes, { encoding: 'binary' });
  return bytes;
}

// Pull engines and DNR rules from ghostery-extension artifact
async function pull(url: string) {
  await bytes(url);
  const fileUrl = cache(url);
  const td = `${fileUrl}.tmp.d`;
  execSync(`unzip ${fileUrl} -d ${td}`);
  let version: string = '';
  const list = execSync('ls -R', { cwd: td }).toString().split('\n');
  const assets: Array<{ path: string; data: Buffer }> = [];
  for (let prefix: string = td, i = 0; i < list.length; i++) {
    const name = list[i];
    const path = `${prefix}/${name}`;
    if (name.endsWith(':')) {
      prefix = `${fileUrl}.tmp.d/${name.slice(0, -1)}`;
      continue;
    }
    if (name === 'manifest.json') {
      version = JSON.parse((await readFile(path, 'utf8')).toString()).version;
      continue;
    }
    if (prefix.endsWith('rule_resources')) {
      if (name.endsWith('.dat')) {
        assets.push({
          path,
          data: (await readFile(path)) as unknown as Buffer,
        });
      } else if (name.endsWith('.json')) {
        assets.push({
          path,
          data: (await readFile(path, 'utf8')) as unknown as Buffer,
        });
      }
    }
  }
  execSync(`rm -r ${td}`);
  return { version, assets };
}

// Get adblocker reference from ghostery-extension tag: e.g. tags/<tag>, or heads/main
async function adblocker(ref: string): Promise<Library> {
  const manifest = await bytes(
    `https://raw.githubusercontent.com/ghostery/ghostery-extension/refs/${ref}/package.json`,
  );
  const data: { dependencies: Record<string, string> } = JSON.parse(
    Buffer.from(manifest).toString('utf8'),
  );
  const version = data.dependencies['@ghostery/adblocker']?.replace(/[^\d.]/g, '');
  if (typeof version === 'undefined') {
    throw new Error(
      `Cannot find "@ghostery/adblocker" in the "package.json" file of the repository`,
    );
  }
  // Find cache
  const libPath = `./.cache/adblocker-${version}.d`;
  const entryPath = join(process.cwd(), `${libPath}/dist/esm/index.js`);
  if (existsSync(libPath)) {
    const x = await import(entryPath);
    return x;
  }
  // Build if not found
  const whereIsGit = execSync('which git').toString();
  if (!whereIsGit.startsWith('/') && !whereIsGit.startsWith('.')) {
    throw new Error(`Cannot find the command "git"!`);
  }
  const adblockerPath = './.cache/adblocker';
  if (!existsSync(adblockerPath)) {
    execSync(`git clone https://github.com/ghostery/adblocker.git ${adblockerPath}`);
  }
  execSync(`git checkout tags/v${version}`, { cwd: adblockerPath });
  execSync('yarn && yarn clean && yarn build', { cwd: adblockerPath });
  execSync(`mkdir -p ${libPath}/dist`);
  execSync(`cp ./.cache/adblocker/packages/adblocker/package.json ${libPath}/`);
  execSync(`cp -r ./.cache/adblocker/packages/adblocker/dist ${libPath}/`);
  execSync(`npm install`, { cwd: libPath });
  const x = await import(entryPath);
  return x;
}

function match(
  library: Library,
  data: Uint8Array,
  { url, sourceUrl }: { url: string; sourceUrl?: string | undefined },
  envConfig: string,
) {
  const env: Map<string, boolean> = new Map();
  env.set('ext_ghostery', true);
  if (envConfig.includes('chromium')) {
    env.set('env_chromium', true);
    env.set('env_edge', true);
  }
  if (envConfig.includes('firefox')) {
    env.set('env_firefox', true);
    env.set('cap_replace_modifier', true);
    env.set('cap_html_filtering', true);
  }
  if (envConfig.includes('mobile')) {
    env.set('env_mobile', true);
  }
  const engine = library.FiltersEngine.deserialize(data);
  engine.updateEnv(env);
  const request = library.Request.fromRawDetails({
    url,
    sourceUrl,
  });
  const networkFilters = engine.matchAll(request);
  const cosmeticFilters = engine.matchCosmeticFilters({
    ...request,
    getExtendedRules: false,
    getPureHasRules: true,
    getRulesFromHostname: true,
    getInjectionRules: true,
  });
  return {
    networkFilters,
    cosmeticFilters,
  };
}

function stringifyFilter(filter: NetworkFilter | CosmeticFilter) {
  if (filter.isCosmeticFilter()) {
    if (filter.isScriptInject()) {
      const parsed = filter.parseScript()!;
      if (filter.domains === undefined) {
        return `##+js(${parsed.name}, ${parsed.args.join(', ')})`;
      } else {
        return `<hostnames>##+js(${parsed.name}, ${parsed.args.map((arg) => decodeURIComponent(arg)).join(', ')})`;
      }
    }
  }
  return filter.toString();
}

export async function queryExt(args: CliArg[]) {
  const options = await configure(args);
  await mkdir('./.cache', { recursive: true });
  console.warn(`[warn] pulling engines from artifact...`);
  const { version, assets } = await pull(options.artifact);
  console.warn('[warn] loading corresponding version of adblocker library...');
  const lib = await adblocker(`tags/v${version}`);
  for (const asset of assets) {
    // TODO: Match DNR rules
    if (asset.path.endsWith('.json')) {
      continue;
    }
    if (options.skipRegionals && asset.path.includes('lang')) {
      continue;
    }
    console.warn(`[warn] loading "${asset.path}"... ~${Math.floor(asset.data.length / 1024)}KB`);
    const matches = match(
      lib,
      asset.data,
      {
        url: options.url,
        sourceUrl: options.sourceUrl,
      },
      options.env ?? '',
    );
    console.log(
      `[info] matched ${matches.networkFilters.size} network filters and ${matches.cosmeticFilters.matches.length} cosmetic filters`,
    );
    for (const filter of matches.networkFilters) {
      console.log(`+ ${stringifyFilter(filter)}`);
    }
    for (const { filter, exception } of matches.cosmeticFilters.matches) {
      console.log(`+ ${stringifyFilter(filter)}`);
      if (typeof exception !== 'undefined') {
        console.log(`- ${stringifyFilter(exception)}`);
      }
    }
  }
}
