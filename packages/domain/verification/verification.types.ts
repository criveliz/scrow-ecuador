export enum VerificationType {
  PERSON = "PERSON",
  VEHICLE = "VEHICLE",
  COMPANY = "COMPANY",
  IDENTITY = "IDENTITY",
}

export enum VerificationStatus {
  PENDING = "PENDING",
  VERIFIED = "VERIFIED",
  NOT_FOUND = "NOT_FOUND",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
}

export interface VerifyPersonInput {
  cedula: string;
}

export interface VerifyVehicleInput {
  plate: string;
}

export interface VerifyCompanyInput {
  ruc: string;
}

export interface CreateIdentityVerificationInput {
  escrowId: string;
  partyId: string;
  expectedIdentification?: string;
  partyRole?: "BUYER" | "SELLER";
}

export interface PersonVerificationResult {
  status: VerificationStatus | "VERIFIED" | "NOT_FOUND" | "FAILED";
  identification: string;
  name?: string;
  birthDate?: string;
  provider: string;
  verifiedAt: Date;
  providerReference?: string;
  rawData?: Record<string, unknown>;
}

export interface VehicleVerificationResult {
  status: VerificationStatus | "VERIFIED" | "NOT_FOUND" | "FAILED";
  plate: string;
  brand?: string;
  model?: string;
  color?: string;
  vehicleClass?: string;
  year?: number;
  service?: string;
  registrationDates?: Record<string, unknown>;
  tintedWindows?: boolean | string;
  provider: string;
  verifiedAt: Date;
  providerReference?: string;
  rawData?: Record<string, unknown>;
}

export interface CompanyVerificationResult {
  status: VerificationStatus | "VERIFIED" | "NOT_FOUND" | "FAILED";
  ruc: string;
  companyName?: string;
  tradeName?: string;
  companyStatus?: string;
  companyType?: string;
  provider: string;
  verifiedAt: Date;
  providerReference?: string;
  rawData?: Record<string, unknown>;
}

export interface IdentityVerificationSession {
  verificationId?: string;
  status: VerificationStatus | "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";
  verificationUrl: string;
  expiresAt?: Date;
  providerReference?: string;
}

export interface VerificationProvider {
  verifyPerson(input: VerifyPersonInput): Promise<PersonVerificationResult>;
  verifyVehicle(input: VerifyVehicleInput): Promise<VehicleVerificationResult>;
  verifyCompany(input: VerifyCompanyInput): Promise<CompanyVerificationResult>;
  createIdentityVerification(
    input: CreateIdentityVerificationInput,
  ): Promise<IdentityVerificationSession>;
}
