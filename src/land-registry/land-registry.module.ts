import { Module } from '@nestjs/common'
import { LandRegistryService } from './land-registry.service'

@Module({
  providers: [LandRegistryService],
  exports: [LandRegistryService],
})
export class LandRegistryModule {}
