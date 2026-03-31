import { SEVERITIES, type Severity } from "../schema/entry";

export function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column < columns; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

export function suggestSeverity(input: string): Severity | null {
  if (input.length < 4) {
    return null;
  }

  let bestMatch: Severity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const severity of SEVERITIES) {
    const distance = levenshtein(input.toLowerCase(), severity);

    if (distance <= 2 && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = severity;
    }
  }

  return bestMatch;
}
