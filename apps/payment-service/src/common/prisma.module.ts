import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Provides the one PrismaService; modules that need the database import this. */
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
