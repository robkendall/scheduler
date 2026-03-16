export function formatDisplayDate(value) {
    if (!value) {
        return "";
    }

    const text = String(value);
    const ymdMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymdMatch) {
        return `${ymdMatch[2]}/${ymdMatch[3]}/${ymdMatch[1]}`;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return text;
    }

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = String(date.getFullYear());
    return `${month}/${day}/${year}`;
}
