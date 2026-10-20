# Third-party notices

Prepared from the installed lockfile dependencies on 20 October 2026. Project code is declared GPL-3.0; third-party components retain their own licenses. This inventory covers the direct runtime dependencies and additional installed dependency notices, not the entire development toolchain or a measurement of which bytes survive browser bundling. Keep relevant notices with redistributed assets.

## Icons and fonts

Font Awesome Free is by Fonticons, Inc. The SVG/JS icons are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), font files under SIL OFL 1.1, and accompanying code under MIT. Icon data is adapted into the extension's generated inline definitions in src/core/ui/IconDefinitions.ts. This attribution does not imply endorsement. The upstream terms and copyright are preserved in the license copy below. Source: [Font Awesome Free](https://fontawesome.com/license/free).

Inter is by the Inter Project Authors; Outfit is by the Outfit Project Authors. Their bundled font files retain SIL OFL 1.1 terms and the upstream copyright notices.

## Included license texts

| Component | Installed version | Upstream license | Text |
| --- | --- | --- | --- |
| @fontsource/inter | 5.3.0 | OFL-1.1 | [License](licenses/fontsource-inter.txt) |
| @fontsource/outfit | 5.3.0 | OFL-1.1 | [License](licenses/fontsource-outfit.txt) |
| @fortawesome/fontawesome-free | 7.2.0 | (CC-BY-4.0 AND OFL-1.1 AND MIT) | [License](licenses/fortawesome-fontawesome-free.txt) |
| @graphql-typed-document-node/core | 3.2.0 | MIT | [License](licenses/graphql-typed-document-node-core.txt) |
| cross-fetch | 3.2.0 | MIT | [License](licenses/cross-fetch.txt) |
| graphql | 16.13.2 | MIT | [License](licenses/graphql.txt) |
| graphql-request | 6.1.0 | MIT | [License](licenses/graphql-request.txt) |
| node-fetch | 2.7.0 | MIT | [License](licenses/node-fetch.txt) |
| reflect-metadata | 0.2.2 | Apache-2.0 | [License](licenses/reflect-metadata.txt) |
| tsyringe | 4.10.0 | MIT | [License](licenses/tsyringe.txt) |
| tslib | 2.8.1 | 0BSD | [License](licenses/tslib.txt) |
| webidl-conversions | 3.0.1 | BSD-2-Clause | [License](licenses/webidl-conversions.txt) |
| whatwg-url | 5.0.0 | MIT | [License](licenses/whatwg-url.txt) |

The reflect-metadata distribution also includes a [copyright notice](licenses/reflect-metadata-CopyrightNotice.txt), preserved alongside its Apache-2.0 text. License copies are unmodified upstream files.

The installed node-fetch/whatwg-url dependency tree also declares tr46 0.0.3 as MIT in its package metadata; that old npm package contains no standalone license file. Its [upstream source](https://github.com/Sebmaster/tr46.js) is a Node-side dependency reference, not a claim that it is included in the browser bundle. Review any server-side redistribution of that dependency separately.

## AniList and public metadata

AniList names, cover images, user avatars, character/staff images, metadata and other provider material are not relicensed by this project's GPL declaration. The same applies to MyAnimeList/Jikan and theme-provider material. Provider names identify integrations and do not imply affiliation. Share-card downloads can contain provider images and user content.

Programmatic service hosts and data handling are documented in [the privacy policy](https://github.com/rikymarche-ctrl/anilist-ultimate).

## Distribution

public/ contains copies of this notice, the project GPL text and the third-party license files so Vite can copy them into dist/. Rebuild and inspect the final ZIP when dependencies or attribution files change. Source availability and redistribution obligations are separate from having a store upload ZIP.
