adblocker-utils
: Automates commonly done tasks while developing Ghostery adblocker.

This tool requires git, node, and npm to be installed.

-- Querying filters from a specific extension

The corresponding version of adblocker library will be automatically built on demand.

* Query cosmetic filters on `example.com`: `pnpm start query-ext https://example.com`
* Query cosmetic filters on `example.com` with the Firefox extension version of v10.4.23: `pnpm start query-ext https://example.com --artifact=https://github.com/ghostery/ghostery-extension/releases/download/v10.4.23/ghostery-chromium-10.4.23.zip`
