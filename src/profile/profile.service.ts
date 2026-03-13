import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateProfileDto,
  CreateAddressDto,
  UpdateAddressDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  CreateSolicitorDto,
  UpdateSolicitorDto,
  AddCollaboratorDto,
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

  async searchUsers(query: string, currentUserId: string) {
    if (!query || query.trim().length < 2) return [];

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
      },
      take: 10,
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      avatarUrl: u.avatarUrl,
    }));
  }

  async getCollaborators(userId: string) {
    const rows = await this.prisma.userCollaborator.findMany({
      where: { userId },
      include: {
        collaborator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      collaboratorId: r.collaborator.id,
      name: [r.collaborator.firstName, r.collaborator.lastName].filter(Boolean).join(' ') || r.collaborator.email,
      email: r.collaborator.email,
      avatarUrl: r.collaborator.avatarUrl,
      role: r.role,
      permission: r.permission,
      accessDuration: r.accessDuration,
      expiresAt: r.expiresAt,
      clientAccess: r.clientAccess,
      allowComms: r.allowComms,
      addedAt: r.createdAt,
    }));
  }

  async addCollaborator(userId: string, dto: AddCollaboratorDto) {
    if (dto.collaboratorId === userId) {
      throw new ConflictException('Cannot add yourself as a collaborator');
    }

    const target = await this.prisma.user.findUnique({ where: { id: dto.collaboratorId } });
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.prisma.userCollaborator.findUnique({
      where: { userId_collaboratorId: { userId, collaboratorId: dto.collaboratorId } },
    });
    if (existing) throw new ConflictException('User is already a collaborator');

    const row = await this.prisma.userCollaborator.create({
      data: {
        userId,
        collaboratorId: dto.collaboratorId,
        role: dto.role,
        permission: dto.permission ?? 'all',
        accessDuration: dto.accessDuration ?? 'permanent',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        clientAccess: dto.clientAccess ?? 'shared',
        allowComms: dto.allowComms ?? true,
      },
      include: {
        collaborator: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
        },
      },
    });

    return {
      id: row.id,
      collaboratorId: row.collaborator.id,
      name: [row.collaborator.firstName, row.collaborator.lastName].filter(Boolean).join(' ') || row.collaborator.email,
      email: row.collaborator.email,
      avatarUrl: row.collaborator.avatarUrl,
      role: row.role,
      permission: row.permission,
      accessDuration: row.accessDuration,
      expiresAt: row.expiresAt,
      clientAccess: row.clientAccess,
      allowComms: row.allowComms,
      addedAt: row.createdAt,
    };
  }

  async removeCollaborator(userId: string, collaboratorRowId: string) {
    const row = await this.prisma.userCollaborator.findUnique({ where: { id: collaboratorRowId } });
    if (!row) throw new NotFoundException('Collaborator not found');
    if (row.userId !== userId) throw new ForbiddenException();

    await this.prisma.userCollaborator.delete({ where: { id: collaboratorRowId } });
    return { message: 'Collaborator removed' };
  }
}
