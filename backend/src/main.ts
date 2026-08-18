import 'reflect-metadata'
import { ValidationPipe, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { DomainExceptionFilter } from './common/domain-exception.filter'

async function bootstrap() {
  // rawBody is required, not optional: Paystack's webhook signature is an HMAC
  // over the unparsed body, and a re-serialised object does not match. It has to
  // be set at creation time, so this line is load-bearing for every payment.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  const isProduction = process.env.NODE_ENV === 'production'

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

  /**
   * API docs, but not in production.
   *
   * Swagger publishes every route, its shape and its auth requirement. That is
   * exactly the reconnaissance an attacker would otherwise have to guess at, and
   * it is of no use to a customer — so it is a development tool and stays one.
   */
  if (!isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('JamesDataConsult API')
      .setDescription(
        'Ghana data-bundle and airtime reseller platform. Fulfilment goes through ' +
          'DataHub GH and payments through Paystack; both fall back to in-process ' +
          'simulation when their credentials are absent.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build()
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger))
  }

  const port = Number(process.env.PORT ?? 3001)
  await app.listen(port, '0.0.0.0')

  const log = new Logger('bootstrap')
  log.log(`API      http://localhost:${port}/api`)
  if (!isProduction) log.log(`Swagger  http://localhost:${port}/api/docs`)
  log.log(`Health   http://localhost:${port}/api/health`)
}

void bootstrap()
