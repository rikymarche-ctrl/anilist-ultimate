# Moving to AniList Ultimate

AniList Ultimate unifies the calendar from [anilist-calendar-extension](https://github.com/rikymarche-ctrl/anilist-calendar-extension) and note tooltips from [anilist-extension](https://github.com/rikymarche-ctrl/anilist-extension), with Astra and other features.

The target for ongoing development is [anilist-ultimate](https://github.com/rikymarche-ctrl/anilist-ultimate). Both predecessor repositories were archived on 20 October 2026, after migration notices and destination links were published in their READMEs and repository descriptions. Their code and history remain publicly readable.

## From the two older extensions

1. Record any preferences you want to reproduce. If an installation has an export function, save an export before removing it.
2. Install Ultimate using the [installation guide](INSTALLATION.md).
3. Disable the old calendar and hover-comment extensions to prevent duplicate UI, observers and requests.
4. Log in to AniList through Ultimate and configure the modules you want.
5. Check the calendar and note tooltips. Keep the old installations disabled until you have confirmed the new setup.
6. Remove the older installations only when you no longer need their local data.

Your AniList server-side list remains on AniList. Tokens, preferences and local storage from separate extensions do not transfer automatically. Ultimate does not provide an importer for the two predecessor extensions' settings.

## From another Ultimate build

Export Astra JSON, pending changes and Notes backups as applicable before changing installation identity. A store build and an unpacked build can have different IDs and separate storage. Load supported backups deliberately and check the destination account before editing.

Only current versioned Astra backups are supported. Old unnamespaced archives, queue arrays and removed score fields are not automatically recovered. See [data and backups](DATA_AND_BACKUPS.md) and [supported data formats](BACKUP_FORMATS.md).
