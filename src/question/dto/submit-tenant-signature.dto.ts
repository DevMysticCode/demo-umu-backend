import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Body for the no-auth tenant-facing e-signature endpoint
// (POST /questions/tenancy-sign/:token) — see question.controller.ts.
export class SubmitTenantSignatureDto {
  @ApiProperty({ description: "The signing tenant's full name." })
  @IsString()
  signerName: string;

  @ApiProperty({ description: 'Signature image as a data URL (e.g. "data:image/png;base64,...").' })
  @IsString()
  signatureDataUrl: string;
}
