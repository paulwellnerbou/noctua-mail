type MessageDateDisplay = {
  text: string;
  tooltip: string;
};

const compactDateOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
};

const fullDateOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit"
};

const createFormatter = (options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(undefined, options);
  } catch {
    return null;
  }
};

const compactDateFormatter = createFormatter(compactDateOptions);
const fullDateFormatter = createFormatter(fullDateOptions);

const formatDate = (
  date: Date,
  formatter: Intl.DateTimeFormat | null,
  options: Intl.DateTimeFormatOptions
) => {
  if (formatter) return formatter.format(date);
  try {
    return date.toLocaleString(undefined, options);
  } catch {
    return date.toLocaleString();
  }
};

export function getMessageListDateDisplay(
  dateValue: number,
  fallbackDate: string
): MessageDateDisplay {
  if (!Number.isFinite(dateValue)) {
    return { text: fallbackDate, tooltip: fallbackDate };
  }

  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return { text: fallbackDate, tooltip: fallbackDate };
  }

  return {
    text: formatDate(parsedDate, compactDateFormatter, compactDateOptions),
    tooltip: formatDate(parsedDate, fullDateFormatter, fullDateOptions)
  };
}
