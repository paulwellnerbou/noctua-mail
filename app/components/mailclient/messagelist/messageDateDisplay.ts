import type { AccountDateFormat } from "@/lib/data";
import { getMessageDateDisplay } from "@/lib/dateFormatting";

type MessageDateDisplay = {
  text: string;
  tooltip: string;
};

export function getMessageListDateDisplay(
  dateValue: number,
  fallbackDate: string,
  dateFormat?: AccountDateFormat
): MessageDateDisplay {
  return getMessageDateDisplay(dateValue, fallbackDate, dateFormat);
}
