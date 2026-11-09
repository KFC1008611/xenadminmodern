export interface ShutdownStep {
  name: string
  run: () => void | Promise<void>
}

/** Preserve cleanup ordering while a failed subsystem cannot skip later flushes. */
export async function runShutdownSteps(
  steps: ShutdownStep[],
  report: (name: string, error: unknown) => void,
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run()
    } catch (error) {
      report(step.name, error)
    }
  }
}
