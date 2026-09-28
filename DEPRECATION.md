# EamilOS Package Deprecation Guide

## Overview

As of v1.7.0, EamilOS has consolidated its public npm packages from three packages into one:

| Package | Status | Replacement |
|---------|--------|-------------|
| `@eamilos/core` | **Deprecated** | `@eamilos/cli/core` |
| `@eamilos/cli-ui` | **Deprecated** | `@eamilos/cli/ui` |
| `@eamilos/cli` | **Active** | Continue using |

## Deprecation Commands

Run these commands to deprecate the old packages on npm:

```bash
# Deprecate @eamilos/core
npm deprecate @eamilos/core \
  "EamilOS has consolidated its public runtime into @eamilos/cli. Migrate to @eamilos/cli/core."

# Deprecate @eamilos/cli-ui
npm deprecate @eamilos/cli-ui \
  "EamilOS has consolidated its terminal UI into @eamilos/cli. Migrate to @eamilos/cli/ui."
```

## Migration Path for Consumers

### Before (v1.x)
```javascript
// Old imports
import { initEamilOS } from '@eamilos/core'
import { launchTUI } from '@eamilos/cli-ui'
import { createMultiAgentCommands } from '@eamilos/cli/multi-agent'
```

### After (v1.7.0+)
```javascript
// New imports - all from single package
import { initEamilOS } from '@eamilos/cli/core'
import { launchTUI } from '@eamilos/cli/ui'
import { createMultiAgentCommands } from '@eamilos/cli/multi-agent'
```

## What Deprecation Does

- **Does not unpublish** - packages remain installable for existing users
- **Shows warning** - `npm install` and `npm update` show deprecation message
- **Preserves compatibility** - existing code continues to work
- **Guides migration** - points users to new import paths

## Timeline

1. **v1.7.0 released** - New consolidated package published
2. **Deprecation commands run** - Old packages marked deprecated
3. **6+ months** - Deprecation warnings visible to users
4. **Future major version** - Consider removing old packages (npm discourages unpublishing)

## Verification

After deprecation, verify:

```bash
# Check deprecation warnings appear
npm install @eamilos/core@latest
npm install @eamilos/cli-ui@latest

# Check new package works
npm install @eamilos/cli@latest

# Test imports
node -e "import('@eamilos/cli/core').then(m => console.log('core OK'))"
node -e "import('@eamilos/cli/ui').then(m => console.log('ui OK'))"
node -e "import('@eamilos/cli/multi-agent').then(m => console.log('multi-agent OK'))"
```

## Notes

- npm **strongly recommends deprecation over unpublishing** for packages with dependents
- Deprecated packages still count toward your package limit
- You can undeprecate with `npm deprecate @eamilos/core ""` if needed
- The old packages were last published at v1.2.8 (April 2026)

## References

- [npm docs: Deprecating packages](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions)
- [npm CLI: deprecate command](https://docs.npmjs.com/cli/v11/commands/npm-deprecate)