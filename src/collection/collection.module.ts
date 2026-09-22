import { Module } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '../passport/passport.module';

@Module({
  imports: [PrismaModule, JwtModule, PassportModule],
  providers: [CollectionService],
  controllers: [CollectionController],
})
export class CollectionModule {}
