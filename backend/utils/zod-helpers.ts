import { z } from "zod"

/**
 * Zod Helpers
 * Standardized error formatting for Zod validation errors
 */

/**
 * Safe parse helper that throws formatted error
 */
export function safeParseOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = schema.safeParse(data)
  
  if (!result.success) {
    const errorMessage = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root"
        return `${path}: ${issue.message}`
      })
      .join("; ")
    throw new Error(context ? `${context}: ${errorMessage}` : errorMessage)
  }
  
  return result.data
}
