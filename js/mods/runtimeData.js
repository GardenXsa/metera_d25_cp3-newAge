// FIX (Issue #56): Removed dual UMD + window global pattern.
// Now uses pure UMD export — no implicit window.RuntimeDataUtils pollution.
// Code that needs RuntimeDataUtils should require/import it explicitly,
// or access it through ModAPI.runtimeData in the mod sandbox.
(function(root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
        return;
    }
    // For browser/non-Node: export to root (globalThis), NOT to window explicitly
    // This avoids dual registration (window.RuntimeDataUtils AND globalThis.RuntimeDataUtils)
    root.RuntimeDataUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function() {
    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function cloneValue(value) {
        if (Array.isArray(value)) {
            return value.map(cloneValue);
        }
        if (isPlainObject(value)) {
            const result = {};
            Object.keys(value).forEach((key) => {
                result[key] = cloneValue(value[key]);
            });
            return result;
        }
        return value;
    }

    function mergeDeep(target, source) {
        const baseTarget = isPlainObject(target) ? cloneValue(target) : {};
        if (!isPlainObject(source)) {
            return baseTarget;
        }

        Object.keys(source).forEach((key) => {
            const sourceValue = source[key];
            const targetValue = baseTarget[key];
            if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
                baseTarget[key] = mergeDeep(targetValue, sourceValue);
            } else if (isPlainObject(sourceValue)) {
                baseTarget[key] = mergeDeep({}, sourceValue);
            } else if (Array.isArray(sourceValue)) {
                baseTarget[key] = sourceValue.map(cloneValue);
            } else {
                baseTarget[key] = sourceValue;
            }
        });

        return baseTarget;
    }

    function upsertById(current, incoming) {
        const result = Array.isArray(current) ? current.map(cloneValue) : [];
        const indexById = new Map();

        result.forEach((item, index) => {
            if (item && typeof item.id === 'string') {
                indexById.set(item.id, index);
            }
        });

        (Array.isArray(incoming) ? incoming : []).forEach((item) => {
            if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
                result.push(cloneValue(item));
                return;
            }

            if (!indexById.has(item.id)) {
                indexById.set(item.id, result.length);
                result.push(cloneValue(item));
                return;
            }

            const currentIndex = indexById.get(item.id);
            const existing = result[currentIndex];
            result[currentIndex] = isPlainObject(existing) && isPlainObject(item)
                ? mergeDeep(existing, item)
                : cloneValue(item);
        });

        return result;
    }

    function appendArray(current, incoming) {
        const base = Array.isArray(current) ? current.map(cloneValue) : [];
        (Array.isArray(incoming) ? incoming : []).forEach((item) => {
            base.push(cloneValue(item));
        });
        return base;
    }

    function appendUnique(current, incoming) {
        const base = Array.isArray(current) ? current.map(cloneValue) : [];
        const seen = new Set(base);
        (Array.isArray(incoming) ? incoming : []).forEach((item) => {
            if (!seen.has(item)) {
                seen.add(item);
                base.push(cloneValue(item));
            }
        });
        return base;
    }

    function mergeRuntimeValue(currentValue, incomingValue, options) {
        const mergePolicy = options && options.mergePolicy ? options.mergePolicy : 'replace';
        if (incomingValue === undefined) {
            return cloneValue(currentValue);
        }

        switch (mergePolicy) {
            case 'deepMerge':
                return mergeDeep(currentValue, incomingValue);
            case 'upsertById':
                return upsertById(currentValue, incomingValue);
            case 'append':
                return appendArray(currentValue, incomingValue);
            case 'appendUnique':
                return appendUnique(currentValue, incomingValue);
            case 'replace':
            default:
                return cloneValue(incomingValue);
        }
    }

    function createDefaultValue(defaultType) {
        if (defaultType === 'array') return [];
        if (defaultType === 'string') return '';
        if (defaultType === 'number') return 0;
        if (defaultType === 'boolean') return false;
        if (defaultType === 'null') return null;
        return {};
    }

    function normalizeRuntimeManifest(manifest) {
        const safeManifest = isPlainObject(manifest) ? cloneValue(manifest) : {};
        const contract = isPlainObject(safeManifest.modding_contract) ? safeManifest.modding_contract : {};
        const descriptorDefaults = isPlainObject(contract.descriptor_defaults) ? contract.descriptor_defaults : {};
        const rawDatabaseFiles = isPlainObject(safeManifest.database_files) ? safeManifest.database_files : {};
        const databaseFiles = {};
        const aliasToRuntimeKey = {};

        Object.entries(rawDatabaseFiles).forEach(([runtimeKey, rawDescriptor]) => {
            const descriptor = isPlainObject(rawDescriptor) ? cloneValue(rawDescriptor) : {};
            const aliases = Array.isArray(descriptor.key_aliases) ? descriptor.key_aliases.filter((entry) => typeof entry === 'string' && entry.length > 0) : [];
            const normalizedDescriptor = {
                ...descriptor,
                owner: typeof descriptor.owner === 'string' && descriptor.owner.length > 0
                    ? descriptor.owner
                    : descriptorDefaults.owner,
                source: typeof descriptor.source === 'string' && descriptor.source.length > 0
                    ? descriptor.source
                    : descriptorDefaults.source,
                required: typeof descriptor.required === 'boolean'
                    ? descriptor.required
                    : descriptorDefaults.required !== false,
                key_aliases: aliases,
                replace_on_total_conversion: descriptor.replace_on_total_conversion === true,
                load_in_total_conversion: descriptor.load_in_total_conversion === true,
                runtime_key: runtimeKey
            };

            databaseFiles[runtimeKey] = normalizedDescriptor;
            aliasToRuntimeKey[runtimeKey] = runtimeKey;
            aliases.forEach((alias) => {
                aliasToRuntimeKey[alias] = runtimeKey;
            });
        });

        safeManifest.database_files = databaseFiles;
        safeManifest._normalized_database_aliases = aliasToRuntimeKey;

        return {
            manifest: safeManifest,
            databaseFiles,
            aliasToRuntimeKey
        };
    }

    function resolveRuntimeDatabaseKey(rawKey, manifest) {
        if (typeof rawKey !== 'string' || rawKey.length === 0) {
            return rawKey;
        }
        const normalized = normalizeRuntimeManifest(manifest);
        return normalized.aliasToRuntimeKey[rawKey] || rawKey;
    }

    function getRuntimeDatabaseDescriptor(rawKey, manifest) {
        const normalized = normalizeRuntimeManifest(manifest);
        const runtimeKey = resolveRuntimeDatabaseKey(rawKey, normalized.manifest);
        return normalized.databaseFiles[runtimeKey] || null;
    }

    function resolveEraLocationFile(eras, eraId, fallbackFileName) {
        const eraList = Array.isArray(eras) ? eras : [];
        const safeFallback = fallbackFileName
            || eraList.find((item) => item && typeof item.default_location_file === 'string' && item.default_location_file)?.default_location_file
            || '';
        const era = eraList.find((item) => item && item.id === eraId);
        if (!safeFallback) {
            throw new Error('[RuntimeData] No era location fallback file is defined.');
        }
        if (!era) {
            return {
                fileName: safeFallback,
                usedFallback: true,
                warning: `[RuntimeData] Era "${eraId}" is not defined. Falling back to ${safeFallback}.`
            };
        }
        if (!era.default_location_file) {
            return {
                fileName: safeFallback,
                usedFallback: true,
                warning: `[RuntimeData] Era "${eraId}" has no default_location_file. Falling back to ${safeFallback}.`
            };
        }
        return {
            fileName: era.default_location_file,
            usedFallback: false,
            warning: ''
        };
    }

    function resolvePromptEntry(promptPack, keyOrPath) {
        if (!promptPack || !keyOrPath) {
            return null;
        }
        const entries = isPlainObject(promptPack.entries) ? promptPack.entries : {};
        const aliases = isPlainObject(promptPack.aliases) ? promptPack.aliases : {};
        const semanticKey = entries[keyOrPath] ? keyOrPath : aliases[keyOrPath];
        return semanticKey && entries[semanticKey] ? entries[semanticKey] : null;
    }

    function ensurePromptAlias(promptPack, semanticKey, legacyPath) {
        if (!promptPack.entries) {
            promptPack.entries = {};
        }
        if (!promptPack.aliases) {
            promptPack.aliases = {};
        }
        if (legacyPath) {
            promptPack.aliases[legacyPath] = semanticKey;
        }
    }

    return {
        isPlainObject,
        cloneValue,
        mergeDeep,
        mergeRuntimeValue,
        createDefaultValue,
        normalizeRuntimeManifest,
        resolveRuntimeDatabaseKey,
        getRuntimeDatabaseDescriptor,
        resolveEraLocationFile,
        resolvePromptEntry,
        ensurePromptAlias,
        appendArray,
        appendUnique
    };
});
