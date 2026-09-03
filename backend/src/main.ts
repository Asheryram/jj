import 'reflect-metadata'
import { ValidationPipe, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { DomainExceptionFilter } from './common/domain-exception.filter'
import { DomainsService } from './domains/domains.service'

async function bootstrap() {
  // rawBody is required, not optional: Paystack's webhook signature is an HMAC
  // over the unparsed body, and a re-serialised object does not match. It has to
  // be set at creation time, so this line is load-bearing for every payment.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })

  const isProduction = process.env.NODE_ENV === 'production'

  /**
   * Behind a managed host's load balancer, every request arrives from the proxy.
   *
   * Without this, `req.ip` is the proxy for all of them, so per-IP rate limiting
   * would treat the whole internet as one client — either locking everyone out
   * together or nobody at all. One hop, because that is what Render, Railway and
   * Fly put in front of a service; trusting the whole chain would let a caller
   * forge `X-Forwarded-For` and dodge the limit.
   */
  app.set('trust proxy', 1)

  /**
   * Standard security headers.
   *
   * This serves JSON, not HTML, so most of helmet is belt-and-braces — but
   * `nosniff` and a denied frame ancestor are what stop a browser being talked
   * into treating an API response as a document. CSP is left off outside
   * production because it blocks the Swagger UI, which only runs in development.
   */
  app.use(
    helmet({
      contentSecurityPolicy: isProduction,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  )

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  /**
   * Allow throwaway tunnel origins — but never by default in production.
   *
   * A rotating ngrok URL is the whole reason this is a function rather than the
   * array: during development the origin changes on every restart. Live, that
   * same rule is a hole, because anybody can stand a site up on
   * trycloudflare.com and would then be talking to this API from a browser with
   * the platform's own permissions. So production has to opt in by name, and
   * ALLOW_TUNNEL_ORIGINS exists for the case where the real domain is not
   * pointed yet.
   */
  const allowTunnels = !isProduction || process.env.ALLOW_TUNNEL_ORIGINS === 'true'
  const tunnelHost =
    /^https:\/\/[a-z0-9-]+\.(ngrok-free\.(app|dev)|ngrok\.(app|io)|trycloudflare\.com|loca\.lt)$/

  /**
   * The static allowlist above never knows an agent's custom domain in
   * advance — those are added by request, not by redeploying with a new
   * env var. So anything that misses it falls through to asking whether the
   * origin's host is an approved, live `CustomDomain` — cached briefly
   * inside the service itself, since this runs on every preflight from
   * every visitor to every custom domain.
   */
  const domains = app.get(DomainsService)

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true) // curl, same-origin, server-side
      if (origins.includes(origin) || (allowTunnels && tunnelHost.test(origin))) {
        return callback(null, true)
      }

      let hostname: string
      try {
        hostname = new URL(origin).hostname
      } catch {
        return callback(null, false)
      }
      domains.isTrustedOrigin(hostname).then(
        (allowed) => callback(null, allowed),
        () => callback(null, false),
      )
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
  if (isProduction && allowTunnels) {
    log.warn(
      'ALLOW_TUNNEL_ORIGINS is on in production — any ngrok or trycloudflare ' +
        'site can call this API from a browser. Turn it off once your domain is live.',
    )
  }
  log.log(`API      http://localhost:${port}/api`)
  if (!isProduction) log.log(`Swagger  http://localhost:${port}/api/docs`)
  log.log(`Health   http://localhost:${port}/api/health`)
}

void bootstrap()
