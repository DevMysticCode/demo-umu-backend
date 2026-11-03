import { IsString } from 'class-validator';

// Body for the no-auth tenant-facing e-signature endpoint
// (POST /questions/tenancy-sign/:token) — see question.controller.ts.
export class SubmitTenantSignatureDto {
  @IsString()
  signerName: string;

  @IsString()
  signatureDataUrl: string;
}
