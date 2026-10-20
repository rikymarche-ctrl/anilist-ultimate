# Supported data formats

## Astra JSON backups

The current backup reader accepts `schemaVersion: 1` with the supported workspace, work, season and optional seasonal-choice fields. Optional current date fields may be absent. A numeric schema value alone is not enough: identifiers, ownership and nested fields are validated too.

Keep the exported JSON unchanged. Unsupported fields, malformed data and oversized files are rejected rather than silently converted. The reader limit is 8 Mi characters; the file picker also checks file size.

## Account and local workspaces

Astra stores workspaces under the current account namespace or the current local-workspace namespace. Switching accounts does not merge them.

**Copy local Astra to account** is an explicit recovery action requiring the current account and an empty destination. It does not claim or merge arbitrary storage belonging to a different extension or account.

## Pending edits

The durable synchronization queue uses its own versioned envelope and account-bound records. It is separate from an Astra archive backup. Recovery exports are intended for inspection; there is no general pending-queue importer.

## Unsupported data

Unversioned Astra backups, unnamespaced historical archives, standalone-extension settings and unsupported queue/list formats are not automatically migrated. Do not change a schema number or rename storage keys to force acceptance.

A rejected import is not a reason to reset your existing workspace. Export current data, keep the original file and use [troubleshooting](TROUBLESHOOTING.md). [Backup and recovery](DATA_AND_BACKUPS.md) describes what each export includes.
