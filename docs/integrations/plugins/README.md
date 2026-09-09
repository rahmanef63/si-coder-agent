# Optional host plugin integrations

SI-Coder publishes `plugins/si-coder/plugin.json`, a versioned portable plugin manifest. Hosts consume its descriptive Agent Skills and MCP metadata; loading a manifest never executes it and never carries credentials.

MSO support is an optional adapter in `plugins/mso/`. It materializes skills only because that host does not follow directory symlinks. A host such as Batonly can publish its own manifest using `schemas/plugin-manifest-v1.schema.json`; it need not adopt SI-Coder paths, identity, or secret storage.

Packaged MCP descriptors use safe repository-relative `entrypoint` and `catalog` paths. Remote descriptors use an `https` endpoint. Hosts must validate the schema and resolve packaged paths beneath the plugin package before use.
