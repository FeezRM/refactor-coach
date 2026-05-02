export type LogLevel = 'silent' | 'info' | 'debug';

export class Logger {
  constructor(private readonly level: LogLevel = 'info') {}

  info(message: string): void {
    if (this.level !== 'silent') {
      console.log(message);
    }
  }

  warn(message: string): void {
    if (this.level !== 'silent') {
      console.warn(message);
    }
  }

  debug(message: string): void {
    if (this.level === 'debug') {
      console.log(message);
    }
  }
}
