export interface Manifest {
  sourceFileId: string;
  allowedUsers: Record<string, string>;
}

// Inline manifest for the spike. Update the values locally as needed.
export const manifest: Manifest = {
  sourceFileId: "1JUdNPV0SwdlQc0O-hrSvjnqRJQv78wJ07yGi0XroayI",
  allowedUsers: {
    "nikander.pekka@gmail.com": "10Px9dQKe2WeBl1YGf1BHafs5C4MicfWq"
  }
};

// Inline manifest for the spike. Update the values locally as needed.
export const manifest2: Manifest = {
  sourceFileId: "1EGF_usFIAUzWaVZVh9poCynU4W9wnng1WkbTigYIVyo",
  allowedUsers: {
    "pekkailmari@holotropic.fi": "10Px9dQKe2WeBl1YGf1BHafs5C4MicfWq"
  }
};
