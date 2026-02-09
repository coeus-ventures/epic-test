// ============================================================================
// CHECK CLASSIFICATION
// ============================================================================

export const DETERMINISTIC_PATTERNS = [
  /^url\s+contains\s+/i,
  /^url\s+is\s+/i,
  /^page\s+title\s+is\s+/i,
  /^page\s+title\s+contains\s+/i,
  /^element\s+count\s+is\s+/i,
  /^input\s+value\s+is\s+/i,
  /^checkbox\s+is\s+checked/i,
];

export function classifyCheck(instruction: string): "deterministic" | "semantic" {
  const trimmed = instruction.trim();
  for (const pattern of DETERMINISTIC_PATTERNS) {
    if (pattern.test(trimmed)) return "deterministic";
  }
  return "semantic";
}
