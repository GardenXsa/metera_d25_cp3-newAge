(function() {
    function normalizeCalendar(options = {}) {
        return {
            daysPerYear: Math.max(1, Number(options.daysPerYear) || 360),
            daysPerMonth: Math.max(1, Number(options.daysPerMonth) || 30)
        };
    }

    function formatWorldDay(day, options = {}) {
        if (day === null || day === undefined || day === '') return 'Дата неизвестна';
        const numericDay = Number(day);
        if (!Number.isFinite(numericDay) || numericDay < 0) return 'Дата неизвестна';

        const calendar = normalizeCalendar(options);
        const wholeDay = Math.floor(numericDay);
        const year = Math.floor(wholeDay / calendar.daysPerYear) + 1;
        const dayOfYear = wholeDay % calendar.daysPerYear;
        const month = Math.floor(dayOfYear / calendar.daysPerMonth) + 1;
        const dayOfMonth = (dayOfYear % calendar.daysPerMonth) + 1;

        return `Год ${year}, месяц ${month}, день ${dayOfMonth}`;
    }

    const api = { formatWorldDay };

    if (typeof window !== 'undefined') {
        window.WorldDateFormatter = api;
        window.formatWorldDay = formatWorldDay;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
