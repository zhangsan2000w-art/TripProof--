export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'AppError'; }
}
export function errorMessage(error: unknown) {
  if (error instanceof AppError) return error.message;
  return '处理暂未完成，请稍后重试。原有行程与证据已保留。';
}
