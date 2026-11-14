import { Controller, Module, type INestApplication, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { configureApp } from './configure-app';

@Controller()
class EchoController {
  @Post('echo')
  echo(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: { level: 'silent' } })],
  controllers: [EchoController],
})
class TestModule {}

describe('malformed JSON bodies', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    configureApp(app, { swaggerEnabled: false, contractFile: '/nonexistent' });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(() => app.close());

  it('answers 400 VALIDATION_ERROR with a fixed message that never echoes the parser text', async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"card":{"number":"4242424242424242","cvc":"987","e":x}}',
    });
    const text = await res.text();
    expect(res.status).toBe(400);
    const body = JSON.parse(text) as { code: string; message: string; statusCode: number };
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Malformed JSON body',
    });
    expect(text).not.toContain('987');
    expect(text).not.toContain('4242');
    expect(text).not.toContain('Unexpected');
  });

  it('also covers a truncated body', async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"cvc":"987"',
    });
    const body = (await res.json()) as { code: string; message: string };
    expect(res.status).toBe(400);
    expect(body.message).toBe('Malformed JSON body');
  });
});
