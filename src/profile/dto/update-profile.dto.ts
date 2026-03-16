export class UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  contactVisible?: boolean;
  pushNotifications?: boolean;
  emailNewsletter?: boolean;
  smsNotifications?: boolean;
}

export class CreateAddressDto {
  label: string;
  line1: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode: string;
  isCurrent?: boolean;
}

export class UpdateAddressDto {
  label?: string;
  line1?: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode?: string;
  isCurrent?: boolean;
}

export class CreateCompanyDto {
  name: string;
  address?: string;
  companyNumber?: string;
  director?: string;
}

export class UpdateCompanyDto {
  name?: string;
  address?: string;
  companyNumber?: string;
  director?: string;
}

export class CreateSolicitorDto {
  name: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  reference?: string;
}

export class UpdateSolicitorDto {
  name?: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  reference?: string;
}

export class AddCollaboratorDto {
  collaboratorId: string;
  role?: string;
  permission?: string;
  propertyIds?: string[];
  accessDuration?: string;
  expiresAt?: string;
  clientAccess?: string;
  allowComms?: boolean;
}
