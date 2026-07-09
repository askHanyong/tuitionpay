// Shared constants for practitioner-specific features.
// Stored DB values never change; only display labels live here.

export const CLIENT_TYPE_OPTIONS = [
  { value: "paediatric", label: "Paediatric" },
  { value: "adult",      label: "Adult" },
  { value: "other",      label: "Other" },
];

export const CONSULTATION_TYPE_OPTIONS = [
  { value: "initial",     label: "Initial" },
  { value: "subsequent",  label: "Follow-up" },
];

export const CLIENT_TYPE_LABEL = Object.fromEntries(
  CLIENT_TYPE_OPTIONS.map(({ value, label }) => [value, label]),
);

export const CONSULTATION_TYPE_LABEL = Object.fromEntries(
  CONSULTATION_TYPE_OPTIONS.map(({ value, label }) => [value, label]),
);
