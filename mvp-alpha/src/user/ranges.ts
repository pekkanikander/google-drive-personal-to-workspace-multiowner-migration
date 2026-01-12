import { MANIFEST_HEADERS } from "../shared/sheets";

const STATUS_COL = MANIFEST_HEADERS.indexOf("status") + 1;
const ERROR_COL = MANIFEST_HEADERS.indexOf("error") + 1;

function columnToA1(col: number): string {
  let n = col;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function statusRange(sheetName: string, rowIndex: number): string {
  const start = columnToA1(STATUS_COL);
  const end = columnToA1(ERROR_COL);
  return `${sheetName}!${start}${rowIndex}:${end}${rowIndex}`;
}
