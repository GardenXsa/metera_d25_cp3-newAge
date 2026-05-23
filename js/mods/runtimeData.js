(function(root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
        return;
    }
    root.RuntimeDataUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
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
        (Array.isArray(incoming) ? incoming : []).forEach((item) => {
            if (!base.includes(item)) {
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

    function resolveEraLocationFile(eras, eraId, fallbackFileName) {
        const safeFallback = fallbackFileName || 'locations_rebirth.json';
        const eraList = Array.isArray(eras) ? eras : [];
        const era = eraList.find((item) => item && item.id === eraId);
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
        resolveEraLocationFile,
        resolvePromptEntry,
        ensurePromptAlias,
        appendArray,
        appendUnique
    };
});
