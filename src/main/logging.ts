export interface LogEntry {
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

export const log = ({ scope, message, data }: LogEntry): void => {
  const timestamp = new Date().toISOString();
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [${scope}] ${message}${payload}`);
};
