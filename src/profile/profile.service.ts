import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateProfileDto,
  CreateAddressDto,
  UpdateAddressDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  CreateSolicitorDto,
  UpdateSolicitorDto,
} from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: { orderBy: { createdAt: 'asc' } },
        companies: { orderBy: { createdAt: 'asc' } },
        solicitors: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const { password, ...safe } = user;
    return safe;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
    const { password, ...safe } = user;
    return safe;
  }

  // ─── Addresses ────────────────────────────────────────────────────────────

  async createAddress(userId: string, dto: CreateAddressDto) {
    return this.prisma.userAddress.create({
      data: { ...dto, userId },
    });
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const address = await this.prisma.userAddress.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.userId !== userId) throw new ForbiddenException();

    return this.prisma.userAddress.update({
      where: { id: addressId },
      data: dto,
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.userAddress.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.userId !== userId) throw new ForbiddenException();

    await this.prisma.userAddress.delete({ where: { id: addressId } });
    return { message: 'Address deleted' };
  }

  // ─── Companies ────────────────────────────────────────────────────────────

  async createCompany(userId: string, dto: CreateCompanyDto) {
    return this.prisma.userCompany.create({
      data: { ...dto, userId },
    });
  }

  async updateCompany(userId: string, companyId: string, dto: UpdateCompanyDto) {
    const company = await this.prisma.userCompany.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.userId !== userId) throw new ForbiddenException();

    return this.prisma.userCompany.update({
      where: { id: companyId },
      data: dto,
    });
  }

  async deleteCompany(userId: string, companyId: string) {
    const company = await this.prisma.userCompany.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.userId !== userId) throw new ForbiddenException();

    await this.prisma.userCompany.delete({ where: { id: companyId } });
    return { message: 'Company deleted' };
  }

  // ─── Solicitors ───────────────────────────────────────────────────────────

  async createSolicitor(userId: string, dto: CreateSolicitorDto) {
    return this.prisma.userSolicitor.create({
      data: { ...dto, userId },
    });
  }

  async updateSolicitor(userId: string, solicitorId: string, dto: UpdateSolicitorDto) {
    const solicitor = await this.prisma.userSolicitor.findUnique({ where: { id: solicitorId } });
    if (!solicitor) throw new NotFoundException('Solicitor not found');
    if (solicitor.userId !== userId) throw new ForbiddenException();

    return this.prisma.userSolicitor.update({
      where: { id: solicitorId },
      data: dto,
    });
  }

  async deleteSolicitor(userId: string, solicitorId: string) {
    const solicitor = await this.prisma.userSolicitor.findUnique({ where: { id: solicitorId } });
    if (!solicitor) throw new NotFoundException('Solicitor not found');
    if (solicitor.userId !== userId) throw new ForbiddenException();

    await this.prisma.userSolicitor.delete({ where: { id: solicitorId } });
    return { message: 'Solicitor deleted' };
  }

  // ─── Collaborators ────────────────────────────────────────────────────────

  async getCollaborators(userId: string) {
    // Fetch all passports owned by user with their collaborators
    const passports = await this.prisma.passport.findMany({
      where: { ownerId: userId },
      include: {
        collaborators: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    // Flatten and deduplicate collaborators across passports
    const seen = new Set<string>();
    const collaborators: any[] = [];

    for (const passport of passports) {
      for (const collab of passport.collaborators) {
        if (!seen.has(collab.user.id)) {
          seen.add(collab.user.id);
          collaborators.push({
            id: collab.id,
            userId: collab.user.id,
            name: [collab.user.firstName, collab.user.lastName].filter(Boolean).join(' ') || collab.user.email,
            email: collab.user.email,
            avatarUrl: collab.user.avatarUrl,
            passportAddress: passport.addressLine1,
            passportId: passport.id,
            addedAt: collab.createdAt,
          });
        }
      }
    }

    return collaborators;
  }
}
