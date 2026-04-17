/**
 * Shared validation for user-supplied project/directory names.
 *
 * Lives in src/shared/ so it can be consumed from main, preload, and renderer
 * without violating layer boundaries. Keep this file dependency-free.
 *
 * The regex restricts names to a safe subset for filesystem paths AND for
 * later interpolation into CLI invocations (no whitespace, quotes, or shell
 * metacharacters). Loosening it has security implications for any service
 * that shells out using the name; prefer passing names via argv instead.
 */
export const PROJECT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_REGEX.test(name)
}
