# Phase D — Runtime Composition

Phase D adds composition primitives while keeping EamilOS mission orchestration authoritative.

## Profiles

Profiles describe a runtime shape through capabilities, plugins, reusable presets, and inherited profiles. Resolution is deterministic and inheritance cycles are rejected.

## Bundles

Bundles pair a profile with concrete plugin implementations. Installation is atomic: if a plugin fails, previously installed plugins are disposed in reverse order.

## Capability presets

Presets provide reusable capability sets. A profile can combine presets and remove inherited capabilities with explicit denials.

## External plugins

External modules implement the same EamilOS plugin contract as built-in plugins and are loaded through the same PluginRuntime lifecycle.

## Runtime inspection

RuntimeInspector exposes capabilities, installed plugins, dependency graph, Mermaid graph, profiles, and bundles as a serializable snapshot.

The TUI remains a consumer of this state; it does not own composition or plugin lifecycle.
