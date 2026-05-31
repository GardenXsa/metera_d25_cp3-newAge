/**
 * ConfluenceHealthCheck (Issue #004)
 *
 * Единая проверка здоровья всех подсистем Confluence Protocol v2:
 * - DualWriteGateway
 * - PredictiveFeed
 * - CommandFeedback
 * - ReconciliationBuffer
 * - WorldManifest
 *
 * Логирует при отключении подсистемы (уровень WARN).
 * Позволяет периодический health-check (каждые N ходов).
 */
window.ConfluenceHealthCheck = (() => {
    'use strict';

    const SUBSYSTEMS = [
        { name: 'DualWriteGateway',   obj: () => window.DualWriteGateway },
        { name: 'PredictiveFeed',     obj: () => window.PredictiveFeed },
        { name: 'CommandFeedback',    obj: () => window.CommandFeedback },
        { name: 'ReconciliationBuffer', obj: () => window.ReconciliationBuffer },
        { name: 'WorldManifest',      obj: () => window.WorldManifest },
    ];

    let _lastCheckResult = null;
    let _checkCount = 0;
    let _disabledNotified = new Set(); // подсистемы, о которых уже предупредили

    /**
     * Проверяет здоровье всех подсистем Confluence.
     * @returns {{ healthy: number, total: number, subsystems: Array, timestamp: string }}
     */
    function check() {
        _checkCount++;
        const subsystems = SUBSYSTEMS.map(sub => {
            const obj = sub.obj();
            const available = typeof obj !== 'undefined' && obj !== null;
            let enabled = false;
            let hasConfig = false;

            if (available) {
                // Проверяем getConfig() — все подсистемы имеют конфигурацию
                hasConfig = typeof obj.getConfig === 'function';
                if (hasConfig) {
                    try {
                        const config = obj.getConfig();
                        enabled = config && (config.enabled !== false);
                    } catch (e) {
                        enabled = false;
                    }
                } else {
                    // Если нет getConfig, считаем доступной
                    enabled = true;
                }
            }

            // Предупреждаем при первом обнаружении отключённой подсистемы
            if (!available || !enabled) {
                if (!_disabledNotified.has(sub.name)) {
                    _disabledNotified.add(sub.name);
                    console.warn(`[ConfluenceHealth] Subsystem '${sub.name}' is ${!available ? 'UNAVAILABLE' : 'DISABLED'}`);
                }
            }

            return {
                name: sub.name,
                available,
                enabled,
                healthy: available && enabled
            };
        });

        const healthy = subsystems.filter(s => s.healthy).length;
        const result = {
            healthy,
            total: subsystems.length,
            subsystems,
            timestamp: new Date().toISOString(),
            checkCount: _checkCount
        };

        _lastCheckResult = result;

        if (healthy < subsystems.length && _checkCount === 1) {
            console.warn(`[ConfluenceHealth] ${healthy}/${subsystems.length} subsystems healthy. Disabled: ${
                subsystems.filter(s => !s.healthy).map(s => s.name).join(', ')
            }`);
        } else if (healthy === subsystems.length && _checkCount <= 3) {
            console.log(`[ConfluenceHealth] All ${subsystems.length} subsystems healthy.`);
        }

        return result;
    }

    /**
     * Возвращает результат последней проверки (без повторного выполнения).
     */
    function getLastResult() {
        return _lastCheckResult;
    }

    /**
     * Быстрая проверка: все ли подсистемы здоровы?
     */
    function isHealthy() {
        const result = check();
        return result.healthy === result.total;
    }

    /**
     * Возвращает отладочную информацию о состоянии Confluence.
     */
    function getDebugInfo() {
        return {
            lastCheck: _lastCheckResult,
            checkCount: _checkCount,
            disabledNotified: Array.from(_disabledNotified)
        };
    }

    /**
     * Сброс уведомлений (для повторного оповещения после перезапуска).
     */
    function reset() {
        _disabledNotified.clear();
        _checkCount = 0;
        _lastCheckResult = null;
    }

    return {
        check,
        getLastResult,
        isHealthy,
        getDebugInfo,
        reset
    };
})();
