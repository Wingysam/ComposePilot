import type { SpawnOptions } from 'bun'

export class ShellUtil {
  private cwd: string

  constructor() {
    this.cwd = process.cwd()
  }

  $(...command: string[]) {
    return new Promise<string>((resolve, reject) => {
      Bun.spawn(command, {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        onExit: async (proc, exitCode) => {
          if (exitCode === 0) {
            resolve(await this.readableStreamToString(proc.stdout as any))
          } else {
            reject(
              new Error(await this.readableStreamToString(proc.stderr as any)),
            )
          }
        },
      })
    })
  }

  spawn(command: string[], options: SpawnOptions.OptionsObject) {
    return new Promise<string>((resolve, reject) => {
      Bun.spawn(command, {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        onExit: async (proc, exitCode) => {
          if (exitCode === 0) {
            resolve(await this.readableStreamToString(proc.stdout as any))
          } else {
            reject(
              new Error(await this.readableStreamToString(proc.stderr as any)),
            )
          }
        },
        ...options,
      })
    })
  }

  private async readableStreamToString(
    stream: ReadableStream<Uint8Array>,
  ): Promise<string> {
    const chunks: String[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(new TextDecoder().decode(value))
    }
    return chunks.join('')
  }

  async cd(path: string) {
    this.cwd = path
  }
}
