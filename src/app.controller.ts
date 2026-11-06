import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Root endpoint', description: 'No auth required. Trivial landing-page string, used as a basic "the server is responding at all" smoke check.' })
  @ApiResponse({ status: 200, description: 'A plain greeting string.', schema: { type: 'string' } })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
