export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409;

export class HttpError extends Error {
  status: HttpErrorStatus;

  constructor(status: HttpErrorStatus, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
