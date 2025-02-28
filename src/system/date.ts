// NOTE@eamodio If this changes we need to update the replacement function too (since its parameter number/order relies on the matching)
const customDateTimeFormatParserRegex =
	/(?<literal>\[.*?\])|(?<year>YYYY|YY)|(?<month>M{1,4})|(?<day>Do|DD?)|(?<weekday>d{2,4})|(?<hour>HH?|hh?)|(?<minute>mm?)|(?<second>ss?)|(?<fractionalSecond>SSS)|(?<dayPeriod>A|a)|(?<timeZoneName>ZZ?)/g;
const dateTimeFormatCache = new Map<string | undefined, Intl.DateTimeFormat>();
const dateTimeFormatRegex = /(?<dateStyle>full|long|medium|short)(?:\+(?<timeStyle>full|long|medium|short))?/;
let defaultRelativeTimeFormat: InstanceType<typeof Intl.RelativeTimeFormat> | undefined;
let defaultShortRelativeTimeFormat: InstanceType<typeof Intl.RelativeTimeFormat> | undefined;
let locale: string | undefined;
const relativeUnitThresholds: [Intl.RelativeTimeFormatUnit, number, string][] = [
	['year', 24 * 60 * 60 * 1000 * 365, 'yr'],
	['month', (24 * 60 * 60 * 1000 * 365) / 12, 'mo'],
	['week', 24 * 60 * 60 * 1000 * 7, 'wk'],
	['day', 24 * 60 * 60 * 1000, 'd'],
	['hour', 60 * 60 * 1000, 'h'],
	['minute', 60 * 1000, 'm'],
	['second', 1000, 's'],
];

type DateStyle = 'full' | 'long' | 'medium' | 'short';
type TimeStyle = 'full' | 'long' | 'medium' | 'short';
export type DateTimeFormat = DateStyle | `${DateStyle}+${TimeStyle}`;

export function createFromDateDelta(
	date: Date,
	delta: { years?: number; months?: number; days?: number; hours?: number; minutes?: number; seconds?: number },
): Date {
	const d = new Date(date.getTime());

	for (const [key, value] of Object.entries(delta)) {
		if (!value) continue;

		switch (key) {
			case 'years':
				d.setFullYear(d.getFullYear() + value);
				break;
			case 'months':
				d.setMonth(d.getMonth() + value);
				break;
			case 'days':
				d.setDate(d.getDate() + value);
				break;
			case 'hours':
				d.setHours(d.getHours() + value);
				break;
			case 'minutes':
				d.setMinutes(d.getMinutes() + value);
				break;
			case 'seconds':
				d.setSeconds(d.getSeconds() + value);
				break;
		}
	}

	return d;
}

export function fromNow(date: Date, short?: boolean): string {
	const elapsed = date.getTime() - new Date().getTime();

	for (const [unit, threshold, shortUnit] of relativeUnitThresholds) {
		const elapsedABS = Math.abs(elapsed);
		if (elapsedABS >= threshold || threshold === 1000 /* second */) {
			if (short) {
				if (locale == null) {
					if (defaultShortRelativeTimeFormat != null) {
						locale = defaultShortRelativeTimeFormat.resolvedOptions().locale;
					} else if (defaultRelativeTimeFormat != null) {
						locale = defaultRelativeTimeFormat.resolvedOptions().locale;
					} else {
						defaultShortRelativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
							localeMatcher: 'best fit',
							numeric: 'always',
							style: 'narrow',
						});
						locale = defaultShortRelativeTimeFormat.resolvedOptions().locale;
					}
				}

				if (locale === 'en' || locale?.startsWith('en-')) {
					const value = Math.round(elapsedABS / threshold);
					return `${value}${shortUnit}`;
				}

				if (defaultShortRelativeTimeFormat == null) {
					defaultShortRelativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
						localeMatcher: 'best fit',
						numeric: 'always',
						style: 'narrow',
					});
				}

				return defaultShortRelativeTimeFormat.format(Math.round(elapsed / threshold), unit);
			}

			if (defaultRelativeTimeFormat == null) {
				defaultRelativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
					localeMatcher: 'best fit',
					numeric: 'auto',
					style: 'long',
				});
			}
			return defaultRelativeTimeFormat.format(Math.round(elapsed / threshold), unit);
		}
	}

	return '';
}

