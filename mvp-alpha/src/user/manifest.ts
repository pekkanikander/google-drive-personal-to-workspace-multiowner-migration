import { ManifestRow } from "../shared/types";

export interface PreparedEntry {
  rowIndex: number;
  row: ManifestRow;
  parents: string[];
  owners: string[];
  isMultiOwner: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseOwners(value: string): string[] {
  return value
    .split(";")
    .map((owner) => normalizeEmail(owner))
    .filter(Boolean);
}

export function parseParents(value: string): string[] {
  return value
    .split(";")
    .map((parent) => parent.trim())
    .filter(Boolean);
}

export function buildManifestEntries(rows: ManifestRow[]): PreparedEntry[] {
  return rows.map((row, index) => {
    const owners = parseOwners(row.owners);
    const parents = parseParents(row.parents);
    return {
      rowIndex: index + 2,
      row,
      parents,
      owners,
      isMultiOwner: owners.length > 1,
    };
  });
}

export function filterEntriesForOwner(entries: PreparedEntry[], email: string) {
  const normalizedEmail = normalizeEmail(email);
  const owned = entries.filter((entry) => entry.owners.includes(normalizedEmail));
  const eligible = owned.filter((entry) => !entry.isMultiOwner);
  return {
    owned,
    eligible,
    multiOwnerCount: owned.length - eligible.length,
  };
}
