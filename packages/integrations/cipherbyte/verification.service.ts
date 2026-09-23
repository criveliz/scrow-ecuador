import {
  CompanyVerificationResult,
  CreateIdentityVerificationInput,
  IdentityVerificationSession,
  PersonVerificationResult,
  VehicleVerificationResult,
  VerificationProvider,
  VerificationStatus,
  VerifyCompanyInput,
  VerifyPersonInput,
  VerifyVehicleInput,
} from "@escrow-ecuador/domain";
import { CipherByteCache } from "./cache.js";
import { CipherByteClient } from "./client.js";
import { CipherIdService } from "./cipherid.service.js";
import { CipherByteNotFoundError } from "./errors.js";
import {
  mapCompanyResponse,
  mapPersonResponse,
  mapVehicleResponse,
} from "./mapper.js";

export class CipherByteVerificationProvider implements VerificationProvider {
  private readonly client: CipherByteClient;
  private readonly cache: CipherByteCache;
  private readonly cipherIdService: CipherIdService;

  constructor(
    client?: CipherByteClient,
    cache?: CipherByteCache,
    cipherIdService?: CipherIdService,
  ) {
    this.client = client || new CipherByteClient();
    this.cache = cache || new CipherByteCache();
    this.cipherIdService = cipherIdService || new CipherIdService();
  }

  async verifyPerson(
    input: VerifyPersonInput,
  ): Promise<PersonVerificationResult> {
    const cacheKey = `cb:person:${input.cedula}`;
    const cached = this.cache.get<PersonVerificationResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const raw = await this.client.getCedula(input.cedula);
      const result = mapPersonResponse(input.cedula, raw);
      this.cache.set(cacheKey, result);
      return result;
    } catch (err: unknown) {
      if (err instanceof CipherByteNotFoundError) {
        const notFoundResult: PersonVerificationResult = {
          status: VerificationStatus.NOT_FOUND,
          identification: input.cedula,
          provider: "CIPHERBYTE",
          verifiedAt: new Date(),
        };
        this.cache.set(cacheKey, notFoundResult);
        return notFoundResult;
      }
      throw err;
    }
  }

  async verifyVehicle(
    input: VerifyVehicleInput,
  ): Promise<VehicleVerificationResult> {
    const cacheKey = `cb:vehicle:${input.plate}`;
    const cached = this.cache.get<VehicleVerificationResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const raw = await this.client.getVehiculo(input.plate);
      const result = mapVehicleResponse(input.plate, raw);
      this.cache.set(cacheKey, result);
      return result;
    } catch (err: unknown) {
      if (err instanceof CipherByteNotFoundError) {
        const notFoundResult: VehicleVerificationResult = {
          status: VerificationStatus.NOT_FOUND,
          plate: input.plate,
          provider: "CIPHERBYTE",
          verifiedAt: new Date(),
        };
        this.cache.set(cacheKey, notFoundResult);
        return notFoundResult;
      }
      throw err;
    }
  }

  async verifyCompany(
    input: VerifyCompanyInput,
  ): Promise<CompanyVerificationResult> {
    const cacheKey = `cb:company:${input.ruc}`;
    const cached = this.cache.get<CompanyVerificationResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const raw = await this.client.getRuc(input.ruc);
      const result = mapCompanyResponse(input.ruc, raw);
      this.cache.set(cacheKey, result);
      return result;
    } catch (err: unknown) {
      if (err instanceof CipherByteNotFoundError) {
        const notFoundResult: CompanyVerificationResult = {
          status: VerificationStatus.NOT_FOUND,
          ruc: input.ruc,
          provider: "CIPHERBYTE",
          verifiedAt: new Date(),
        };
        this.cache.set(cacheKey, notFoundResult);
        return notFoundResult;
      }
      throw err;
    }
  }

  async createIdentityVerification(
    input: CreateIdentityVerificationInput,
  ): Promise<IdentityVerificationSession> {
    return this.cipherIdService.createIdentityVerification(input);
  }
}
