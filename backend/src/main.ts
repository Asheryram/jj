import 'reflect-metadata'
import { ValidationPipe, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { DomainExceptionFilter } from './common/domain-exception.filter'

async function bootstrap() {
  // rawBody so a real Paystack webhook could verify its HMAC over the unparsed
  // body later (skills-breakdown.md §4.1). This build has no live keys, but the
  // flag has to be set at creation time — retrofitting it means touching main.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  app.enableCors({
    // A function rather than the array, so an ngrok tunnel origin is allowed
    // without restarting the API every time the URL rotates.
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true) // curl, same-origin, server-side
      const ok =
        origins.includes(origin) ||
        /^https:\/\/[a-z0-9-]+\.(ngrok-free\.(app|dev)|ngrok\.(app|io)|trycloudflare\.com|loca\.lt)$/.test(
          origin,
        )
      callback(null, ok)
    },
    credentials: true,
  })

  app.setGlobalPrefix('api')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // NFR-4.3 — domain errors leave as structured codes the frontend maps to
  // friendly copy, never as a stack trace.
  app.useGlobalFilters(new DomainExceptionFilter())

  const swagger = new DocumentBuilder()
    .setTitle('JamesDataConsult API')
    .setDescription(
      'Dummy backend for local testing. Fulfilment and Mobile Money are simulated in-process — there are no DataHub GH or Paystack credentials.',
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .build()
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger))

  const port = Number(process.env.PORT ?? 3001)
  await app.listen(port, '0.0.0.0')

  const log = new Logger('bootstrap')
  log.log(`API      http://localhost:${port}/api`)
  log.log(`Swagger  http://localhost:${port}/api/docs`)
  log.log(`Health   http://localhost:${port}/api/health`)
}

void bootstrap()