export function formatDate(date: Date, format: 'full' | 'long' | 'medium' | 'short' | string | null | undefined) {
	format = format ?? undefined;

	let formatter = dateTimeFormatCache.get(format);
	if (formatter == null) {
		const options = getDateTimeFormatOptionsFromFormatString(format);
		formatter = new Intl.DateTimeFormat(undefined, options);
		dateTimeFormatCache.set(format, formatter);
	}

	if (format == null || dateTimeFormatRegex.test(format)) {
		return formatter.format(date);
	}

	const parts = formatter.formatToParts(date);
	return format.replace(
		customDateTimeFormatParserRegex,
		(
			_match,
			literal,
			_year,
			_month,
			_day,
			_weekday,
			_hour,
			_minute,
			_second,
			_fractionalSecond,
			_dayPeriod,
			_timeZoneName,
			_offset,
			_s,
			groups,
		) => {
			if (literal != null) return (literal as string).substring(1, literal.length - 1);

			for (const key in groups) {
				const value = groups[key];
				if (value == null) continue;

				const part = parts.find(p => p.type === key);

				if (value === 'Do' && part?.type === 'day') {
					return formatWithOrdinal(Number(part.value));
				} else if (value === 'a' && part?.type === 'dayPeriod') {
					return part.value.toLocaleLowerCase();
				}
				return part?.value ?? '';
			}

			return '';
		},
	);
}

export function getDateDifference(
	first: Date | number,
	second: Date | number,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
): number {
	const diff =
		(typeof second === 'number' ? second : second.getTime()) -
		(typeof first === 'number' ? first : first.getTime());
	switch (unit) {
		case 'days':
			return Math.floor(diff / (1000 * 60 * 60 * 24));
		case 'hours':
			return Math.floor(diff / (1000 * 60 * 60));
		case 'minutes':
			return Math.floor(diff / (1000 * 60));
		case 'seconds':
			return Math.floor(diff / 1000);
		default:
			return diff;
	}
}

function getDateTimeFormatOptionsFromFormatString(
	format: DateTimeFormat | string | undefined,
): Intl.DateTimeFormatOptions {
	if (format == null) return { localeMatcher: 'best fit', dateStyle: 'full', timeStyle: 'short' };

	const match = dateTimeFormatRegex.exec(format);
	if (match?.groups != null) {
		const { dateStyle, timeStyle } = match.groups;
		return {
			localeMatcher: 'best fit',
			dateStyle: (dateStyle as Intl.DateTimeFormatOptions['dateStyle']) || 'full',
			timeStyle: (timeStyle as Intl.DateTimeFormatOptions['timeStyle']) || undefined,
		};
	}

	const options: Intl.DateTimeFormatOptions = { localeMatcher: 'best fit' };

	for (const { groups } of format.matchAll(customDateTimeFormatParserRegex)) {
		if (groups == null) continue;

		for (const key in groups) {
			const value = groups[key];
			if (value == null) continue;

			switch (key) {
				case 'year':
					options.year = value.length === 4 ? 'numeric' : '2-digit';
					break;
				case 'month':
					switch (value.length) {
						case 4:
							options.month = 'long';
							break;
						case 3:
							options.month = 'short';
							break;
						case 2:
							options.month = '2-digit';
							break;
						case 1:
							options.month = 'numeric';
							break;
					}
					break;
				case 'day':
					if (value === 'DD') {
						options.day = '2-digit';
					} else {
						options.day = 'numeric';
					}
					break;
				case 'weekday':
					switch (value.length) {
						case 4:
							options.weekday = 'long';
							break;
						case 3:
							options.weekday = 'short';
							break;
						case 2:
							options.weekday = 'narrow';
							break;
					}
					break;
				case 'hour':
					options.hour = value.length === 2 ? '2-digit' : 'numeric';
					options.hour12 = value === 'hh' || value === 'h';
					break;
				case 'minute':
					options.minute = value.length === 2 ? '2-digit' : 'numeric';
					break;
				case 'second':
					options.second = value.length === 2 ? '2-digit' : 'numeric';
					break;
				case 'fractionalSecond':
					(options as any).fractionalSecondDigits = 3;
					break;
				case 'dayPeriod':
					options.dayPeriod = 'narrow';
					options.hour12 = true;
					break;
				case 'timeZoneName':
					options.timeZoneName = (value.length === 2 ? 'longOffset' : 'shortOffset') as any;
					break;
			}
		}
	}

	return options;
}

const ordinals = ['th', 'st', 'nd', 'rd'];
function formatWithOrdinal(n: number): string {
	const v = n % 100;
	return `${n}${ordinals[(v - 20) % 10] ?? ordinals[v] ?? ordinals[0]}`;
}
