import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../interceptors/response-envelope.interceptor';

export function configureApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
}
