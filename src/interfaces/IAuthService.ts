export interface IAuthService {
  initialize(): void
  verifyToken(token: string): Promise<{ userId: string }>
}
