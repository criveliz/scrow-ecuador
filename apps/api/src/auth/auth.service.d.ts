import { RefreshTokenRepository, UserRepository, User } from "@escrow-ecuador/database";
export interface RegisterDTO {
    email: string;
    password: string;
    phone?: string;
    role?: string;
    mfaCode?: string;
}
export interface LoginDTO {
    email: string;
    password: string;
    mfaCode?: string;
}
export interface RefreshDTO {
    refreshToken: string;
}
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    user: Omit<User, "password_hash">;
}
export declare class AuthService {
    private readonly userRepo;
    private readonly refreshTokenRepo;
    constructor(userRepo: UserRepository, refreshTokenRepo: RefreshTokenRepository);
    private hashToken;
    register(data: RegisterDTO): Promise<AuthTokens>;
    login(data: LoginDTO): Promise<AuthTokens>;
    refresh(data: RefreshDTO): Promise<AuthTokens>;
    getMe(userId: string): Promise<Omit<User, "password_hash">>;
    private generateAuthTokens;
}
//# sourceMappingURL=auth.service.d.ts.map