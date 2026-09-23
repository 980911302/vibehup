/** 统一错误类型：路由层统一转换为 HTTP 错误响应，MCP 层转换为 isError 结果 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'BAD_REQUEST',
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '请先登录', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '没有权限执行该操作', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class EmailTakenError extends ConflictError {
  constructor(email: string) {
    super(`邮箱已被注册: ${email}`, 'EMAIL_TAKEN');
  }
}

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('邮箱或密码错误', 'INVALID_CREDENTIALS');
  }
}

export class AccountDisabledError extends ForbiddenError {
  constructor() {
    super('账号已被禁用，请联系管理员', 'ACCOUNT_DISABLED');
  }
}

export class TokenReusedError extends UnauthorizedError {
  constructor() {
    super('登录态异常，请重新登录', 'TOKEN_REUSED');
  }
}

export class LastOwnerError extends ForbiddenError {
  constructor() {
    super('系统需要至少一名 Owner', 'LAST_OWNER');
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

/** 请求过于频繁（登录防暴力等）：429 + 人话提示，retryAfterSec 供 Retry-After 头 */
export class RateLimitedError extends AppError {
  constructor(
    message: string,
    readonly retryAfterSec = 60,
  ) {
    super(message, 429, 'RATE_LIMITED');
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
